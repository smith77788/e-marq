/**
 * Apply an approved insight: executes the real side-effect for its type
 * (queue winback/broadcast messages, update price, rewrite SEO meta, create
 * a draft SEO page, push an owner checklist), writes an ai_actions log entry
 * and marks the insight as applied. Types without a handler are logged as
 * generic_apply with no side-effect.
 *
 * Body: { insight_id }
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authorizeAgentRequest, jsonError, jsonOk } from "@/lib/acos/agentRuntime";
import { readBootstrapFact } from "@/lib/acos/bootstrapFacts";
import { pickChannelForCustomer } from "@/lib/acos/channels";

function generateWinbackCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "WB-";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/**
 * churn_risk → реальний winback: створює персональний промокод і ставить
 * outbound-повідомлення клієнту з insight'а. Раніше це був no-op
 * (`{ note: "Action recorded." }`) — insight позначався applied, але клієнт
 * нічого не отримував.
 */
async function queueWinbackTouch(
  tenantId: string,
  metrics: { email?: string; customer_name?: string; suggested_discount_pct?: number },
  sourceInsightId: string,
): Promise<Record<string, unknown>> {
  const email = (metrics.email ?? "").trim().toLowerCase();
  if (!email) return { error: "missing_email_in_metrics" };

  const { data: customer } = await supabaseAdmin
    .from("customers")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .ilike("email", email)
    .maybeSingle();
  if (!customer) return { error: "customer_not_found" };

  const channel = await pickChannelForCustomer(customer.id);
  if (!channel) return { skipped: "no_consent_or_channel" };

  const discountPct = Math.min(50, Math.max(5, Math.round(metrics.suggested_discount_pct ?? 15)));
  const now = Date.now();
  const expiresAt = new Date(now + 30 * 24 * 3600 * 1000).toISOString();

  // Унікальний промокод (до 5 спроб при колізії)
  let code = "";
  let promoId: string | null = null;
  for (let attempt = 0; attempt < 5 && !promoId; attempt++) {
    const candidate = generateWinbackCode();
    const { data: inserted, error } = await supabaseAdmin
      .from("promotions")
      .insert({
        tenant_id: tenantId,
        code: candidate,
        name: `Winback −${discountPct}% (${customer.name ?? email})`,
        promo_type: "percent_off",
        value: discountPct,
        starts_at: new Date(now).toISOString(),
        ends_at: expiresAt,
        usage_limit: 1,
        usage_per_customer: 1,
        is_active: true,
        agent: "churn_risk_predictor",
      })
      .select("id, code")
      .maybeSingle();
    if (!error && inserted) {
      code = inserted.code ?? candidate;
      promoId = inserted.id;
    }
  }
  if (!promoId) return { error: "promo_code_generation_failed" };

  const firstName = (customer.name ?? "").split(" ")[0] || "there";
  const body =
    `${firstName}, ми скучили за вами! Ось ваш персональний промокод <b>${code}</b> ` +
    `на знижку −${discountPct}% на наступне замовлення. Діє 30 днів.`;

  const { error: msgErr } = await supabaseAdmin.from("outbound_messages").insert({
    tenant_id: tenantId,
    customer_id: customer.id,
    channel,
    trigger_kind: "winback",
    template_key: "winback.churn_touch.v1",
    body,
    status: "pending",
    metadata: { source_insight_id: sourceInsightId, promo_code: code } as never,
  });
  if (msgErr) return { error: msgErr.message };

  return { queued: 1, channel, promo_code: code, discount_pct: discountPct };
}

async function queueVipProductNudges(
  tenantId: string,
  productId: string,
  sourceInsightId: string,
): Promise<number> {
  const { data: product } = await supabaseAdmin
    .from("products")
    .select("id, name, price_cents")
    .eq("id", productId)
    .maybeSingle();
  if (!product) return 0;
  const { data: vips } = await supabaseAdmin
    .from("customers")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .eq("consent_marketing", true)
    .in("lifecycle_stage", ["vip", "active"])
    .gte("total_orders", 2)
    .limit(20);

  // Resolve channels sequentially (pickChannelForCustomer hits DB each call),
  // then batch-insert all rows in one query instead of N individual inserts.
  const rows = [];
  for (const c of vips ?? []) {
    const channel = await pickChannelForCustomer(c.id);
    if (!channel) continue;
    const firstName = (c.name ?? "").split(" ")[0] || "там";
    const body =
      `${firstName}, зверніть увагу на <b>${product.name}</b> — ` +
      `цей товар зараз дуже популярний. Додати у наступне замовлення?`;
    rows.push({
      tenant_id: tenantId,
      customer_id: c.id,
      channel,
      trigger_kind: "promo",
      template_key: "promo.feature_product.v1",
      body,
      status: "pending",
      expected_impact_cents: product.price_cents,
      related_product_id: product.id,
      metadata: { source_insight_id: sourceInsightId } as never,
    });
  }
  if (rows.length === 0) return 0;
  const { error } = await supabaseAdmin.from("outbound_messages").insert(rows);
  return error ? 0 : rows.length;
}

/** Unicode-aware slug: зберігає кирилицю, бо пошукові запити часто українські. */
function slugifyTerm(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
    .replace(/-$/, "");
}

/** Обрізає по межі слова, без обірваних ком/тире в кінці. */
function clipText(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const lastSpace = cut.lastIndexOf(" ");
  const clipped = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : t.slice(0, max);
  return clipped.replace(/[\s,;:.—-]+$/u, "");
}

function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>#|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSeoTitle(pageTitle: string, brandName: string): string {
  const base = pageTitle.trim();
  const withBrand =
    brandName && !base.toLowerCase().includes(brandName.toLowerCase())
      ? `${base} — ${brandName}`
      : base;
  return clipText(withBrand.length <= 60 ? withBrand : base, 60);
}

function buildSeoDescription(bodyMd: string | null, pageTitle: string, brandName: string): string {
  const excerpt = bodyMd ? stripMarkdown(bodyMd) : "";
  if (excerpt.length >= 50) return clipText(excerpt, 155);
  const brand = brandName || "нашому магазині";
  return clipText(
    `${pageTitle.trim()} — дізнайтесь більше у ${brand}: актуальні ціни, наявність і швидке замовлення онлайн.`,
    155,
  );
}

const BROADCAST_FANOUT_LIMIT = 500;

const ALLOWED_BROADCAST_THEMES = new Set([
  "generic",
  "dormant_reengagement",
  "new_arrival",
  "sale",
  "promo",
]);

/**
 * broadcast_suggestion → реальний fan-out: ставить outbound_messages
 * (trigger_kind='broadcast') кожному consenting-клієнту з готового драфта
 * broadcast-composer'а. Канал обираємо інлайн (telegram → email), щоб не
 * робити по запиту на клієнта. broadcast-roi агент далі міряє ROI цих розсилок.
 */
async function queueBroadcast(
  tenantId: string,
  metrics: { theme?: string; product_id?: string; draft_ua?: string; draft_en?: string },
  sourceInsightId: string,
): Promise<Record<string, unknown>> {
  const body = (metrics.draft_ua ?? metrics.draft_en ?? "").trim();
  if (!body) return { error: "missing_draft_in_metrics" };
  const rawTheme = (metrics.theme ?? "generic").replace(/[^a-z_]/g, "");
  const theme = ALLOWED_BROADCAST_THEMES.has(rawTheme) ? rawTheme : "generic";

  let q = supabaseAdmin
    .from("customers")
    .select("id, telegram_chat_id, email")
    .eq("tenant_id", tenantId)
    .eq("consent_marketing", true)
    .limit(BROADCAST_FANOUT_LIMIT);
  if (theme === "dormant_reengagement") {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
    q = q.gte("total_orders", 1).lte("last_order_at", thirtyDaysAgo);
  }
  const { data: audience, error } = await q;
  if (error) return { error: error.message };

  let skippedNoChannel = 0;
  const rows = [];
  for (const c of audience ?? []) {
    const channel = c.telegram_chat_id ? "telegram" : c.email ? "email" : null;
    if (!channel) {
      skippedNoChannel++;
      continue;
    }
    rows.push({
      tenant_id: tenantId,
      customer_id: c.id,
      channel,
      trigger_kind: "broadcast",
      template_key: `broadcast.${theme}.v1`,
      body,
      status: "pending",
      related_product_id: metrics.product_id ?? null,
      metadata: { source_insight_id: sourceInsightId, theme } as never,
    });
  }
  if (rows.length === 0)
    return { error: "no_eligible_audience", audience_size: audience?.length ?? 0 };

  const { error: insErr } = await supabaseAdmin.from("outbound_messages").insert(rows);
  if (insErr) return { error: insErr.message };
  return {
    queued: rows.length,
    skipped_no_channel: skippedNoChannel,
    theme,
    capped: (audience?.length ?? 0) >= BROADCAST_FANOUT_LIMIT,
  };
}

/**
 * search_gap → створює чернетку SEO-лендінгу під запит без результатів.
 * is_published=false: власник переглядає текст у site-builder і публікує сам.
 */
async function createSeoPageForSearchGap(
  tenantId: string,
  metrics: { search_term?: string },
  sourceInsightId: string,
): Promise<Record<string, unknown>> {
  const term = (metrics.search_term ?? "").trim();
  if (!term) return { error: "missing_search_term_in_metrics" };

  const slugBody = slugifyTerm(term);
  const slug = slugBody ? `search-${slugBody}` : `search-${sourceInsightId.slice(0, 8)}`;

  const { data: existing } = await supabaseAdmin
    .from("content_pages")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("slug", slug)
    .maybeSingle();
  if (existing) return { skipped: "page_exists", page_id: existing.id, slug };

  const [{ data: tenant }, { data: cfg }] = await Promise.all([
    supabaseAdmin.from("tenants").select("slug").eq("id", tenantId).maybeSingle(),
    supabaseAdmin
      .from("tenant_configs")
      .select("brand_name")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);
  const brand = cfg?.brand_name ?? "";

  // Споріднені товари за словами запиту (санітизуємо: кома/дужки ламають or-вираз PostgREST)
  const words = term
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{Letter}\p{Number}]/gu, ""))
    .filter((w) => w.length >= 3)
    .slice(0, 3);
  let related: Array<{ id: string; name: string }> = [];
  if (words.length > 0) {
    const { data } = await supabaseAdmin
      .from("products")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .or(words.map((w) => `name.ilike.%${w}%`).join(","))
      .limit(5);
    related = data ?? [];
  }

  const title = term.charAt(0).toUpperCase() + term.slice(1);
  const productLines = tenant?.slug
    ? related.map((p) => `- [${p.name}](/s/${tenant.slug}/products/${p.id})`)
    : related.map((p) => `- ${p.name}`);
  const bodyMd = [
    `## ${title}`,
    "",
    `Ви шукали «${term}» — ось що ми підібрали.`,
    "",
    ...(productLines.length > 0
      ? ["Можливо, вам підійде:", "", ...productLines]
      : ["Ми ще працюємо над цією категорією. Напишіть нам — підкажемо або додамо товар."]),
  ].join("\n");

  const { data: created, error } = await supabaseAdmin
    .from("content_pages")
    .insert({
      tenant_id: tenantId,
      slug,
      title,
      body_md: bodyMd,
      seo_title: buildSeoTitle(title, brand),
      seo_description: buildSeoDescription(null, title, brand),
      is_published: false,
      agent_generated: true,
      agent: "search_gap_detector",
      metadata: { source_insight_id: sourceInsightId, search_term: term } as never,
    })
    .select("id, slug")
    .single();
  if (error || !created) return { error: error?.message ?? "page_insert_failed" };
  return {
    page_id: created.id,
    slug: created.slug,
    published: false,
    related_products: related.length,
  };
}

/**
 * seo_rewrite_opportunity → детермінований rewrite seo_title/seo_description.
 * missing_seo: заповнюємо лише порожні поля. low_ctr: перезаписуємо обидва —
 * якщо CTR не зросте, seo-rewriter знову підніме insight.
 */
async function rewriteSeoMeta(
  tenantId: string,
  metrics: { page_id?: string; reason?: string },
): Promise<Record<string, unknown>> {
  if (!metrics.page_id) return { error: "missing_page_id_in_metrics" };

  const { data: page } = await supabaseAdmin
    .from("content_pages")
    .select("id, title, body_md, seo_title, seo_description")
    .eq("id", metrics.page_id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!page) return { error: "page_not_found" };

  const { data: cfg } = await supabaseAdmin
    .from("tenant_configs")
    .select("brand_name")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const brand = cfg?.brand_name ?? "";

  const newTitle = buildSeoTitle(page.title, brand);
  const newDesc = buildSeoDescription(page.body_md, page.title, brand);

  const update: { seo_title?: string; seo_description?: string } = {};
  if (metrics.reason === "missing_seo") {
    if (!page.seo_title) update.seo_title = newTitle;
    if (!page.seo_description) update.seo_description = newDesc;
  } else {
    if (newTitle !== page.seo_title) update.seo_title = newTitle;
    if (newDesc !== page.seo_description) update.seo_description = newDesc;
  }
  if (Object.keys(update).length === 0) return { skipped: "nothing_to_update" };

  const { error } = await supabaseAdmin
    .from("content_pages")
    .update(update)
    .eq("id", page.id)
    .eq("tenant_id", tenantId);
  if (error) return { error: error.message };
  return {
    updated_fields: Object.keys(update),
    old: { seo_title: page.seo_title, seo_description: page.seo_description },
    new: update,
  };
}

const CATALOG_NEEDS_BY_TYPE: Record<string, { keys: string[]; label: string }> = {
  bootstrap_catalog_missing_desc: { keys: ["description", "short_description"], label: "опис" },
  bootstrap_catalog_missing_cost: { keys: ["cost"], label: "собівартість" },
  bootstrap_catalog_missing_image: { keys: ["image"], label: "фото" },
};

/**
 * bootstrap_catalog_* → дані має заповнити людина, тому "apply" = надіслати
 * власнику конкретний чек-лист (owner_notifications → DB-тригер пушить у
 * Telegram з deep-link на каталог). Список товарів — з bootstrap_facts.
 */
async function queueCatalogChecklist(ins: InsightRow): Promise<Record<string, unknown>> {
  const need = CATALOG_NEEDS_BY_TYPE[ins.insight_type];
  if (!need) return { error: "unknown_catalog_insight_type" };

  const fact = await readBootstrapFact<{
    worst_offenders?: Array<{ id: string; name: string; missing: string[] }>;
  }>(ins.tenant_id, "catalog_quality");
  const offenders = (fact?.worst_offenders ?? []).filter((o) =>
    (o.missing ?? []).some((m) => need.keys.includes(m)),
  );
  const top = offenders.slice(0, 10);
  const count = (ins.metrics as { count?: number }).count ?? offenders.length;

  const body = [
    `Потрібно додати ${need.label} для ${count} товар(ів).`,
    ...(top.length > 0 ? ["Почніть з цих:", ...top.map((o) => `• ${o.name}`)] : []),
    ...(count > top.length && top.length > 0 ? [`…і ще ${count - top.length}.`] : []),
  ].join("\n");

  const { error } = await supabaseAdmin.from("owner_notifications").insert({
    tenant_id: ins.tenant_id,
    kind: "catalog_fix_checklist",
    severity: ins.risk_level === "high" ? "warning" : "info",
    title: ins.title,
    body,
    link: "/brand/products",
    metadata: {
      source_insight_id: ins.id,
      insight_type: ins.insight_type,
      product_ids: top.map((o) => o.id),
    } as never,
  });
  if (error) return { error: error.message };
  return { notification_created: true, products_listed: top.length, total_affected: count };
}

type InsightRow = {
  id: string;
  tenant_id: string;
  insight_type: string;
  affected_layer: string | null;
  title: string;
  expected_impact: string | null;
  metrics: Record<string, unknown>;
  status: string;
  risk_level: "low" | "medium" | "high";
};

const ACTION_BY_TYPE: Record<
  string,
  { action_type: string; agent_id: string; target_entity?: string }
> = {
  churn_risk: {
    action_type: "winback_touch",
    agent_id: "churn_risk_predictor",
    target_entity: "customer",
  },
  stockout_predicted: {
    action_type: "reorder_request",
    agent_id: "stockout_predictor",
    target_entity: "product",
  },
  aov_leak: {
    action_type: "abandoned_cart_email",
    agent_id: "aov_leak_detector",
    target_entity: "product",
  },
  search_gap: {
    action_type: "create_seo_page",
    agent_id: "search_gap_detector",
    target_entity: "search_term",
  },
  low_engagement_product: {
    action_type: "vip_product_nudge",
    agent_id: "aov_optimizer",
    target_entity: "product",
  },
  cart_abandon: {
    action_type: "vip_product_nudge",
    agent_id: "aov_optimizer",
    target_entity: "product",
  },
  price_optimization: {
    action_type: "update_price",
    agent_id: "price_optimizer",
    target_entity: "product",
  },
  price_revert: {
    action_type: "revert_price",
    agent_id: "price_revert_safety",
    target_entity: "product",
  },
  broadcast_suggestion: {
    action_type: "send_broadcast",
    agent_id: "broadcast-composer",
  },
  seo_rewrite_opportunity: {
    action_type: "rewrite_seo_meta",
    agent_id: "seo-rewriter",
    target_entity: "page",
  },
  bootstrap_catalog_missing_desc: {
    action_type: "catalog_fix_checklist",
    agent_id: "catalog_enricher",
  },
  bootstrap_catalog_missing_cost: {
    action_type: "catalog_fix_checklist",
    agent_id: "catalog_enricher",
  },
  bootstrap_catalog_missing_image: {
    action_type: "catalog_fix_checklist",
    agent_id: "catalog_enricher",
  },
};

async function applyPriceUpdate(
  tenantId: string,
  productId: string,
  metrics: { current_price_cents?: number; suggested_price_cents?: number },
): Promise<Record<string, unknown>> {
  const suggested = metrics.suggested_price_cents;
  if (!suggested || !Number.isInteger(suggested) || suggested <= 0) {
    return { error: "missing or invalid suggested_price_cents in metrics" };
  }
  // Fetch live price first so we record the actual baseline (not stale insight metric)
  const { data: prod } = await supabaseAdmin
    .from("products")
    .select("price_cents")
    .eq("id", productId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const oldPrice = prod?.price_cents ?? metrics.current_price_cents ?? null;
  const { error } = await supabaseAdmin
    .from("products")
    .update({ price_cents: suggested })
    .eq("id", productId)
    .eq("tenant_id", tenantId);
  if (error) return { error: error.message };
  return {
    old_price_cents: oldPrice,
    new_price_cents: suggested,
    delta_cents: oldPrice != null ? suggested - oldPrice : null,
  };
}

export const Route = createFileRoute("/hooks/actions/apply")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.replace(/^Bearer\s+/i, "").trim();
        let insightId: string | null = null;
        try {
          const body = (await request.json()) as { insight_id?: string };
          insightId = body.insight_id ?? null;
        } catch {
          return jsonError("Invalid JSON body", 400);
        }
        if (!insightId) return jsonError("insight_id required", 400);

        // Look up insight to learn tenant_id (needed for authz)
        const { data: insight, error: insErr } = await supabaseAdmin
          .from("ai_insights")
          .select(
            "id, tenant_id, insight_type, affected_layer, title, expected_impact, metrics, status, risk_level",
          )
          .eq("id", insightId)
          .single();
        if (insErr || !insight) return jsonError("Insight not found", 404);
        const ins = insight as InsightRow;

        const ctx = await authorizeAgentRequest(token, ins.tenant_id);
        if ("error" in ctx) return jsonError(ctx.error, ctx.status);

        // Повторний apply = повторний side-effect (подвійна розсилка, дубль
        // сторінки). Застосований insight більше не застосовуємо.
        if (ins.status === "applied") {
          return jsonOk({ skipped: true, reason: "already_applied" });
        }

        const mapping = ACTION_BY_TYPE[ins.insight_type] ?? {
          action_type: "generic_apply",
          agent_id: "orchestrator",
        };

        // Permission enforcement: when triggered by cron (autonomous loop),
        // only proceed if the owner has set this agent to `auto` mode AND the
        // insight risk does not exceed the configured ceiling. Manual
        // applications by owners/admins always pass through.
        if (ctx.kind === "cron") {
          const risk = ins.risk_level ?? "medium";
          const { data: allowed } = await supabaseAdmin.rpc("can_auto_apply_action", {
            _tenant_id: ins.tenant_id,
            _agent_id: mapping.agent_id,
            _risk: risk,
          });
          if (!allowed) {
            return jsonOk({
              skipped: true,
              reason: "permissions_blocked",
              agent_id: mapping.agent_id,
              risk,
            });
          }
        }

        const m = ins.metrics as {
          product_id?: string;
          page_id?: string;
          email?: string;
          search_term?: string;
          theme?: string;
          reason?: string;
          draft_ua?: string;
          draft_en?: string;
          current_price_cents?: number;
          suggested_price_cents?: number;
          source_action_id?: string;
        };
        const targetId =
          mapping.target_entity === "product"
            ? (m.product_id ?? null)
            : mapping.target_entity === "page"
              ? (m.page_id ?? null)
              : null;

        // Side effects per action_type
        let sideEffect: Record<string, unknown> = { note: "Action recorded." };
        if (mapping.action_type === "winback_touch") {
          sideEffect = await queueWinbackTouch(
            ins.tenant_id,
            ins.metrics as {
              email?: string;
              customer_name?: string;
              suggested_discount_pct?: number;
            },
            ins.id,
          );
        } else if (mapping.action_type === "send_broadcast") {
          sideEffect = await queueBroadcast(ins.tenant_id, m, ins.id);
        } else if (mapping.action_type === "create_seo_page") {
          sideEffect = await createSeoPageForSearchGap(ins.tenant_id, m, ins.id);
        } else if (mapping.action_type === "rewrite_seo_meta") {
          sideEffect = await rewriteSeoMeta(ins.tenant_id, m);
        } else if (mapping.action_type === "catalog_fix_checklist") {
          sideEffect = await queueCatalogChecklist(ins);
        } else if (mapping.action_type === "vip_product_nudge" && targetId) {
          const queued = await queueVipProductNudges(ins.tenant_id, targetId, ins.id);
          sideEffect = { queued_messages: queued };
        } else if (
          (mapping.action_type === "update_price" || mapping.action_type === "revert_price") &&
          targetId
        ) {
          sideEffect = await applyPriceUpdate(ins.tenant_id, targetId, m);
          if (mapping.action_type === "revert_price" && m.source_action_id) {
            // Mark the original update_price action as reverted
            await supabaseAdmin
              .from("ai_actions")
              .update({
                reverted_at: new Date().toISOString(),
                reverted_reason: `Conversion drop detected by ${mapping.agent_id}`,
              })
              .eq("id", m.source_action_id);
          }
        }

        const insertRow = {
          tenant_id: ins.tenant_id,
          agent_id: mapping.agent_id,
          source_insight_id: ins.id,
          action_type: mapping.action_type,
          target_entity: mapping.target_entity ?? null,
          target_id: targetId,
          status: "applied",
          applied_at: new Date().toISOString(),
          expected_impact: ins.expected_impact ?? null,
          parameters: {
            source_metrics: ins.metrics,
            triggered_by: ctx.kind,
          } as never,
          actual_result: sideEffect as never,
        };
        const { data: action, error: actErr } = await supabaseAdmin
          .from("ai_actions")
          .insert(insertRow)
          .select("id")
          .single();
        if (actErr || !action)
          return jsonError("Failed to log action", 500, { details: actErr?.message });

        const { error: updErr } = await supabaseAdmin
          .from("ai_insights")
          .update({ status: "applied" })
          .eq("id", ins.id);
        if (updErr) return jsonError("Failed to update insight", 500, { details: updErr.message });

        return jsonOk({ action_id: action.id, action_type: mapping.action_type });
      },
    },
  },
});
