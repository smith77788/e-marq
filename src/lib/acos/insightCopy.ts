/**
 * Перетворює сирі metrics ШІ-агентів на зрозумілий текст для власника бренду.
 *
 * Кожен агент кладе в metrics поля _copy_ua / _copy_en у вигляді:
 *   { headline, why, what_to_do }
 * UI читає їх замість сирого title/description, якщо вони є.
 *
 * Це централізує всю "людську мову" в одному файлі. Якщо завтра треба
 * перекласти на польську — додаємо ще одну функцію.
 */

export type InsightCopy = {
  /** 1 коротке речення, яке власник може зрозуміти за 2 секунди. */
  headline: string;
  /** Чому це важливо — переклад технічного обґрунтування на бізнес-мову. */
  why: string;
  /** Конкретна дія, яку запропонує "Apply". */
  what_to_do: string;
};

export type LocalizedCopy = { ua: InsightCopy; en: InsightCopy };

type M = Record<string, unknown>;
const num = (m: M, k: string, d = 0): number => (typeof m[k] === "number" ? (m[k] as number) : d);
const str = (m: M, k: string, d = ""): string => (typeof m[k] === "string" ? (m[k] as string) : d);
const cents = (c: number) => `$${(c / 100).toFixed(c >= 1000 ? 0 : 2)}`;

/** Map: insight_type → builder. Якщо тип незнайомий, повертаємо null і UI використає сирі поля. */
export function buildInsightCopy(insightType: string, metrics: M): LocalizedCopy | null {
  const fn = BUILDERS[insightType];
  if (!fn) return null;
  return fn(metrics);
}

const BUILDERS: Record<string, (m: M) => LocalizedCopy> = {
  // ---------- Stockout ----------
  stockout_predicted: (m) => {
    const name = str(m, "product_name", "товар");
    const dos = num(m, "days_of_supply");
    const reorder = num(m, "suggested_reorder_qty");
    const lost = num(m, "lost_revenue_7d_cents");
    return {
      ua: {
        headline: `${name} закінчиться через ~${dos.toFixed(1)} дн.`,
        why: `Якщо нічого не зробити, втратиш приблизно ${cents(lost)} продажів за наступний тиждень — клієнти прийдуть і не знайдуть товару.`,
        what_to_do: `Замов ще ~${reorder} шт. у постачальника, щоб запасу вистачило на 30 днів.`,
      },
      en: {
        headline: `${name} runs out in ~${dos.toFixed(1)} days`,
        why: `Doing nothing costs you roughly ${cents(lost)} in lost sales over the next 7 days — customers will arrive to an empty shelf.`,
        what_to_do: `Reorder ~${reorder} units from the supplier to cover the next 30 days.`,
      },
    };
  },

  // ---------- AOV ----------
  aov_drop_detected: (m) => {
    const drop = num(m, "drop_pct") * 100;
    return {
      ua: {
        headline: `Середній чек впав на ${drop.toFixed(0)}%`,
        why: `Покупці кладуть у кошик менше товарів, ніж зазвичай. Це з'їдає виторг навіть якщо трафік той самий.`,
        what_to_do: `Запустити upsell: пропонувати другий товар зі знижкою 10% на checkout.`,
      },
      en: {
        headline: `Average order value down ${drop.toFixed(0)}%`,
        why: `Buyers put fewer items per order than usual. Revenue suffers even if traffic stays flat.`,
        what_to_do: `Turn on upsell: offer a 2nd item at -10% on checkout.`,
      },
    };
  },
  aov_optimization: (m) => {
    const upliftCents = num(m, "uplift_cents");
    return {
      ua: {
        headline: "Можна підняти середній чек на простому правилі",
        why: `Знайдена пара товарів, яку часто беруть разом — пропозиція бандла дасть приблизно ${cents(upliftCents)} додатково на місяць.`,
        what_to_do: "Створити bundle і рекомендувати на сторінці продукту.",
      },
      en: {
        headline: "Easy AOV uplift available",
        why: `Found a frequently co-purchased pair — bundling them yields about ${cents(upliftCents)} extra per month.`,
        what_to_do: "Create a bundle and recommend on the product page.",
      },
    };
  },

  // ---------- Churn risk ----------
  churn_risk: (m) => {
    const count = num(m, "at_risk_count");
    return {
      ua: {
        headline: `${count} клієнтів готові піти`,
        why: "Вони купували регулярно, але вже давно не повертаються. За 30 днів зазвичай переходять у dormant і не повертаються.",
        what_to_do: "Надіслати персональний winback з нагадуванням і знижкою 10% (один клік нижче).",
      },
      en: {
        headline: `${count} customers about to churn`,
        why: "They bought regularly but haven't returned recently. Within 30 days most go dormant for good.",
        what_to_do: "Send a personal winback message with a 10% nudge (one click below).",
      },
    };
  },

  // ---------- Cart abandon ----------
  abandoned_cart: (m) => {
    const count = num(m, "carts_count");
    const value = num(m, "total_value_cents");
    return {
      ua: {
        headline: `${count} незавершених кошиків на ${cents(value)}`,
        why: "Покупці додали товар і пішли. У перші 24 години шанс повернути їх — найвищий, потім різко падає.",
        what_to_do: "Запустити нагадування з посиланням на checkout (через бот або email).",
      },
      en: {
        headline: `${count} abandoned carts worth ${cents(value)}`,
        why: "They added items and left. The first 24h have the highest recovery rate; it drops sharply after that.",
        what_to_do: "Send a reminder with a one-click checkout link (bot or email).",
      },
    };
  },

  // ---------- Reorder ----------
  reorder_due: (m) => {
    const count = num(m, "customers_due");
    return {
      ua: {
        headline: `${count} клієнтів готові до повторної покупки`,
        why: "За їхнім циклом замовлень час підтягувати — типово 60-80% з них куплять, якщо нагадати в правильний день.",
        what_to_do: "Відправити персональне нагадування з улюбленим товаром.",
      },
      en: {
        headline: `${count} customers due for a reorder`,
        why: "Based on their cycle, now is the moment — typically 60–80% will buy if reminded on the right day.",
        what_to_do: "Send a personal reminder with their favorite item.",
      },
    };
  },

  // ---------- Bot quality ----------
  bot_low_engagement: (m) => {
    const reply = num(m, "reply_rate") * 100;
    return {
      ua: {
        headline: `Бот відповідає холодно — ${reply.toFixed(0)}% відгуків`,
        why: "Покупці пишуть боту, але мало хто відповідає назад. Або тон шаблонів сухий, або бот пропускає важливі питання.",
        what_to_do: "Переписати найгірші шаблони людською мовою (1 клік — згенеруємо нову версію через ШІ).",
      },
      en: {
        headline: `Bot feels cold — only ${reply.toFixed(0)}% reply rate`,
        why: "People message the bot but few reply back. Templates likely sound robotic or miss key questions.",
        what_to_do: "Rewrite the worst templates in a human tone (1 click — we'll regenerate via AI).",
      },
    };
  },
  bot_high_performance: (m) => {
    const conv = num(m, "conversion_rate") * 100;
    return {
      ua: {
        headline: `Бот дає ${conv.toFixed(1)}% конверсії — це сильний результат`,
        why: "Шаблони працюють. Можна збільшити частоту або розширити сегменти, на які він пише.",
        what_to_do: "Розширити segmentation: додати ще один сегмент клієнтів до тих самих сценаріїв.",
      },
      en: {
        headline: `Bot is converting at ${conv.toFixed(1)}% — strong`,
        why: "Templates are working. You can ramp up frequency or expand to more segments.",
        what_to_do: "Expand segmentation: add another customer segment to the same playbooks.",
      },
    };
  },

  // ---------- Search gap ----------
  search_gap: (m) => {
    const term = str(m, "search_term", "запит");
    const misses = num(m, "searches_zero_results");
    return {
      ua: {
        headline: `Шукають "${term}", але не знаходять (${misses} разів)`,
        why: "Це гарячий попит — люди вже хочуть купити, але товару немає в каталозі. Або додай товар, або редирект на схожий.",
        what_to_do: `Додати продукт під цей запит АБО створити landing-сторінку для SEO.`,
      },
      en: {
        headline: `Customers search for "${term}" but find nothing (${misses} times)`,
        why: "Hot demand — they're ready to buy but the product isn't in your catalog. Add it or redirect to a similar one.",
        what_to_do: "Add a matching product OR build a SEO landing page for this query.",
      },
    };
  },

  // ---------- Segmentation ----------
  segment_at_risk_cohort: (m) => {
    const count = num(m, "count");
    return {
      ua: {
        headline: `${count} клієнтів зайшли в "at risk"`,
        why: "Вони не замовляли 60-120 днів. Без нагадування половина з них стане dormant назавжди.",
        what_to_do: "Запустити winback-кампанію з 15% знижкою для всього сегменту.",
      },
      en: {
        headline: `${count} customers slipped into "at risk"`,
        why: "They haven't ordered in 60–120 days. Without a nudge about half will go dormant for good.",
        what_to_do: "Launch a winback campaign with a 15% offer to the whole cohort.",
      },
    };
  },

  // ---------- Price ----------
  price_optimization: (m) => {
    const upliftPct = num(m, "uplift_pct") * 100;
    return {
      ua: {
        headline: `Ціна нижча за ринкову — можна підняти на ${upliftPct.toFixed(0)}%`,
        why: "За еластичністю попиту і конверсії, на цьому товарі ти лишаєш гроші на столі.",
        what_to_do: "Підняти ціну поетапно (один клік — застосує A/B на 50% трафіку).",
      },
      en: {
        headline: `Price below market — can lift ~${upliftPct.toFixed(0)}%`,
        why: "Demand elasticity & conversion data show you're leaving money on the table on this SKU.",
        what_to_do: "Raise price gradually (1 click — applies A/B on 50% of traffic).",
      },
    };
  },
};
