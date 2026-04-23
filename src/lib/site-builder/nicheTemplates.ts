/**
 * Niche-aware seed content generator (Sprint 11.7).
 *
 * Reads the wizard answers stored in `site_brand_profiles.niche_profile`
 * and produces brand-tailored copy: hero variants, category seeds, FAQ
 * starter, programmatic-SEO landing topics, blog topic ideas, About story,
 * tracking matrix, and a ready-to-paste Lovable remix prompt.
 *
 * Pure functions — no Supabase/fs access. All inputs come from
 * `SafeBrandContext`. The output of every function is a UTF-8 string ready
 * to be written into a JSZip entry.
 *
 * Why a separate file: keeps `templates.ts` focused on the universal
 * brand-overlay artifacts (CSS tokens, manifest, package.json) and lets the
 * niche-specific content live in one cohesive module that's easy to
 * iterate on without touching the rebrand machinery.
 */
import type { SafeBrandContext } from "./brandContext";

// ---------- Types ----------

export type NicheProfile = {
  business_type: string; // "Cafe / coffee shop", "Clothing brand", "Beauty cosmetics", etc.
  target_audience: string; // free-form description
  products_overview: string; // free-form list of typical SKUs / services
  usp: string; // unique selling proposition
  tone_of_voice: string; // "friendly", "premium", "playful", "expert"
  must_have_features: string[]; // ["wholesale", "loyalty", "blog", "telegram-bot", ...]
  competitor_urls: string[]; // up to 3 competitor sites for tone reference
  growth_goal: string; // "first-100-orders", "scale-to-1k-mrr", "wholesale-network"
};

export const FEATURE_LIBRARY = [
  "catalog",
  "wholesale",
  "blog",
  "loyalty",
  "telegram-bot",
  "instagram-feed",
  "spin-game",
  "delivery",
  "wishlist",
  "promotions",
  "reviews",
  "faq",
  "contacts",
  "category-landings",
  "programmatic-seo",
  "newsletter",
  "referral",
  "subscriptions",
  "distributor-portal",
] as const;

export const TONE_OPTIONS = ["friendly", "premium", "playful", "expert", "minimal"] as const;
export const GROWTH_GOALS = [
  "first-100-orders",
  "scale-to-1k-mrr",
  "wholesale-network",
  "international-expansion",
  "brand-awareness",
] as const;

// ---------- Helpers ----------

export function readNicheProfile(ctx: SafeBrandContext): NicheProfile {
  const raw = (ctx.profile.niche_profile ?? {}) as Partial<NicheProfile>;
  return {
    business_type: typeof raw.business_type === "string" ? raw.business_type : "",
    target_audience: typeof raw.target_audience === "string" ? raw.target_audience : "",
    products_overview: typeof raw.products_overview === "string" ? raw.products_overview : "",
    usp: typeof raw.usp === "string" ? raw.usp : "",
    tone_of_voice: typeof raw.tone_of_voice === "string" ? raw.tone_of_voice : "friendly",
    must_have_features: Array.isArray(raw.must_have_features)
      ? raw.must_have_features.filter((x): x is string => typeof x === "string")
      : ["catalog", "blog", "reviews", "contacts", "faq"],
    competitor_urls: Array.isArray(raw.competitor_urls)
      ? raw.competitor_urls.filter((x): x is string => typeof x === "string")
      : [],
    growth_goal: typeof raw.growth_goal === "string" ? raw.growth_goal : "first-100-orders",
  };
}

export function isWizardComplete(p: NicheProfile): boolean {
  return Boolean(
    p.business_type.trim() &&
      p.target_audience.trim() &&
      p.products_overview.trim() &&
      p.usp.trim() &&
      p.must_have_features.length >= 3,
  );
}

// ---------- Category seed presets per business type ----------

const CATEGORY_PRESETS: Record<string, Array<{ handle: string; name: string }>> = {
  cafe: [
    { handle: "coffee", name: "Кава" },
    { handle: "drinks", name: "Напої" },
    { handle: "desserts", name: "Десерти" },
    { handle: "breakfast", name: "Сніданки" },
    { handle: "merch", name: "Мерч" },
  ],
  food: [
    { handle: "bestsellers", name: "Хіти продажів" },
    { handle: "new", name: "Новинки" },
    { handle: "seasonal", name: "Сезонне" },
    { handle: "gifts", name: "Подарункові набори" },
  ],
  clothing: [
    { handle: "new", name: "Нова колекція" },
    { handle: "tops", name: "Верх" },
    { handle: "bottoms", name: "Низ" },
    { handle: "outerwear", name: "Верхній одяг" },
    { handle: "accessories", name: "Аксесуари" },
    { handle: "sale", name: "Sale" },
  ],
  beauty: [
    { handle: "skincare", name: "Догляд за шкірою" },
    { handle: "makeup", name: "Макіяж" },
    { handle: "hair", name: "Волосся" },
    { handle: "body", name: "Тіло" },
    { handle: "sets", name: "Набори" },
  ],
  electronics: [
    { handle: "smartphones", name: "Смартфони" },
    { handle: "laptops", name: "Ноутбуки" },
    { handle: "audio", name: "Аудіо" },
    { handle: "accessories", name: "Аксесуари" },
  ],
  jewelry: [
    { handle: "rings", name: "Каблучки" },
    { handle: "necklaces", name: "Кольє" },
    { handle: "earrings", name: "Сережки" },
    { handle: "bracelets", name: "Браслети" },
  ],
  default: [
    { handle: "bestsellers", name: "Хіти продажів" },
    { handle: "new", name: "Новинки" },
    { handle: "gifts", name: "Подарункові набори" },
  ],
};

function detectCategoryPreset(p: NicheProfile): Array<{ handle: string; name: string }> {
  const t = p.business_type.toLowerCase();
  if (/cafe|coffee|каф|кав/.test(t)) return CATEGORY_PRESETS.cafe;
  if (/food|їж|продукт|delicat|grocer|crauts|ферм/.test(t)) return CATEGORY_PRESETS.food;
  if (/cloth|fashion|apparel|одяг|wear/.test(t)) return CATEGORY_PRESETS.clothing;
  if (/beauty|cosmet|косметик|skincare/.test(t)) return CATEGORY_PRESETS.beauty;
  if (/electron|gadget|tech|техніка/.test(t)) return CATEGORY_PRESETS.electronics;
  if (/jewel|ювелі|прикрас/.test(t)) return CATEGORY_PRESETS.jewelry;
  return CATEGORY_PRESETS.default;
}

// ---------- Hero copy variants by tone ----------

function heroByTone(brand: string, usp: string, tone: string): { headline: string; sub: string; cta: string } {
  const u = usp || `Якісні товари для тих, хто цінує деталі`;
  switch (tone) {
    case "premium":
      return {
        headline: `${brand} — преміальний вибір`,
        sub: u,
        cta: "Відкрити колекцію",
      };
    case "playful":
      return {
        headline: `Привіт від ${brand}! 👋`,
        sub: u,
        cta: "Поглянути, що тут",
      };
    case "expert":
      return {
        headline: `${brand}: експертний підхід до кожної деталі`,
        sub: u,
        cta: "Перейти в каталог",
      };
    case "minimal":
      return {
        headline: brand,
        sub: u,
        cta: "Каталог",
      };
    case "friendly":
    default:
      return {
        headline: `Ласкаво просимо до ${brand}`,
        sub: u,
        cta: "До каталогу",
      };
  }
}

// ---------- FAQ starter ----------

function faqStarter(brand: string, p: NicheProfile): Array<{ q: string; a: string }> {
  const list: Array<{ q: string; a: string }> = [
    {
      q: `Хто стоїть за ${brand}?`,
      a: p.target_audience
        ? `Ми створюємо ${p.products_overview || "наші продукти"} для ${p.target_audience}.`
        : `Ми — невелика команда, що захоплена тим, що робить.`,
    },
    {
      q: "Як швидко ви відправляєте замовлення?",
      a: "Замовлення відправляємо протягом 1–2 робочих днів після підтвердження оплати.",
    },
    {
      q: "Які способи оплати ви приймаєте?",
      a: "Картка, Apple Pay / Google Pay, накладений платіж (за домовленістю), оплата частинами через Monobank/PrivatBank.",
    },
    {
      q: "Чи можна повернути товар?",
      a: "Так. Протягом 14 днів з моменту отримання, якщо товар не був у використанні. Деталі — на сторінці «Повернення».",
    },
  ];
  if (p.must_have_features.includes("wholesale")) {
    list.push({
      q: "Чи працюєте ви з оптом?",
      a: "Так. Перейдіть на сторінку «Опт» — там умови, форма заявки та доступ до оптового кабінету.",
    });
  }
  if (p.must_have_features.includes("loyalty")) {
    list.push({
      q: "Як працює програма лояльності?",
      a: "За кожну покупку нараховуємо бали, які можна обміняти на знижку. Деталі — у профілі.",
    });
  }
  return list;
}

// ---------- Programmatic SEO landing ideas ----------

function programmaticSeoIdeas(p: NicheProfile): Array<{ slug: string; title: string; intent: string }> {
  const cats = detectCategoryPreset(p).map((c) => c.handle);
  const cities = ["kyiv", "lviv", "odesa", "kharkiv", "dnipro"];
  const ideas: Array<{ slug: string; title: string; intent: string }> = [];
  for (const cat of cats.slice(0, 3)) {
    for (const city of cities.slice(0, 3)) {
      ideas.push({
        slug: `${cat}-${city}`,
        title: `${cat[0].toUpperCase() + cat.slice(1)} у ${city[0].toUpperCase() + city.slice(1)}`,
        intent: `transactional, geo-targeted long-tail`,
      });
    }
  }
  return ideas;
}

// ---------- Blog topic ideas ----------

function blogTopics(p: NicheProfile): string[] {
  const base = [
    `5 причин, чому ${p.business_type || "наш бренд"} важливий для ${p.target_audience || "вас"}`,
    `Як обрати ${p.products_overview.split(",")[0] || "товар"} — повний гайд`,
    `Помилки, яких варто уникати при покупці`,
    `Тренди ${new Date().getFullYear()} року в нашій ніші`,
    `Кейс клієнта: ${p.usp || "як ми вирішили реальну задачу"}`,
  ];
  if (p.must_have_features.includes("loyalty"))
    base.push("Як максимально використати програму лояльності");
  if (p.must_have_features.includes("wholesale"))
    base.push("Гайд для оптових партнерів: як почати співпрацю");
  return base;
}

// ---------- About story ----------

function aboutStory(brand: string, p: NicheProfile): string {
  const audience = p.target_audience || "наших клієнтів";
  const usp = p.usp || "якість і увагу до деталей";
  return `## Хто ми

${brand} — це ${p.business_type || "бренд"}, створений для ${audience}.

## Що нас вирізняє

${usp}

## Що ми пропонуємо

${p.products_overview || "Лінійку продуктів, дбайливо підібраних під потреби клієнтів."}

## Наша мета

${
  p.growth_goal === "wholesale-network"
    ? "Побудувати мережу оптових партнерів по всій країні."
    : p.growth_goal === "international-expansion"
      ? "Вийти на міжнародний ринок і розповісти про український бренд світові."
      : p.growth_goal === "brand-awareness"
        ? "Стати впізнаваним брендом, який рекомендують друзям."
        : p.growth_goal === "scale-to-1k-mrr"
          ? "Стабільно зростати з місяця в місяць та забезпечувати клієнтам найкращий сервіс."
          : "Заробити перших постійних клієнтів і побудувати community навколо бренду."
}
`;
}

// ---------- Public exports: ZIP file contents ----------

/**
 * `NICHE_BRIEF.md` — human-readable summary of the wizard answers.
 * Lovable chat reads this to understand the brand before remixing.
 */
export function nicheBriefMd(ctx: SafeBrandContext): string {
  const p = readNicheProfile(ctx);
  const { profile } = ctx;
  return `# Нішевий бриф: ${profile.brand_name}

## Тип бізнесу
${p.business_type || "_не вказано_"}

## Цільова аудиторія
${p.target_audience || "_не вказано_"}

## Огляд продуктів / послуг
${p.products_overview || "_не вказано_"}

## Унікальна торгова пропозиція (USP)
${p.usp || "_не вказано_"}

## Тон комунікації
${p.tone_of_voice}

## Must-have фічі (з нашої бібліотеки 19 модулів MFD)
${p.must_have_features.length ? p.must_have_features.map((f) => `- ${f}`).join("\n") : "_не вказано_"}

## Бенчмарки / конкуренти
${p.competitor_urls.length ? p.competitor_urls.map((u) => `- ${u}`).join("\n") : "_не вказано_"}

## Бізнес-ціль
${p.growth_goal}

---
_Згенеровано Site Builder. Цей документ — вхідні дані для AI-генератора контенту та бренд-агента._
`;
}

/**
 * Niche-aware seed JSON. Replaces the legacy `seedJson` from templates.ts
 * when a wizard profile is present.
 */
export function nicheSeedJson(ctx: SafeBrandContext): string {
  const p = readNicheProfile(ctx);
  const { profile } = ctx;
  const hero = heroByTone(profile.brand_name, p.usp, p.tone_of_voice);
  const cats = detectCategoryPreset(p);
  return JSON.stringify(
    {
      $schema: "https://marq.lovable.app/schemas/site-seed.v2.json",
      brand: {
        name: profile.brand_name,
        tagline: profile.tagline ?? hero.headline,
        description: profile.description ?? hero.sub,
        locale: profile.locale,
        currency: profile.currency,
        tone_of_voice: p.tone_of_voice,
      },
      niche: {
        business_type: p.business_type,
        target_audience: p.target_audience,
        usp: p.usp,
        growth_goal: p.growth_goal,
      },
      hero: {
        headline: profile.tagline || hero.headline,
        subheadline: profile.description || hero.sub,
        body: profile.hero_copy || "",
        cta_primary: { label: hero.cta, to: "/catalog" },
        cta_secondary: { label: "Про нас", to: "/about" },
      },
      about: {
        title: `Про ${profile.brand_name}`,
        body: profile.about_copy || aboutStory(profile.brand_name, p),
        legal_entity: profile.legal_entity ?? "",
        address: profile.address ?? "",
      },
      contacts: {
        email: profile.contact_email ?? "",
        phone: profile.contact_phone ?? "",
        social: profile.social_links,
      },
      theme: {
        primary_color: profile.primary_color,
        accent_color: profile.accent_color,
        font_family: profile.font_family,
      },
      product_categories_seed: cats,
      faq_seed: faqStarter(profile.brand_name, p),
      blog_topics_seed: blogTopics(p),
      programmatic_seo_seed: programmaticSeoIdeas(p),
      enabled_features: p.must_have_features,
      legal_pages_defaults: ["privacy", "terms", "shipping", "returns", "offer"],
    },
    null,
    2,
  );
}

/**
 * Ready-to-paste prompt for Lovable chat in the freshly remixed project.
 * This is THE file the user will copy first — it tells Lovable exactly
 * which pages/components to wire up and with what content.
 */
export function lovableRemixPrompt(ctx: SafeBrandContext): string {
  const p = readNicheProfile(ctx);
  const { profile } = ctx;
  const hero = heroByTone(profile.brand_name, p.usp, p.tone_of_voice);
  const cats = detectCategoryPreset(p);
  const features = p.must_have_features.join(", ");
  return `# Lovable Remix Prompt — ${profile.brand_name}

> Скопіюйте УСЕ нижче й вставте одним повідомленням у чат Lovable
> у ремiксі шаблону basic-food.shop. AI зробить решту автоматично.

---

Привіт! Я щойно реміксував твій шаблон **basic-food.shop**. Хочу адаптувати його
під мій бренд **${profile.brand_name}**. Ось повний бриф — використай дані з
файлу \`seed.json\` та \`NICHE_BRIEF.md\`, щоб зробити нижченаведене:

## 1. Бренд-айдентіті
- Назва: **${profile.brand_name}**
- Тип бізнесу: ${p.business_type || "_заповни на основі продуктів нижче_"}
- Тон: **${p.tone_of_voice}**
- USP: ${p.usp || "—"}
- Аудиторія: ${p.target_audience || "—"}

## 2. Стилізація (заміни кольори без зміни структури)
- Замiни \`src/index.css\` повністю вмістом з архіву (\`src/index.css\` overlay).
  Primary \`${profile.primary_color}\`, accent \`${profile.accent_color}\`, шрифт
  \`${profile.font_family}\`.
- Заміни SEO-блок у \`index.html\` вмістом \`index.html\` з архіву.
- ${profile.logo_url ? `Завантаж логотип з ${profile.logo_url} в \`public/logo.png\`.` : "Згенеруй логотип через Lovable image-gen, збережи в `public/logo.png`."}

## 3. Головна сторінка (\`src/pages/Index.tsx\`)
Залиши існуючу структуру (Hero → Features → BestSellers → CategorySection →
About → Reviews → Newsletter → Footer), але **заміни копію**:
- HeroSection headline: «${hero.headline}»
- HeroSection subheadline: «${hero.sub}»
- CTA primary: «${hero.cta}» → \`/catalog\`
- CTA secondary: «Про нас» → \`/about\`

## 4. Каталог + категорії
Створи **${cats.length} категорій** через Lovable Cloud (таблиця \`categories\`):
${cats.map((c, i) => `${i + 1}. **${c.name}** (handle: \`${c.handle}\`)`).join("\n")}

Додай по 4–6 продуктів-плейсхолдерів у кожну категорію (можеш згенерувати
через AI), щоб \`/catalog\` і \`/category/:slug\` не були порожніми.

## 5. Сторінки, які залишаємо в маршрутах (з MFD)
${
  p.must_have_features.includes("blog")
    ? "- /blog, /blog/:slug — вже є, додай 3–5 чорнових постів зі списку blog_topics_seed.\n"
    : "- /blog — приховай у Footer/Header.\n"
}${
    p.must_have_features.includes("wholesale")
      ? "- /wholesale, /wholesale-portal, /distributor-portal — залиш активними.\n"
      : "- /wholesale, /wholesale-portal, /distributor-portal — закоментуй у App.tsx.\n"
  }${
    p.must_have_features.includes("loyalty")
      ? "- Лояльність активна. Додай блок «Накопичуй бали» в Header або Profile.\n"
      : ""
  }${
    p.must_have_features.includes("spin-game")
      ? "- /game (SpinGamePage) — залиш для лідогенерації.\n"
      : "- /game — приховай.\n"
  }${
    p.must_have_features.includes("instagram-feed")
      ? "- /instagram + InstagramCTA — залиш.\n"
      : "- /instagram, InstagramCTA, FloatingInstagramButton — приховай.\n"
  }${
    p.must_have_features.includes("category-landings") || p.must_have_features.includes("programmatic-seo")
      ? "- /l/:slug + /category/:slug — згенеруй сторінки з programmatic_seo_seed (у seed.json).\n"
      : ""
  }
- /about, /contacts, /faq, /privacy, /offer, /delivery, /reviews, /promotions — обов'язково.
- /checkout, /order-success/:id, /profile, /wishlist — частина воронки, не чіпати.
- /reorder/:orderId, /links, /tg-login — опційно.

## 6. About-копія (\`src/pages/AboutPage.tsx\`)
Заміни вміст на текст з ключа \`about.body\` у \`seed.json\`.

## 7. FAQ
Імпортуй \`faq_seed\` із \`seed.json\` у компонент FAQ — там готові 4–6 пар Q/A.

## 8. Блог
${
  p.must_have_features.includes("blog")
    ? `Створи 5 чорнових постів з тем: \n${blogTopics(p)
        .map((t) => `  - ${t}`)
        .join("\n")}`
    : "Не потрібен — приховай /blog."
}

## 9. Програмний SEO
${
  p.must_have_features.includes("programmatic-seo")
    ? `Згенеруй ${programmaticSeoIdeas(p).length} landings із \`programmatic_seo_seed\` у \`/l/:slug\`.`
    : "Не потрібно."
}

## 10. Інтеграції
- **Lovable Cloud (власний)** — увімкни в Settings, налаштуй RLS згідно міграцій MFD.
- **MARQ Engine (наш централізований AI-мозок з 86 агентами)** —
  заповни в \`.env\`:
  \`\`\`
  VITE_MARQ_API_BASE=https://e-marq.lovable.app
  VITE_MARQ_TENANT_ID=${ctx.tenant.id}
  VITE_MARQ_PUBLIC_KEY=marq_pk_xxxxxxxx_xxxxxxxxxxxxxxxxxxxxxxxx
  \`\`\`
  SDK уже в архіві: \`src/lib/marq-client.ts\`. Підключи відстеження через
  матрицю в \`MARQ_AGENTS.md\`.
${
  p.must_have_features.includes("telegram-bot")
    ? "- **Telegram-бот** для замовлень — заповни TELEGRAM_BOT_TOKEN у Lovable Cloud secrets, далі MARQ автоматично підхопить webhook.\n"
    : ""
}

## 11. Фічі для приховування / увімкнення
Активні: ${features || "_базовий набір_"}

## 12. Деплой
Натисни **Publish** у Lovable. Якщо є кастомний домен ${profile.custom_domain ? `(\`${profile.custom_domain}\`)` : "—"}, підключи в Settings → Domains.

---

**ВАЖЛИВО:** Не використовуй жоден секрет з MARQ-проекту (Supabase service-role,
Resend API key, тощо) — у тебе має бути ВЛАСНИЙ Lovable Cloud backend з
власними секретами.

Дякую! Як закінчиш — покажи preview і я скажу, що ще поправити. 🚀
`;
}

/**
 * Page inventory — every page in the basic-food.shop template, organized
 * by section. The user (and the AI in the remix) uses this to know what
 * exists and what to keep/hide.
 */
export function pagesInventoryMd(ctx: SafeBrandContext): string {
  const p = readNicheProfile(ctx);
  const enabled = new Set(p.must_have_features);
  const mark = (key: string, alwaysOn = false) =>
    alwaysOn || enabled.has(key) ? "✅" : "🚫";

  return `# Інвентар сторінок шаблону basic-food.shop

Усього в шаблоні **35+ сторінок** і **70+ компонентів**. Нижче — повна карта.
Колонка «Стан» показує, що ви увімкнули у візарді (Site Builder → Wizard).

## Публічна частина (storefront)

| Маршрут | Файл | Опис | Стан |
|---|---|---|---|
| \`/\` | \`pages/Index.tsx\` | Головна (Hero, Features, BestSellers, ShopByNeed, About, Reviews, Newsletter) | ✅ |
| \`/catalog\` | \`pages/CatalogPage.tsx\` | Каталог із фільтрами, сортуванням, пагінацією | ${mark("catalog", true)} |
| \`/product/:id\` | \`pages/ProductPage.tsx\` | Картка товару (галерея, варіанти, відгуки, FBT, related) | ${mark("catalog", true)} |
| \`/category/:slug\` | \`pages/CategoryLandingPage.tsx\` | Лендінг категорії з SEO-копією | ${mark("catalog", true)} |
| \`/l/:slug\` | \`pages/ProgrammaticLandingPage.tsx\` | Програмні SEO-лендінги (long-tail) | ${mark("programmatic-seo")} |
| \`/about\` | \`pages/AboutPage.tsx\` | Про нас (story, команда, цифри) | ✅ |
| \`/contacts\` | \`pages/ContactsPage.tsx\` | Контакти, мапа, форма зворотного зв'язку | ✅ |
| \`/faq\` | \`pages/FAQ.tsx\` | Часті питання (категорії + accordion) | ${mark("faq", true)} |
| \`/delivery\` | \`pages/DeliveryPage.tsx\` | Доставка та оплата | ${mark("delivery", true)} |
| \`/privacy\` | \`pages/PrivacyPage.tsx\` | Політика конфіденційності | ✅ |
| \`/offer\` | \`pages/OfferPage.tsx\` | Публічна оферта | ✅ |
| \`/reviews\` | \`pages/ReviewsPage.tsx\` | Усі відгуки | ${mark("reviews", true)} |
| \`/promotions\` | \`pages/PromotionsPage.tsx\` | Акції | ${mark("promotions", true)} |
| \`/blog\` | \`pages/BlogPage.tsx\` | Блог-список | ${mark("blog")} |
| \`/blog/:slug\` | \`pages/BlogPostPage.tsx\` | Стаття блогу | ${mark("blog")} |
| \`/instagram\` | \`pages/InstagramPage.tsx\` | Стрічка Instagram + UGC | ${mark("instagram-feed")} |
| \`/wholesale\` | \`pages/WholesalePage.tsx\` | Лендінг опту | ${mark("wholesale")} |
| \`/wholesale-portal\` | \`pages/WholesalePortalPage.tsx\` | Кабінет оптового клієнта | ${mark("wholesale")} |
| \`/distributor-portal\` | \`pages/DistributorPortalPage.tsx\` | Кабінет дистриб'ютора | ${mark("wholesale")} |
| \`/distribution\` | \`pages/DistributionPage.tsx\` | Інформація про дистрибуцію | ${mark("wholesale")} |
| \`/wishlist\` | \`pages/WishlistPage.tsx\` | Список бажань | ${mark("wishlist", true)} |
| \`/checkout\` | \`pages/Checkout.tsx\` | Оформлення (адреса, доставка, оплата) | ✅ |
| \`/order-success/:id\` | \`pages/OrderSuccess.tsx\` | Дякую за замовлення + upsell | ✅ |
| \`/reorder/:orderId\` | \`pages/ReorderRedirect.tsx\` | 1-клік повтор замовлення (для push, email, бот, QR) | ✅ |
| \`/game\` | \`pages/SpinGamePage.tsx\` | Гра «Колесо удачі» для лідогенерації | ${mark("spin-game")} |
| \`/links\` | \`pages/LinksPage.tsx\` | Linktree-style hub (для QR / візиток) | ✅ |

## Авторизація

| Маршрут | Файл | Опис |
|---|---|---|
| \`/login\` | \`pages/Login.tsx\` | Вхід (email/password + OAuth) |
| \`/customer-login\` | \`pages/CustomerLogin.tsx\` | Спрощений вхід для клієнтів |
| \`/register\` | \`pages/Register.tsx\` | Реєстрація |
| \`/profile\` | \`pages/Profile.tsx\` | Кабінет (замовлення, бали, адреси) |
| \`/oauth-callback\` | \`pages/OAuthCallback.tsx\` | Google OAuth landing (Android App Link) |
| \`/tg-login\` | \`pages/TgLogin.tsx\` | Вхід через Telegram |

## Адмінка (29 розділів)

| Маршрут | Опис |
|---|---|
| \`/admin\` | CRM Dashboard |
| \`/admin/customers\` | CRM клієнти |
| \`/admin/orders\` | Замовлення |
| \`/admin/communication\` | Комунікації (email/sms/tg) |
| \`/admin/bot-users\` | Користувачі бота |
| \`/admin/products\` | Товари |
| \`/admin/reviews\` | Відгуки |
| \`/admin/promotions\` | Акції |
| \`/admin/promo-codes\` | Промокоди |
| \`/admin/managers\` | Менеджери |
| \`/admin/profiles\` | Ролі та доступи |
| \`/admin/settings\` | Налаштування магазину |
| \`/admin/seo-smm\` | SEO + SMM-планер |
| \`/admin/content\` | Контент CMS |
| \`/admin/wins\` | Журнал перемог |
| \`/admin/blog\` | Блог CMS |
| \`/admin/insights\` | ACOS Insights (з MARQ) |
| \`/admin/distributors\` | Дистриб'ютори |
| \`/admin/inbox\` | Inbox (всі канали) |
| \`/admin/bot\` | Налаштування бота |
| \`/admin/broadcasts\` | Розсилки |
| \`/admin/tribunal\` | Конфлікти агентів |
| \`/admin/launch\` | Launch Cockpit |
| \`/admin/debug\` | Debug Center |
| \`/admin/notifications\` | Сповіщення |
| \`/admin/api-keys\` | API ключі |
| \`/admin/outreach\` | Outreach campaigns |
| \`/admin/agents\` | AI-агенти (контроль) |
| \`/admin/ai-memory\` | Пам'ять AI |
| \`/admin/ai-actions\` | Дії AI |
| \`/admin/command-center\` | Tribunal Command Center |
| \`/tg-admin\` | Telegram міні-адмінка |

## Ключові компоненти (70+)

**Layout & nav**: Header, Footer, NavLink, LanguageSwitcher, ThemeToggle, Breadcrumbs, ScrollToTop, SkipToContent, SiteBackground

**Hero та головна**: HeroSection, HeroScrollHint, FeaturesBar, AboutSection, BestSellers, CatalogSection, WholesaleSection, WhyUsSection, ShopByNeed, NewsletterSignup, ReviewsSection, ContactsSection

**Каталог / товар**: ProductCheckoutPulse, QuickViewModal, ProductTrustSignals, ProductFAQ, ProductRelatedBlog, BlogRelatedProducts, ProductImpressionTracker, FrequentlyBoughtTogether, BundleOffer, RecentlyViewed, StockIndicator, PriceModeToggle, MobileFilterSheet, WishlistButton, SocialProofBanner, ScarcityBar

**Кошик / checkout**: CartDrawer, CartUpsell, FreeShippingProgress, HomeCartBooster, NovaPoshtaPicker, CheckoutTrustBadges, SmartCheckoutUpsell, PostPurchaseUpsell, ReorderButton, ReviewSubmissionForm

**Конверсійні та engagement**: ExitIntentPopup, LivePurchaseToasts, LiveSocialProofWidget, FloatingChatButton, FloatingInstagramButton, StickyMobileCTA, AndroidInstallPrompt, WebPushPrompt, ReferralPanel

**SEO та a11y**: Seo, SeoHead, PageSeo, ShareButtons, OptimizedImage, ErrorBoundary, IdleMount, PageSkeleton, PlatformGate

**Telegram**: TelegramLinkPanel, TelegramLoginButton

**Phone**: PhoneInputUA

## Контексти / Providers

- AuthContext — автентифікація
- CartContext — кошик
- PriceModeContext — режим цін (роздріб/опт)
- DataModeContext — джерела даних
- ThemeContext — тема (auto/light/dark)

---

_Цей інвентар — частина бренд-overlay архіву. Lovable AI прочитає його під час
ремiксу і застосує позначки ✅/🚫 щоб приховати чи показати фічі._
`;
}
