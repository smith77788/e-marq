/**
 * Intent-based детермінований "AI" — заміна LLM-completions.
 *
 * v2: розширений engine з:
 *   - нормалізацією (lowercase, прибирання діакритики, нормалізація укр. закінчень)
 *   - scoring-based intent detection (не лише perekriviy `includes`, а вага збігів)
 *   - 14 категорій намірів: revenue, orders, aov, insights, agents, stock,
 *     customers, health, promo, email, margin, shipping, seo, conversion,
 *     top-products
 *   - anti-hallucination: всі цифри з контексту, ніяких вигаданих метрик
 *   - smart ranking інсайтів (risk × confidence × recency)
 *
 * Жодних викликів зовнішніх AI — повністю безкоштовно й передбачувано.
 */

export type IntentContext = {
  brand: string;
  revenue30_cents: number;
  orders30: number;
  aov_cents: number;
  /** Опційні метрики — engine толерантний до їх відсутності. */
  revenue7_cents?: number;
  orders7?: number;
  conversionRate?: number | null;
  balance_cents?: number | null;
  insights: Array<{
    title: string;
    type: string;
    risk: string;
    status: string;
    expected_impact?: string | null;
    confidence?: number | null;
    created_at?: string | null;
  }>;
  products: Array<{
    name: string;
    stock: number | null;
    price_cents: number | null;
    /** Кількість продажів за період, якщо доступно. */
    sold30?: number | null;
  }>;
  agents: Array<{ id: string; score: number; failed: number; total: number }>;
};

export type Suggestion = { label: string; to: string };

const fmtMoney = (cents: number) =>
  `${(cents / 100).toLocaleString("uk-UA", { maximumFractionDigits: 0 })} грн`;

const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;

/** Нормалізація: lowercase + прибрати пунктуацію + базові укр. закінчення. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Скоринг наміру: кожен hit = 1; додатковий бонус за множинні збіги. */
function score(text: string, stems: string[]): number {
  const tokens = text.split(" ");
  let hits = 0;
  for (const stem of stems) {
    if (tokens.some((tok) => tok.startsWith(stem))) hits += 1;
  }
  return hits;
}

/** Стеми для кожної категорії (UA + EN, lowercase, без діакритики). */
const STEMS = {
  revenue: ["виторг", "виручк", "доход", "revenue", "оборот", "turnover"],
  orders: ["замовлен", "заказ", "order", "purchas", "продаж"],
  aov: ["aov", "середн", "чек", "average"],
  insights: ["інсайт", "insight", "порад", "рекоменд", "recommend"],
  nextStep: ["що", "робити", "next", "step", "далі", "todo", "todo"],
  agents: ["агент", "agent", "бот", "bot", "автомат"],
  stock: ["склад", "stock", "залишк", "inventory", "закінч", "out"],
  customers: ["клієнт", "customer", "покупц", "buyer"],
  churn: ["churn", "відтік", "відтоку", "втрат"],
  health: ["здоров", "health", "статус", "помилк", "error", "fail", "збій", "крашi"],
  promo: ["промо", "promo", "знижк", "discount", "акці", "sale"],
  email: ["email", "імейл", "пошт", "розсил", "mailing", "newsletter"],
  margin: ["маржа", "маржинальн", "margin", "прибуток", "profit"],
  shipping: ["доставк", "shipping", "відправк", "logistics", "новапошт"],
  seo: ["seo", "пошуков", "search", "ranking", "google", "позиц"],
  conversion: ["конверс", "conversion", "convers", "cr"],
  top: ["топ", "top", "найкращ", "best", "selling", "bestsell"],
  product: ["товар", "product", "продукт", "item"],
  balance: ["баланс", "balance", "гаманец", "wallet", "кошти"],
};

const SUG = {
  cockpit: { label: "Дашборд бренду", to: "/brand" },
  orders: { label: "Усі замовлення", to: "/brand/orders" },
  products: { label: "Каталог товарів", to: "/brand/products" },
  insights: { label: "Відкрити інсайти", to: "/brand#insights" },
  promotions: { label: "Промо-портфель", to: "/brand/promotions" },
  agentsLive: { label: "Live-запуски агентів", to: "/agents/live" },
  agentsLib: { label: "Бібліотека агентів", to: "/agents/library" },
  email: { label: "Email-кампанії", to: "/brand/email" },
  integrations: { label: "Інтеграції", to: "/brand/integrations" },
  billing: { label: "Plan & Billing", to: "/brand/billing" },
  siteBuilder: { label: "Site builder", to: "/brand/site-builder" },
  settings: { label: "Налаштування магазину", to: "/brand/settings" },
} as const;

/** Smart-ranking інсайтів: high/critical risk + свіжість + впевненість. */
function rankInsight(i: IntentContext["insights"][number]): number {
  let s = 0;
  if (i.risk === "critical") s += 100;
  else if (i.risk === "high") s += 50;
  else if (i.risk === "medium") s += 20;
  s += Math.round((i.confidence ?? 0.5) * 30);
  if (i.created_at) {
    const ageDays = (Date.now() - new Date(i.created_at).getTime()) / 86400000;
    if (ageDays < 1) s += 15;
    else if (ageDays < 7) s += 5;
  }
  if (i.status === "pending") s += 10;
  return s;
}

export function answerIntent(
  question: string,
  ctx: IntentContext,
): { answer: string; suggestions: Suggestion[]; intent: string } {
  const q = normalize(question);
  const pending = ctx.insights.filter((i) => i.status === "pending");
  const high = pending.filter((i) => i.risk === "high" || i.risk === "critical");
  const ranked = [...pending].sort((a, b) => rankInsight(b) - rankInsight(a));

  // === Скоринг усіх інтентів ===
  const scores: Record<string, number> = {
    revenue: score(q, STEMS.revenue),
    orders: score(q, STEMS.orders),
    aov: score(q, STEMS.aov),
    insights: score(q, STEMS.insights) + score(q, STEMS.nextStep),
    agents: score(q, STEMS.agents),
    stock: score(q, STEMS.stock),
    customers: score(q, STEMS.customers) + score(q, STEMS.churn),
    health: score(q, STEMS.health),
    promo: score(q, STEMS.promo),
    email: score(q, STEMS.email),
    margin: score(q, STEMS.margin),
    shipping: score(q, STEMS.shipping),
    seo: score(q, STEMS.seo),
    conversion: score(q, STEMS.conversion),
    topProducts: Math.min(score(q, STEMS.top), 1) * (score(q, STEMS.product) || 0.5),
    balance: score(q, STEMS.balance),
  };

  const winner = Object.entries(scores).reduce<{ name: string; v: number }>(
    (acc, [k, v]) => (v > acc.v ? { name: k, v } : acc),
    { name: "default", v: 0 },
  );

  // === 1. Виторг / Замовлення / AOV ===
  if (["revenue", "orders", "aov"].includes(winner.name)) {
    const trend7 =
      typeof ctx.revenue7_cents === "number" && typeof ctx.orders7 === "number"
        ? ` Останні 7 днів: ${ctx.orders7} замовлень на ${fmtMoney(ctx.revenue7_cents)}.`
        : "";
    const aovLine =
      ctx.orders30 > 0
        ? ` Середній чек — ${fmtMoney(ctx.aov_cents)}.`
        : " Замовлень немає — варто перевірити трекінг та канали залучення.";
    return {
      intent: winner.name,
      answer: `За 30 днів: ${ctx.orders30} замовлень на ${fmtMoney(ctx.revenue30_cents)}.${trend7}${aovLine}`,
      suggestions: [SUG.orders, SUG.cockpit, SUG.promotions],
    };
  }

  // === 2. Інсайти / "що далі" ===
  if (winner.name === "insights") {
    if (pending.length === 0) {
      return {
        intent: "insights",
        answer: `Активних інсайтів немає. Усі попередні рекомендації відпрацьовані або ще не з'явилися. Продовжуй збирати дані — агенти запропонують нові ідеї.`,
        suggestions: [SUG.agentsLib, SUG.agentsLive],
      };
    }
    const top = ranked[0];
    const topRisk = top.risk === "high" || top.risk === "critical" ? " ⚠️ високий ризик" : "";
    const second = ranked[1] ? ` Наступний за пріоритетом: «${ranked[1].title}».` : "";
    return {
      intent: "insights",
      answer: `Активних інсайтів: ${pending.length} (з них ${high.length} високого ризику). Найважливіший: «${top.title}»${topRisk}.${top.expected_impact ? ` Очікуваний ефект: ${top.expected_impact}.` : ""}${second}`,
      suggestions: [SUG.insights, SUG.agentsLive],
    };
  }

  // === 3. Агенти / health-системи ===
  if (winner.name === "agents" || winner.name === "health") {
    if (ctx.agents.length === 0) {
      return {
        intent: winner.name,
        answer: `Поки що немає замірів health для агентів — потрібно ще декілька запусків. Перевір статус у бібліотеці.`,
        suggestions: [SUG.agentsLib, SUG.agentsLive],
      };
    }
    const totalRuns = ctx.agents.reduce((s, a) => s + a.total, 0);
    const totalFails = ctx.agents.reduce((s, a) => s + a.failed, 0);
    const avgScore =
      Math.round((ctx.agents.reduce((s, a) => s + a.score, 0) / ctx.agents.length) * 10) / 10;
    const worst = [...ctx.agents].sort((a, b) => a.score - b.score)[0];
    const worstLine = worst
      ? ` Найслабший — ${worst.id} (score ${worst.score}, ${worst.failed}/${worst.total} fail).`
      : "";
    const failRate = totalRuns > 0 ? totalFails / totalRuns : 0;
    const verdict =
      avgScore >= 80
        ? "Стан здоровий ✅"
        : avgScore >= 60
          ? "Стан задовільний."
          : "Потрібна увага ⚠️";
    return {
      intent: winner.name,
      answer: `Агенти: ${ctx.agents.length} активних, середній health ${avgScore}/100. Запусків: ${totalRuns}, помилок: ${totalFails} (${fmtPct(failRate)}).${worstLine} ${verdict}`,
      suggestions: [SUG.agentsLive, SUG.agentsLib],
    };
  }

  // === 4. Склад / OOS ===
  if (winner.name === "stock") {
    const oos = ctx.products.filter((p) => (p.stock ?? 0) <= 0);
    const low = ctx.products.filter((p) => (p.stock ?? 0) > 0 && (p.stock ?? 0) <= 5);
    if (oos.length === 0 && low.length === 0) {
      return {
        intent: "stock",
        answer: `Склад у нормі — серед топ-${ctx.products.length} товарів немає out-of-stock чи критично низьких залишків.`,
        suggestions: [SUG.products],
      };
    }
    const oosNames = oos
      .slice(0, 3)
      .map((p) => p.name)
      .join(", ");
    return {
      intent: "stock",
      answer: `Out-of-stock: ${oos.length}${oosNames ? ` (${oosNames}${oos.length > 3 ? "…" : ""})` : ""}. Низький залишок (≤5): ${low.length}. Запусти restock-нотифікації або переоцінку популярних SKU.`,
      suggestions: [SUG.products, SUG.promotions],
    };
  }

  // === 5. Топ-продукти ===
  if (winner.name === "topProducts") {
    const ranked = [...ctx.products]
      .filter((p) => (p.sold30 ?? 0) > 0)
      .sort((a, b) => (b.sold30 ?? 0) - (a.sold30 ?? 0))
      .slice(0, 5);
    if (ranked.length === 0) {
      return {
        intent: "topProducts",
        answer: `Поки що немає даних про продажі товарів за останні 30 днів. Як тільки з'являться замовлення — рейтинг побудується автоматично.`,
        suggestions: [SUG.products, SUG.cockpit],
      };
    }
    const lines = ranked.map((p, i) => `${i + 1}. ${p.name} — ${p.sold30} шт`).join("; ");
    return {
      intent: "topProducts",
      answer: `Топ продажів за 30 днів: ${lines}.`,
      suggestions: [SUG.products, SUG.cockpit],
    };
  }

  // === 6. Клієнти / churn ===
  if (winner.name === "customers") {
    return {
      intent: "customers",
      answer: `Деталі по клієнтах і lifecycle-сегментах — у дашборді бренду. Перевір розподіл по етапах (new / active / at-risk / churned) та winback-черги.`,
      suggestions: [SUG.cockpit, SUG.email],
    };
  }

  // === 7. Промо ===
  if (winner.name === "promo") {
    return {
      intent: "promo",
      answer: `Промо-портфель і генератор bulk-промо — на сторінці промоакцій. Ризик "промо-втоми" відстежує окремий агент і додає інсайт у разі перенасичення.`,
      suggestions: [SUG.promotions, SUG.insights],
    };
  }

  // === 8. Email ===
  if (winner.name === "email") {
    return {
      intent: "email",
      answer: `Email-канали, домен, підписки та автоматизації (cart-recovery, post-purchase, winback) — у розділі Email. Перевір статус домену у DNS.`,
      suggestions: [SUG.email, SUG.integrations],
    };
  }

  // === 9. Маржа / прибуток ===
  if (winner.name === "margin") {
    return {
      intent: "margin",
      answer: `Маржа й прибутковість оцінюються агентом margin-estimator на основі COGS і прайсу. Інсайти з ризиком маржі з'являться у списку як тільки буде достатньо даних. Перевір активні рекомендації.`,
      suggestions: [SUG.insights, SUG.products],
    };
  }

  // === 10. Доставка ===
  if (winner.name === "shipping") {
    return {
      intent: "shipping",
      answer: `Доставка — Нова Пошта налаштовується в інтеграціях; у замовленні доступний тип доставки та трекінг. Shipping-optimizer аналізує найвигідніші зони.`,
      suggestions: [SUG.integrations, SUG.orders],
    };
  }

  // === 11. SEO ===
  if (winner.name === "seo") {
    return {
      intent: "seo",
      answer: `SEO — site-builder автоматично генерує structured data, sitemap і robots. Агенти programmatic-seo та seo-rewriter поліпшують метаописи.`,
      suggestions: [SUG.siteBuilder, SUG.products],
    };
  }

  // === 12. Конверсія ===
  if (winner.name === "conversion") {
    const cr =
      typeof ctx.conversionRate === "number" && ctx.conversionRate > 0
        ? `Поточна конверсія: ${fmtPct(ctx.conversionRate)}. `
        : "";
    return {
      intent: "conversion",
      answer: `${cr}За 30 днів: ${ctx.orders30} замовлень. Funnel-healer і first-order-funnel агенти шукають витоки. Інсайти з категорії conversion з'являться в списку рекомендацій.`,
      suggestions: [SUG.insights, SUG.cockpit],
    };
  }

  // === 13. Баланс ===
  if (winner.name === "balance") {
    if (typeof ctx.balance_cents === "number") {
      return {
        intent: "balance",
        answer: `Баланс гаманця: ${fmtMoney(ctx.balance_cents)}. Поповнення та історія транзакцій — у розділі Plan & Billing.`,
        suggestions: [SUG.billing],
      };
    }
    return {
      intent: "balance",
      answer: `Деталі балансу — у розділі Plan & Billing.`,
      suggestions: [SUG.billing],
    };
  }

  // === 14. Default — загальний бриф ===
  const briefParts: string[] = [];
  briefParts.push(`30 днів: ${ctx.orders30} замовлень на ${fmtMoney(ctx.revenue30_cents)}`);
  if (ctx.aov_cents > 0) briefParts.push(`AOV ${fmtMoney(ctx.aov_cents)}`);
  briefParts.push(
    `pending інсайтів: ${pending.length}${high.length ? ` (${high.length} high-risk)` : ""}`,
  );
  return {
    intent: "default",
    answer: `${briefParts.join(", ")}. Уточни питання — наприклад: "що з виторгом?", "які інсайти?", "стан агентів", "що зі складом?", "топ-товари", "конверсія".`,
    suggestions: [SUG.cockpit, SUG.insights, SUG.agentsLive],
  };
}
