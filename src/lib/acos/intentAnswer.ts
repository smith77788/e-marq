/**
 * Intent-based детермінований "AI" — заміна LLM-completions.
 *
 * Розпізнає намір користувача за ключовими словами (UA + EN) і генерує
 * відповідь на основі реальних метрик тенанта. Жодних викликів зовнішніх
 * AI — повністю безкоштовно й передбачувано.
 *
 * Покриває найчастіші питання власника:
 *   - виторг / orders / AOV
 *   - інсайти / ризики
 *   - агенти / їхній стан
 *   - склад / out-of-stock
 *   - клієнти / churn
 *   - "що робити" / "next step" → найвагоміший pending insight
 */

export type IntentContext = {
  brand: string;
  revenue30_cents: number;
  orders30: number;
  aov_cents: number;
  insights: Array<{
    title: string;
    type: string;
    risk: string;
    status: string;
    expected_impact?: string | null;
  }>;
  products: Array<{ name: string; stock: number | null; price_cents: number | null }>;
  agents: Array<{ id: string; score: number; failed: number; total: number }>;
};

export type Suggestion = { label: string; to: string };

const fmtMoney = (cents: number) =>
  `${(cents / 100).toLocaleString("uk-UA", { maximumFractionDigits: 0 })} грн`;

function matches(q: string, kw: string[]): boolean {
  const low = q.toLowerCase();
  return kw.some((k) => low.includes(k));
}

const KW = {
  revenue: ["виторг", "виручк", "доход", "revenue", "продаж", "sales", "оборот"],
  orders: ["замовлен", "order", "продажі", "purchases"],
  aov: ["aov", "середн", "чек", "average order"],
  insights: ["інсайт", "insight", "поради", "що робити", "next step", "рекоменд", "what to do"],
  agents: ["агент", "agent", "бот", "bot", "автомат"],
  stock: ["склад", "stock", "залишк", "out of stock", "закінч", "inventory"],
  customers: ["клієнт", "customer", "покупц", "churn", "відтік"],
  health: ["здоров", "health", "статус", "помилк", "error", "fail", "збій"],
  promo: ["промо", "promo", "знижк", "discount", "акці"],
  email: ["email", "імейл", "пошт", "розсил", "mailing"],
};

export function answerIntent(question: string, ctx: IntentContext): {
  answer: string;
  suggestions: Suggestion[];
} {
  const q = question.trim();
  const pending = ctx.insights.filter((i) => i.status === "pending");
  const high = pending.filter((i) => i.risk === "high" || i.risk === "critical");

  // 1. Виторг / продажі / orders / AOV
  if (matches(q, KW.revenue) || matches(q, KW.orders) || matches(q, KW.aov)) {
    const trend = ctx.orders30 > 0
      ? `Середній чек — ${fmtMoney(ctx.aov_cents)}.`
      : "Замовлень за 30 днів немає — варто перевірити трекінг та канали залучення.";
    return {
      answer: `За останні 30 днів: ${ctx.orders30} замовлень на ${fmtMoney(ctx.revenue30_cents)}. ${trend}`,
      suggestions: [
        { label: "Усі замовлення", to: "/brand/orders" },
        { label: "Динаміка виторгу", to: "/brand" },
        { label: "Промо-портфель", to: "/brand/promotions" },
      ],
    };
  }

  // 2. Інсайти / "що робити"
  if (matches(q, KW.insights)) {
    if (pending.length === 0) {
      return {
        answer: `Активних інсайтів немає. Усі попередні рекомендації відпрацьовані або ще не з'явилися. Продовжуй збирати дані — агенти запропонують нові ідеї.`,
        suggestions: [
          { label: "Бібліотека агентів", to: "/agents/library" },
          { label: "Запуски агентів", to: "/agents/live" },
        ],
      };
    }
    const top = pending[0];
    const riskLabel = top.risk === "high" || top.risk === "critical" ? " ⚠️ високий ризик" : "";
    return {
      answer: `Активних інсайтів: ${pending.length} (з них ${high.length} високого ризику). Найважливіший: «${top.title}»${riskLabel}.${top.expected_impact ? ` Очікуваний ефект: ${top.expected_impact}.` : ""}`,
      suggestions: [
        { label: "Відкрити інсайти", to: "/brand#insights" },
        { label: "Запуски агентів", to: "/agents/live" },
      ],
    };
  }

  // 3. Агенти / їхній стан
  if (matches(q, KW.agents) || matches(q, KW.health)) {
    const totalRuns = ctx.agents.reduce((s, a) => s + a.total, 0);
    const totalFails = ctx.agents.reduce((s, a) => s + a.failed, 0);
    const avgScore = ctx.agents.length
      ? Math.round((ctx.agents.reduce((s, a) => s + a.score, 0) / ctx.agents.length) * 10) / 10
      : 0;
    const worst = [...ctx.agents].sort((a, b) => a.score - b.score)[0];
    const worstLine = worst
      ? ` Найслабший — ${worst.id} (score ${worst.score}, ${worst.failed}/${worst.total} fail).`
      : "";
    return {
      answer: `Агенти: ${ctx.agents.length} активних, середній health ${avgScore}/100. Загалом запусків: ${totalRuns}, помилок: ${totalFails}.${worstLine}`,
      suggestions: [
        { label: "Live-запуски", to: "/agents/live" },
        { label: "Бібліотека", to: "/agents/library" },
      ],
    };
  }

  // 4. Склад / out-of-stock
  if (matches(q, KW.stock)) {
    const oos = ctx.products.filter((p) => (p.stock ?? 0) <= 0);
    const low = ctx.products.filter((p) => (p.stock ?? 0) > 0 && (p.stock ?? 0) <= 5);
    if (oos.length === 0 && low.length === 0) {
      return {
        answer: `Склад у нормі — серед топ-${ctx.products.length} товарів немає out-of-stock чи критично низьких залишків.`,
        suggestions: [{ label: "Каталог товарів", to: "/brand/products" }],
      };
    }
    const oosNames = oos.slice(0, 3).map((p) => p.name).join(", ");
    return {
      answer: `Out-of-stock: ${oos.length}${oosNames ? ` (${oosNames}${oos.length > 3 ? "…" : ""})` : ""}. Низький залишок (≤5): ${low.length}. Варто запустити restock-нотифікації.`,
      suggestions: [
        { label: "Каталог", to: "/brand/products" },
        { label: "Промо-портфель", to: "/brand/promotions" },
      ],
    };
  }

  // 5. Клієнти / churn
  if (matches(q, KW.customers)) {
    return {
      answer: `Деталі по клієнтах і lifecycle-сегментах — у дашборді бренду. Перевір розподіл по етапах та winback-черги.`,
      suggestions: [
        { label: "Дашборд бренду", to: "/brand" },
        { label: "Email-кампанії", to: "/brand/email" },
      ],
    };
  }

  // 6. Промо / знижки
  if (matches(q, KW.promo)) {
    return {
      answer: `Промо-портфель і генератор bulk-промо — на сторінці промоакцій. Ризик "промо-втоми" відстежує окремий агент.`,
      suggestions: [{ label: "Промо-портфель", to: "/brand/promotions" }],
    };
  }

  // 7. Email
  if (matches(q, KW.email)) {
    return {
      answer: `Email-канали, домен і автоматизації (cart-recovery, post-purchase, winback) — у розділі Email.`,
      suggestions: [
        { label: "Email", to: "/brand/email" },
        { label: "Інтеграції", to: "/brand/integrations" },
      ],
    };
  }

  // 8. Default — загальний бриф
  const briefParts: string[] = [];
  briefParts.push(`30 днів: ${ctx.orders30} замовлень на ${fmtMoney(ctx.revenue30_cents)}`);
  if (ctx.aov_cents > 0) briefParts.push(`AOV ${fmtMoney(ctx.aov_cents)}`);
  briefParts.push(`pending інсайтів: ${pending.length}${high.length ? ` (${high.length} high-risk)` : ""}`);
  return {
    answer: `${briefParts.join(", ")}. Уточни питання — наприклад: "що з виторгом?", "які інсайти?", "стан агентів", "що зі складом?".`,
    suggestions: [
      { label: "Дашборд", to: "/brand" },
      { label: "Інсайти", to: "/brand#insights" },
      { label: "Агенти", to: "/agents/live" },
    ],
  };
}
