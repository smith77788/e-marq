/**
 * Brand-aware context для lead-агентів (Web Prospector, Social Engager, Content Magnet).
 *
 * Кожен тенант має свою тематику. Цей модуль:
 *   1. Читає `bootstrap_facts.brand_profile` (заповнюється brand-profile-discoverer).
 *   2. Якщо профілю немає — синтезує його «на льоту» з tenants/tenant_configs/products
 *      і одразу записує (щоб lead-агенти могли працювати з першого дня).
 *   3. На основі профілю генерує:
 *        - search-queries для веб-розвідки (web-prospector),
 *        - outreach copy під голос бренду (social-engager),
 *        - magnet-теми для SEO-сторінок (content-magnet).
 *
 * Завдяки цьому жоден lead-агент більше не оперує hardcoded переліком
 * «українських e-commerce ніш» — він працює саме під тематику кожного бренду.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { upsertBootstrapFacts, readBootstrapFact } from "@/lib/acos/bootstrapFacts";

export type BrandProfile = {
  brand_name: string;
  slug: string | null;
  description: string | null;
  keywords: string[];
  categories: string[];
  avg_price_cents: number;
  price_tier: "budget" | "mid" | "premium" | "luxury";
  tone: "editorial" | "conversational" | "minimal";
  content_pieces: number;
  products_count: number;
  /** Локальна гіпотеза — потім її уточнить brand-profile discoverer. */
  inferred?: boolean;
};

export type TenantBrandContext = {
  tenant_id: string;
  profile: BrandProfile;
  /** Готові пошукові запити для web-prospector. */
  search_queries: Array<{ q: string; niche: string }>;
  /** Топіки/слаги майбутніх SEO-магнітів. */
  magnet_topics: Array<{
    topic: string;
    title: string;
    meta_description: string;
    keywords: string[];
    body_md: string;
    slug_seed: string;
  }>;
  /** Шаблон outreach-копії з підстановкою бренда. */
  outreach: {
    subject: (prospectName: string) => string;
    body: (prospectName: string, prospectNiche: string | null) => string;
    cta: string;
  };
};

const FALLBACK_CATEGORIES = ["e-commerce", "store"];

/** Завантажити список активних тенантів. */
export async function listActiveTenantIds(): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from("tenants")
    .select("id")
    .eq("status", "active")
    .order("created_at", { ascending: true });
  return (data ?? []).map((r) => r.id);
}

/**
 * Отримати brand-context для тенанта. Якщо профілю немає — синтезувати з наявних
 * даних і записати у bootstrap_facts (інакше агенти лишились би «беззубі»).
 */
export async function getTenantBrandContext(tenantId: string): Promise<TenantBrandContext> {
  let profile = await readBootstrapFact<BrandProfile>(tenantId, "brand_profile");
  if (!profile) {
    profile = await synthesizeBrandProfile(tenantId);
    await upsertBootstrapFacts([
      {
        tenant_id: tenantId,
        fact_kind: "brand_profile",
        value: profile as unknown as Record<string, unknown>,
        confidence: 0.4,
        source: "agent",
        evidence: { synthesized_by: "lead/brandContext" },
      },
    ]);
  }
  return {
    tenant_id: tenantId,
    profile,
    search_queries: buildSearchQueries(profile),
    magnet_topics: buildMagnetTopics(profile),
    outreach: buildOutreachTemplates(profile),
  };
}

/** Контексти для всіх активних тенантів (з авто-синтезом профілю при потребі). */
export async function getAllTenantBrandContexts(): Promise<TenantBrandContext[]> {
  const ids = await listActiveTenantIds();
  const result: TenantBrandContext[] = [];
  for (const id of ids) {
    try {
      result.push(await getTenantBrandContext(id));
    } catch {
      /* пропускаємо тенант, якщо щось зламалось — інші мають продовжити */
    }
  }
  return result;
}

// ────────────────────────── Синтез профілю ──────────────────────────

async function synthesizeBrandProfile(tenantId: string): Promise<BrandProfile> {
  const [tenantRes, cfgRes, productsRes, contentRes] = await Promise.all([
    supabaseAdmin.from("tenants").select("name, slug").eq("id", tenantId).maybeSingle(),
    supabaseAdmin
      .from("tenant_configs")
      .select("brand_name, seo")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabaseAdmin
      .from("products")
      .select("name, price_cents, metadata")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .limit(50),
    supabaseAdmin
      .from("content_pages")
      .select("body_md")
      .eq("tenant_id", tenantId)
      .eq("is_published", true)
      .limit(20),
  ]);

  const tenant = tenantRes.data;
  const cfg = cfgRes.data;
  const products = (productsRes.data ?? []) as Array<{
    name: string;
    price_cents: number;
    metadata: Record<string, unknown> | null;
  }>;
  const content = contentRes.data ?? [];

  const seoMeta = (cfg?.seo ?? {}) as Record<string, unknown>;
  const description =
    (typeof seoMeta.description === "string" && seoMeta.description) ||
    (typeof seoMeta.tagline === "string" && seoMeta.tagline) ||
    null;
  const keywords = Array.isArray(seoMeta.keywords) ? (seoMeta.keywords as string[]) : [];

  const categories = new Set<string>();
  let totalPrice = 0;
  let priced = 0;
  for (const p of products) {
    const meta = (p.metadata ?? {}) as Record<string, unknown>;
    const cat = typeof meta.category === "string" ? meta.category : null;
    if (cat) categories.add(cat);
    if (typeof p.price_cents === "number" && p.price_cents > 0) {
      totalPrice += p.price_cents;
      priced++;
    }
  }
  const avgPriceCents = priced > 0 ? Math.round(totalPrice / priced) : 0;

  let priceTier: BrandProfile["price_tier"] = "mid";
  if (avgPriceCents > 0 && avgPriceCents < 5_000) priceTier = "budget";
  else if (avgPriceCents < 30_000) priceTier = "mid";
  else if (avgPriceCents < 150_000) priceTier = "premium";
  else if (avgPriceCents >= 150_000) priceTier = "luxury";

  const totalWords = content.reduce((s, c) => s + (c.body_md?.split(/\s+/).length ?? 0), 0);
  const avgWordsPerPost = content.length > 0 ? Math.round(totalWords / content.length) : 0;
  const tone: BrandProfile["tone"] =
    avgWordsPerPost > 400 ? "editorial" : avgWordsPerPost > 150 ? "conversational" : "minimal";

  const cats = categories.size > 0 ? Array.from(categories) : FALLBACK_CATEGORIES;

  return {
    brand_name: cfg?.brand_name ?? tenant?.name ?? "Бренд",
    slug: tenant?.slug ?? null,
    description,
    keywords,
    categories: cats,
    avg_price_cents: avgPriceCents,
    price_tier: priceTier,
    tone,
    content_pieces: content.length,
    products_count: products.length,
    inferred: true,
  };
}

// ────────────────────────── Запити для web-prospector ──────────────────────────

function buildSearchQueries(profile: BrandProfile): Array<{ q: string; niche: string }> {
  const cats = profile.categories.length > 0 ? profile.categories : FALLBACK_CATEGORIES;
  const queries: Array<{ q: string; niche: string }> = [];

  for (const cat of cats.slice(0, 6)) {
    const niche = slugify(cat) || "ecommerce";
    queries.push({ q: `магазин ${cat} україна`, niche });
    queries.push({ q: `купити ${cat} інтернет магазин`, niche });
  }

  // Додамо ключові слова з SEO як теми (наприклад "органічна косметика")
  for (const kw of profile.keywords.slice(0, 4)) {
    if (!kw || kw.length < 3) continue;
    queries.push({ q: `${kw} магазин україна`, niche: slugify(kw) || "ecommerce" });
  }

  // Дедуп
  const seen = new Set<string>();
  return queries.filter((q) => {
    const k = q.q.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ────────────────────────── Outreach copy ──────────────────────────

function buildOutreachTemplates(profile: BrandProfile): TenantBrandContext["outreach"] {
  const sourceBrand = profile.brand_name;
  const ourCategory = profile.categories[0] ?? "ваш сегмент";
  const tone = profile.tone;

  return {
    cta: "https://e-marq.lovable.app/signup",
    subject: (prospect) =>
      tone === "minimal"
        ? `${prospect} × ${sourceBrand}: ідея`
        : `Як ${prospect} може зростати швидше — ідея від ${sourceBrand}`,
    body: (prospect, prospectNiche) => {
      const niche = prospectNiche ?? ourCategory;
      if (tone === "editorial") {
        return [
          `Доброго дня, команда ${prospect}!`,
          ``,
          `Ми у ${sourceBrand} працюємо у ніші «${ourCategory}» і знаємо, як виглядає `,
          `щоденна боротьба за повторні продажі та автоматизацію Telegram/Email.`,
          ``,
          `Тестуємо MARQ — AI-помічник для брендів типу «${niche}». Він самостійно `,
          `відновлює покинуті кошики, повертає клієнтів і пише SEO-описи у вашому тоні.`,
          ``,
          `14 днів безкоштовно, без передоплати: https://e-marq.lovable.app/signup`,
          ``,
          `— команда ${sourceBrand}`,
        ].join("\n");
      }
      if (tone === "minimal") {
        return [
          `Привіт, ${prospect}!`,
          ``,
          `Ми у ${sourceBrand} автоматизували роботу з клієнтами через MARQ.`,
          `Можливо, корисно й вам — 14 днів безкоштовно.`,
          ``,
          `https://e-marq.lovable.app/signup`,
        ].join("\n");
      }
      // conversational
      return [
        `Привіт, ${prospect}!`,
        ``,
        `Я з ${sourceBrand} (${ourCategory}). Хотіла поділитись інструментом,`,
        `який нам реально допоміг — MARQ. Це AI-помічник: відновлює кошики,`,
        `пише розсилки, тримає Telegram-бота на автопілоті.`,
        ``,
        `Якщо ви теж у «${niche}» — спробуйте 14 днів безкоштовно:`,
        `https://e-marq.lovable.app/signup`,
        ``,
        `— команда ${sourceBrand}`,
      ].join("\n");
    },
  };
}

// ────────────────────────── Magnet topics ──────────────────────────

function buildMagnetTopics(profile: BrandProfile): TenantBrandContext["magnet_topics"] {
  const cats = profile.categories.length > 0 ? profile.categories : FALLBACK_CATEGORIES;
  const brand = profile.brand_name;
  const out: TenantBrandContext["magnet_topics"] = [];

  for (const cat of cats.slice(0, 3)) {
    const slugCat = slugify(cat) || "shop";
    out.push({
      topic: `guide_${slugCat}`,
      slug_seed: `${slugCat}-marketing-guide`,
      title: `Як магазину «${cat}» зростати в Україні: гайд від ${brand}`,
      meta_description: `Покроковий план для онлайн-магазину у ніші «${cat}»: автоматизація, повернення клієнтів, AI-маркетинг.`,
      keywords: [cat, `${cat} магазин`, `${cat} україна`, "ecommerce маркетинг"],
      body_md: [
        `# Як магазину «${cat}» зростати в Україні`,
        ``,
        `Бренди у ніші «${cat}» стикаються з трьома типовими болями: повторні продажі, `,
        `сезонність, та конкуренція з маркетплейсами. Розбираємо, як це вирішити без зайвого бюджету.`,
        ``,
        `## 1. Автоматизація комунікації`,
        `- Telegram-бот для FAQ та апсейлу`,
        `- Email-розсилки win-back раз на місяць`,
        `- Автовідповідач у Instagram DM`,
        ``,
        `## 2. AI у щоденних задачах`,
        `- Опис товарів під SEO`,
        `- Підказки про оптимальні ціни`,
        `- Сегменти клієнтів для розсилок`,
        ``,
        `## 3. З чого почати`,
        `Спробуйте MARQ — 14 днів безкоштовно, без карти. Інструмент, яким користуємось ми у ${brand}.`,
        ``,
        `[Створити безкоштовний акаунт](https://e-marq.lovable.app/signup)`,
      ].join("\n"),
    });
  }

  // Універсальний магніт від бренду
  out.push({
    topic: `case_${slugify(brand)}`,
    slug_seed: `${slugify(brand) || "brand"}-marq-case`,
    title: `Кейс ${brand}: як AI-помічник прискорив роботу команди`,
    meta_description: `${brand} ділиться досвідом використання AI-помічника MARQ для автоматизації e-commerce.`,
    keywords: [brand, "ai кейс", "ecommerce україна", "автоматизація"],
    body_md: [
      `# Кейс ${brand}: AI у щоденній роботі`,
      ``,
      `Ми у ${brand} підключили MARQ і за тиждень помітили: `,
      `менше рутини, більше фокусу на продукті.`,
      ``,
      `## Що змінилось`,
      `- Покинуті кошики повертаються автоматично`,
      `- Клієнти отримують відповіді 24/7 у Telegram`,
      `- Маркетинг перестав «здогадуватись» про сегменти`,
      ``,
      `## Спробуйте теж`,
      `[14 днів безкоштовно у MARQ](https://e-marq.lovable.app/signup)`,
    ].join("\n"),
  });

  return out;
}

// ────────────────────────── Utils ──────────────────────────

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9а-яіїєґ]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
