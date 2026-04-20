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
  price_revert: (m) => {
    const dropPct = Math.round((1 - num(m, "drop_ratio", 1)) * 100);
    const oldP = num(m, "suggested_price_cents");
    const newP = num(m, "current_price_cents");
    return {
      ua: {
        headline: `Конверсія впала на ${dropPct}% — повертаю стару ціну`,
        why: `Після зміни ціни на ${cents(newP)} конверсія просіла на ${dropPct}% за 14 днів. Це втрачені продажі — безпечніше відкотити до ${cents(oldP)}.`,
        what_to_do: `Auto-revert вже виконано: ціна повернута на ${cents(oldP)}. Перевір лог дій якщо хочеш скасувати.`,
      },
      en: {
        headline: `Conversion dropped ${dropPct}% — rolling price back`,
        why: `After moving price to ${cents(newP)}, conversion fell ${dropPct}% over 14 days. This is lost revenue — safer to revert to ${cents(oldP)}.`,
        what_to_do: `Auto-revert already applied: price restored to ${cents(oldP)}. Check actions log to undo.`,
      },
    };
  },

  // ---------- Onboarding / Setup ----------
  setup_no_products: () => ({
    ua: {
      headline: "Каталог порожній — додай перший товар",
      why: "Без товарів ні бот, ні агенти не можуть нічого продавати чи рекомендувати.",
      what_to_do: "Додай мінімум 3 SKU у розділі Products.",
    },
    en: {
      headline: "Catalog is empty — add your first product",
      why: "Without products neither the bot nor any agent has anything to sell or recommend.",
      what_to_do: "Add at least 3 SKUs in Products.",
    },
  }),
  setup_thin_catalog: (m) => {
    const n = num(m, "product_count");
    return {
      ua: {
        headline: `Лише ${n} товар${n === 1 ? "" : "ів"} — додай ще 2-3`,
        why: "Бренди з 3+ SKU мають у ~2× вищий середній чек завдяки крос-селлу.",
        what_to_do: "Додай ще декілька товарів — це відкриє AOV optimizer і бандли.",
      },
      en: {
        headline: `Only ${n} active product${n === 1 ? "" : "s"} — add 2-3 more`,
        why: "Brands with 3+ SKUs see ~2× higher AOV thanks to cross-sell.",
        what_to_do: "Add a couple more products — unlocks AOV optimizer and bundles.",
      },
    };
  },
  setup_no_orders: (m) => {
    const slug = str(m, "slug", "");
    return {
      ua: {
        headline: "Жодного замовлення — час на перший продаж",
        why: "Каталог працює, але ніхто ще не оформив. Перший платіж активує агентів churn/winback.",
        what_to_do: `Поділись посиланням /s/${slug} у соцмережах або з існуючою базою клієнтів.`,
      },
      en: {
        headline: "Zero orders so far — drive the first sale",
        why: "Storefront is live but no one checked out. First paid order activates churn/winback agents.",
        what_to_do: `Share /s/${slug} on social or with your existing customer list.`,
      },
    };
  },
  setup_pending_only: (m) => {
    const pending = num(m, "pending");
    return {
      ua: {
        headline: `${pending} замовлень у статусі pending — жодного оплаченого`,
        why: "Клієнти додають у кошик, але не завершують оплату. Найчастіша причина — немає реального процесора карток.",
        what_to_do: "Підключи Stripe — pending буде автоматично переходити в paid.",
      },
      en: {
        headline: `${pending} pending order${pending === 1 ? "" : "s"} — none paid yet`,
        why: "Customers add items but don't complete payment. Most common cause: no real card processor connected.",
        what_to_do: "Enable Stripe so pending orders auto-convert to paid.",
      },
    };
  },
  setup_no_telegram: (m) => {
    const slug = str(m, "slug", "");
    return {
      ua: {
        headline: "Telegram-бот не підв'язаний",
        why: "Без бота агенти win-back і reorder не мають як достукатися до клієнтів.",
        what_to_do: `Зі свого Telegram надішли /start ${slug} боту @Oauther_bot — це активує канал.`,
      },
      en: {
        headline: "Telegram bot not connected",
        why: "Without the bot, win-back & reorder agents have no way to reach customers.",
        what_to_do: `From your Telegram, send /start ${slug} to @Oauther_bot to activate the channel.`,
      },
    };
  },
  setup_no_tracking: () => ({
    ua: {
      headline: "Немає подій з сайту за 7 днів",
      why: "Без трекінгу не видно які товари дивляться, де клієнти йдуть і що рекомендувати.",
      what_to_do: "Встав однорядковий tracking-snippet на свій сайт (готовий код у Setup).",
    },
    en: {
      headline: "No site events in last 7 days",
      why: "Without tracking we can't see what customers view, where they bounce or what to recommend.",
      what_to_do: "Paste the 1-line tracking snippet on your site (ready in Setup).",
    },
  }),
  setup_no_emails: (m) => {
    const c = num(m, "customers");
    return {
      ua: {
        headline: `${c} клієнт${c === 1 ? "" : "ів"}, але email не зібрано`,
        why: "Без email win-back / abandoned-cart можуть писати тільки в Telegram. Це урізає аудиторію вдвічі.",
        what_to_do: "Додай поле email у форму checkout.",
      },
      en: {
        headline: `${c} customer${c === 1 ? "" : "s"} but no email captured`,
        why: "Without email, win-back / abandoned-cart can only reach Telegram. Cuts reachable audience in half.",
        what_to_do: "Add an email field to your checkout form.",
      },
    };
  },
  milestone_first_sale: () => ({
    ua: {
      headline: "🎉 Перший платний продаж — пора масштабуватися",
      why: "Перша угода закрилась. Кожна наступна робить агентів розумнішими — після ~5 замовлень почнуть з'являтися реальні pattern-insights.",
      what_to_do: "Увімкни Telegram-бот, abandoned-cart і reorder-reminders — це працює саме на твоїх даних.",
    },
    en: {
      headline: "🎉 First paid order — time to scale",
      why: "Your first sale closed. Each new order makes agents smarter — after ~5 orders real pattern insights start appearing.",
      what_to_do: "Turn on Telegram bot, abandoned-cart and reorder-reminders — they compound on your real data.",
    },
  }),

  // ---------- Margin Optimizer ----------
  margin_negative: (m) => {
    const name = str(m, "product_name", "товар");
    const loss = num(m, "monthly_loss_cents");
    const suggested = num(m, "suggested_price_cents");
    return {
      ua: {
        headline: `${name}: продаєш у збиток`,
        why: `Ціна нижче собівартості. За поточного volume втрачаєш приблизно ${cents(loss)} на місяць.`,
        what_to_do: `Підняти ціну до ${cents(suggested)} (беззбитковість + 20% маржі).`,
      },
      en: {
        headline: `${name}: selling below cost`,
        why: `Price is under unit cost. At current volume that's a loss of ~${cents(loss)} per month.`,
        what_to_do: `Raise price to ${cents(suggested)} (breakeven + 20% margin).`,
      },
    };
  },
  margin_low_lift: (m) => {
    const name = str(m, "product_name", "товар");
    const lift = num(m, "lift_pct") * 100;
    const extra = num(m, "expected_monthly_lift_cents");
    const suggested = num(m, "suggested_price_cents");
    return {
      ua: {
        headline: `${name}: можна підняти ціну на ${lift.toFixed(0)}%`,
        why: `Високий volume + низька маржа. Невелике підняття ціни не вб'є попит, але дасть ~${cents(extra)} додаткової маржі на місяць.`,
        what_to_do: `Підняти ціну до ${cents(suggested)} і моніторити конверсію 14 днів.`,
      },
      en: {
        headline: `${name}: room to raise price by ${lift.toFixed(0)}%`,
        why: `High volume + thin margin. A small bump won't kill demand and adds ~${cents(extra)} margin/month.`,
        what_to_do: `Raise to ${cents(suggested)} and watch conversion for 14 days.`,
      },
    };
  },

  // ---------- LTV / Churn ----------
  high_value_churn_risk: (m) => {
    const name = str(m, "customer_name", "VIP");
    const ltv = num(m, "predicted_ltv_cents");
    const days = num(m, "days_since_last_order");
    return {
      ua: {
        headline: `${name}: VIP-клієнт йде`,
        why: `Predicted LTV ${cents(ltv)} на 12 міс, але не купував ${days} днів — ризик відтоку понад 70%.`,
        what_to_do: `Персональний win-back: знижка 15% або безкоштовна доставка на наступне замовлення.`,
      },
      en: {
        headline: `${name}: high-value customer at risk`,
        why: `Predicted LTV ${cents(ltv)} over 12mo, but ${days} days silent — churn risk >70%.`,
        what_to_do: `Personal win-back: 15% off or free shipping on next order.`,
      },
    };
  },

  // ---------- Cart Abandonment ----------
  cart_abandoned: (m) => {
    const name = str(m, "customer_name", "Клієнт");
    const value = num(m, "cart_value_cents");
    const items = num(m, "product_count");
    return {
      ua: {
        headline: `${name} покинув кошик ${cents(value)}`,
        why: `Додав ${items} товарів і пішов. Recovery email конвертить ~15-20%.`,
        what_to_do: `Надіслати follow-up email з нагадуванням і опційною знижкою 10%.`,
      },
      en: {
        headline: `${name} abandoned cart ${cents(value)}`,
        why: `${items} items added then left. Recovery emails convert at ~15-20%.`,
        what_to_do: `Send follow-up email with reminder + optional 10% off.`,
      },
    };
  },

  // ---------- Anomaly Detector ----------
  revenue_drop: (m) => {
    const delta = Math.abs(num(m, "delta_pct") * 100);
    const today = num(m, "today_revenue_cents");
    const base = num(m, "baseline_revenue_cents");
    return {
      ua: {
        headline: `Виторг впав на ${delta.toFixed(0)}%`,
        why: `Сьогодні ${cents(today)} проти середніх ${cents(base)}. Це не випадковість — потрібна перевірка.`,
        what_to_do: `Перевір: трафік, checkout, останні зміни ціни/контенту.`,
      },
      en: {
        headline: `Revenue down ${delta.toFixed(0)}%`,
        why: `Today ${cents(today)} vs baseline ${cents(base)}. This is beyond normal variance.`,
        what_to_do: `Check: traffic source, checkout flow, recent price/content changes.`,
      },
    };
  },
  revenue_spike: (m) => {
    const delta = num(m, "delta_pct") * 100;
    return {
      ua: {
        headline: `Виторг виріс на ${delta.toFixed(0)}%`,
        why: "Знайшов щось що працює. Зрозумій причину і повтори.",
        what_to_do: "Перевір атрибуцію останніх замовлень — який канал/кампанія дала ріст.",
      },
      en: {
        headline: `Revenue up ${delta.toFixed(0)}%`,
        why: "Something is working. Identify the cause and double down.",
        what_to_do: "Check attribution on today's orders — which channel/campaign drove the lift.",
      },
    };
  },
  orders_drop: (m) => {
    const delta = Math.abs(num(m, "delta_pct") * 100);
    return {
      ua: {
        headline: `Замовлень на ${delta.toFixed(0)}% менше`,
        why: "Кількість замовлень нижча за норму. Швидше за все: трафік або checkout-friction.",
        what_to_do: "Перевір funnel — на якому кроці клієнти відвалюються.",
      },
      en: {
        headline: `Orders down ${delta.toFixed(0)}%`,
        why: "Order count is below normal. Likely cause: traffic drop or checkout friction.",
        what_to_do: "Check funnel — which step is leaking.",
      },
    };
  },
  orders_spike: () => ({
    ua: {
      headline: "Замовлень помітно більше",
      why: "Скейлиш — добре. Перевір що інвентар витримає.",
      what_to_do: "Глянь stockout-прогноз для top-продуктів.",
    },
    en: {
      headline: "Orders noticeably up",
      why: "Scale moment — good. Check inventory can keep up.",
      what_to_do: "Review stockout forecast for top sellers.",
    },
  }),
  traffic_drop: (m) => {
    const delta = Math.abs(num(m, "delta_pct") * 100);
    return {
      ua: {
        headline: `Трафік впав на ${delta.toFixed(0)}%`,
        why: "Менше відвідувачів = менше шансів на продаж.",
        what_to_do: "Перевір SEO-позиції, ad-кампанії, email-розсилки за останні 3 дні.",
      },
      en: {
        headline: `Traffic down ${delta.toFixed(0)}%`,
        why: "Fewer visitors = fewer chances to convert.",
        what_to_do: "Check SEO rankings, ad campaigns, email sends for last 3 days.",
      },
    };
  },
  traffic_spike: () => ({
    ua: {
      headline: "Сплеск трафіку",
      why: "Добре. Перевір чи конвертує — інакше це just expensive eyeballs.",
      what_to_do: "Глянь conversion rate — якщо нижчий за середній, посилюй CTA.",
    },
    en: {
      headline: "Traffic spike",
      why: "Good. Make sure it converts — otherwise it's just expensive eyeballs.",
      what_to_do: "Check conversion rate — if below average, strengthen CTA.",
    },
  }),

  // ---------- Batch 2: Bundles ----------
  bundle_opportunity: (m) => {
    const a = str(m, "product_a_name", "Товар А");
    const b = str(m, "product_b_name", "Товар Б");
    const lift = num(m, "lift_score");
    const count = num(m, "co_purchase_count");
    const price = num(m, "suggested_bundle_price_cents");
    return {
      ua: {
        headline: `Бандл: ${a} + ${b}`,
        why: `Куплені разом ${count} раз${count === 1 ? "" : "и"} — це у ${lift.toFixed(1)}× частіше за випадковість. Бандл збільшить AOV без зусиль.`,
        what_to_do: `Створити bundle за ${cents(price)} (-10%) і показати на сторінці кожного з товарів.`,
      },
      en: {
        headline: `Bundle: ${a} + ${b}`,
        why: `Co-purchased ${count} time${count === 1 ? "" : "s"} — that's ${lift.toFixed(1)}× more often than random. Bundling lifts AOV with no effort.`,
        what_to_do: `Create a bundle at ${cents(price)} (-10%) and show on each product page.`,
      },
    };
  },

  // ---------- Batch 2: Promo Fatigue / Portfolio ----------
  promo_fatigued: (m) => {
    const name = str(m, "promo_name", "промо");
    const fatigue = num(m, "fatigue_score") * 100;
    const roi = num(m, "roi");
    return {
      ua: {
        headline: `Промо "${name}" втомила (${fatigue.toFixed(0)}% fatigue)`,
        why: `Аудиторія перенасичена: utilization падає, ROI ${roi.toFixed(1)}×. Кожен наступний день з нею знижує ефект.`,
        what_to_do: `Поставити на паузу і запустити нову кампанію з іншим angle.`,
      },
      en: {
        headline: `Promo "${name}" fatigued (${fatigue.toFixed(0)}%)`,
        why: `Audience is saturated: utilization down, ROI ${roi.toFixed(1)}×. Every additional day reduces impact.`,
        what_to_do: `Pause it and launch a fresh campaign with a different angle.`,
      },
    };
  },
  promo_segment_gap: (m) => {
    const missing = (m.missing_segments as string[] | undefined) ?? [];
    return {
      ua: {
        headline: `Сегменти без промо: ${missing.join(", ")}`,
        why: "Ці клієнти не отримують релевантної знижки → потенційний виторг лежить незачеплений.",
        what_to_do: `Створити одну промо для сегменту "${missing[0]}" — типово +10-20% конверсії в когорті.`,
      },
      en: {
        headline: `Uncovered segments: ${missing.join(", ")}`,
        why: "These customers see no relevant offer → revenue is left on the table.",
        what_to_do: `Create one promo targeting "${missing[0]}" — typically lifts cohort conversion 10-20%.`,
      },
    };
  },
  promo_overlap: (m) => {
    const c = num(m, "overlapping_count");
    return {
      ua: {
        headline: `${c} продуктів під 2+ промо одночасно`,
        why: "Канібалізація: один товар отримує 2 знижки — клієнт користується найбільшою, ти втрачаєш маржу.",
        what_to_do: "Залишити по одній найкращій промо на продукт.",
      },
      en: {
        headline: `${c} products covered by 2+ promos`,
        why: "Cannibalization: one product gets stacked discounts — customer takes the biggest, you lose margin.",
        what_to_do: "Keep one best promo per product.",
      },
    };
  },
  promo_too_many: (m) => {
    const n = num(m, "active_promos");
    return {
      ua: {
        headline: `${n} активних промо — забагато`,
        why: "Понад 4-6 одночасних знижок розмивають сприйняття. 'Знижка' перестає бути подією.",
        what_to_do: "Залишити топ-4 за ROI, інші згорнути.",
      },
      en: {
        headline: `${n} active promos — too many`,
        why: "Over 4-6 concurrent discounts dilute perception. 'Sale' stops being an event.",
        what_to_do: "Keep top-4 by ROI, retire the rest.",
      },
    };
  },

  // ---------- Batch 2: Discount Elasticity ----------
  discount_sweet_spot: (m) => {
    const depth = num(m, "best_depth_pct");
    const roi = num(m, "best_roi");
    return {
      ua: {
        headline: `Знижка ${depth}% — оптимум (ROI ${roi.toFixed(1)}×)`,
        why: `Історично саме ця глибина знижки приносить найбільше повернення. Менше — мало мотивує, більше — з'їдає маржу.`,
        what_to_do: `Стандартизувати наступні промо на ${depth}%.`,
      },
      en: {
        headline: `${depth}% discount is the sweet spot (${roi.toFixed(1)}× ROI)`,
        why: `Historically this depth yields highest return. Less is too weak, more eats margin.`,
        what_to_do: `Standardize next promos at ${depth}%.`,
      },
    };
  },
  discount_negative_roi: (m) => {
    const depth = num(m, "bad_depth_pct");
    const roi = num(m, "bad_roi");
    return {
      ua: {
        headline: `Знижки ${depth}% збиткові (ROI ${roi.toFixed(2)}×)`,
        why: `На такій глибині повертається менше ніж витрачається — це чистий мінус по cash.`,
        what_to_do: `Прибрати знижки ${depth}% з playbook.`,
      },
      en: {
        headline: `${depth}% discounts are unprofitable (${roi.toFixed(2)}× ROI)`,
        why: `At this depth you get back less than you spend — net cash loss.`,
        what_to_do: `Remove ${depth}% discounts from the playbook.`,
      },
    };
  },

  // ---------- Batch 2: Predictive Pricing ----------
  price_predicted_optimal: (m) => {
    const name = str(m, "product_name", "товар");
    const cur = num(m, "current_price_cents");
    const sug = num(m, "suggested_price_cents");
    const elast = num(m, "elasticity");
    const uplift = num(m, "expected_monthly_uplift_cents");
    const dir = sug > cur ? "підняти" : "знизити";
    const dirEn = sug > cur ? "raise" : "lower";
    return {
      ua: {
        headline: `${name}: ${dir} ціну ${cents(cur)} → ${cents(sug)}`,
        why: `Еластичність попиту ${elast.toFixed(2)}. Ця ціна максимізує revenue на 60-денному вікні.`,
        what_to_do: uplift > 0 ? `Застосувати — очікуваний uplift ${cents(uplift)}/міс.` : `Застосувати — стабілізує виторг при поточному попиті.`,
      },
      en: {
        headline: `${name}: ${dirEn} price ${cents(cur)} → ${cents(sug)}`,
        why: `Demand elasticity ${elast.toFixed(2)}. This price maximizes revenue over the 60-day window.`,
        what_to_do: uplift > 0 ? `Apply — expected uplift ${cents(uplift)}/mo.` : `Apply — stabilizes revenue at current demand.`,
      },
    };
  },

  // ---------- Batch 3: Cohort / Attribution / Funnel / Browse / Second-order ----------
  cohort_low_retention: (m) => {
    const cm = str(m, "cohort_month", "недавня");
    const pct = num(m, "m1_retention_pct") * 100;
    const cnt = num(m, "customer_count");
    return {
      ua: {
        headline: `Когорта ${cm}: повертається лише ${pct.toFixed(0)}%`,
        why: `З ${cnt} нових клієнтів цієї когорти більшість не зробила 2-ге замовлення наступного місяця. Слабкий retention = ти весь час платиш за нових замість заробляти на старих.`,
        what_to_do: `Запустити second-order nurture: персональний follow-up через 14-30 днів після першої покупки.`,
      },
      en: {
        headline: `Cohort ${cm}: only ${pct.toFixed(0)}% return`,
        why: `Of ${cnt} new customers in this cohort, most didn't place a 2nd order next month. Weak retention = you keep paying for new instead of earning from old.`,
        what_to_do: `Launch second-order nurture: personal follow-up 14-30 days after first purchase.`,
      },
    };
  },

  channel_concentration_risk: (m) => {
    const ch = str(m, "dominant_channel", "один канал");
    const share = num(m, "share") * 100;
    return {
      ua: {
        headline: `${share.toFixed(0)}% виторгу з одного каналу (${ch})`,
        why: `Якщо ${ch} зламається — алгоритм забанить, ціни виростуть, конкурент зайде, — впаде половина бізнесу за тиждень. Концентраційний ризик найвища категорія.`,
        what_to_do: `Запустити 2-й канал у тестовому бюджеті. Цільова частка домінуючого — нижче 50%.`,
      },
      en: {
        headline: `${share.toFixed(0)}% of revenue from one channel (${ch})`,
        why: `If ${ch} breaks — algorithm change, price hike, competitor entry — half the business is gone in a week. Concentration risk is the worst kind.`,
        what_to_do: `Test a 2nd channel with a small budget. Target dominant share below 50%.`,
      },
    };
  },

  funnel_weak_step: (m) => {
    const step = str(m, "weak_step", "крок воронки");
    const rate = num(m, "rate") * 100;
    const bench = num(m, "benchmark") * 100;
    const ua = str(m, "copy_ua", "Слабка ланка у воронці.");
    const en = str(m, "copy_en", "Weak step in the funnel.");
    const recoverable = num(m, "potential_recoverable");
    return {
      ua: {
        headline: `Воронка тече на "${step}": ${rate.toFixed(1)}% (норма ${bench.toFixed(0)}%)`,
        why: ua,
        what_to_do: `Полагодити цей крок — поверне ~${recoverable} клієнтів далі по воронці за 14 днів.`,
      },
      en: {
        headline: `Funnel leak at "${step}": ${rate.toFixed(1)}% (benchmark ${bench.toFixed(0)}%)`,
        why: en,
        what_to_do: `Fix this step — recovers ~${recoverable} customers further down the funnel in 14 days.`,
      },
    };
  },

  browse_abandoned: (m) => {
    const name = str(m, "customer_name") || str(m, "customer_email", "клієнт");
    const prod = str(m, "product_name", "товар");
    const views = num(m, "view_count");
    const price = num(m, "product_price_cents");
    return {
      ua: {
        headline: `${name} дивився "${prod}" ${views}× — і не купив`,
        why: `${views} переглядів картки за тиждень — це чіткий інтерес. Щось одне зупиняє: ціна, доставка, або сумнів. Без нагадування — забуде.`,
        what_to_do: `Надіслати nudge з 10% знижкою або відгуками на цей товар. Ціна референс: ${cents(price)}.`,
      },
      en: {
        headline: `${name} viewed "${prod}" ${views}× — didn't buy`,
        why: `${views} card views in a week is clear intent. Price, shipping or doubt is blocking. Without a nudge — they forget.`,
        what_to_do: `Send a nudge with 10% off or social proof for this product. Price ref: ${cents(price)}.`,
      },
    };
  },

  second_order_gap: (m) => {
    const name = str(m, "customer_name") || str(m, "customer_email", "клієнт");
    const days = num(m, "days_since_first_order");
    const prod = str(m, "first_order_product_name", "товар");
    const ret = num(m, "expected_return_cents");
    return {
      ua: {
        headline: `${name}: 1 замовлення ${days} днів тому, мовчить`,
        why: `Купив "${prod}" і зник. 60-70% таких клієнтів ніколи не повернуться без нагадування — це найбільша діра retention. Зараз ще пам'ятає бренд.`,
        what_to_do: `Особистий follow-up з cross-sell — потенційно ${cents(ret)} return.`,
      },
      en: {
        headline: `${name}: 1 order ${days} days ago, silent`,
        why: `Bought "${prod}" and disappeared. 60-70% never come back without a nudge — biggest retention hole. Brand is still in their memory now.`,
        what_to_do: `Personal follow-up with cross-sell — potentially ${cents(ret)} return.`,
      },
    };
  },

  // ---------- Batch 4: Messaging ----------
  bot_sequence_stuck: (m) => {
    const name = str(m, "customer_name") || str(m, "customer_email", "клієнт");
    const cnt = num(m, "inbound_count");
    return {
      ua: {
        headline: `${name}: ${cnt} повідомлень — без відповіді`,
        why: `Клієнт сам пише — це найгарячіший лід. Якщо не відповісти за добу, він шукає альтернативу. Втрачаємо живий інтерес.`,
        what_to_do: `Дай боту контекст і відправ коротку відповідь — конверсія таких розмов ~25%.`,
      },
      en: {
        headline: `${name}: ${cnt} messages — no reply`,
        why: `Customer is writing first — hottest possible lead. Skip a day and they look elsewhere. Live intent lost.`,
        what_to_do: `Resume the bot or reply manually — conversion of stuck threads is ~25%.`,
      },
    };
  },

  faq_candidate: (m) => {
    const intent = str(m, "intent", "тема");
    const cnt = num(m, "customer_count");
    return {
      ua: {
        headline: `"${intent}" питають ${cnt} клієнтів/тиждень`,
        why: `Один і той самий запит повторюється — значить це біль не одного клієнта, а всіх. Ручні відповіді = трата часу і ризик розбіжностей.`,
        what_to_do: `Додай FAQ-блок або auto-reply на цю тему — закриє раз і назавжди.`,
      },
      en: {
        headline: `"${intent}" asked by ${cnt} customers/week`,
        why: `Same question repeats — it's a shared pain, not a one-off. Manual replies waste time and risk inconsistency.`,
        what_to_do: `Add a FAQ entry or auto-reply for this topic — closes it permanently.`,
      },
    };
  },

  broadcast_suggestion: (m) => {
    const theme = str(m, "theme", "розсилка");
    const draftUa = str(m, "draft_ua", "");
    const draftEn = str(m, "draft_en", "");
    return {
      ua: {
        headline: `Готова ідея для розсилки: ${theme}`,
        why: `Зараз є ситуація, яка добре конвертить у broadcast. Драфт нижче — лише натисни "Apply".`,
        what_to_do: draftUa || `Розгорни деталі і відправ на сегмент.`,
      },
      en: {
        headline: `Broadcast idea ready: ${theme}`,
        why: `Current conditions favor a broadcast. Draft below — just hit "Apply".`,
        what_to_do: draftEn || `Expand details and send to segment.`,
      },
    };
  },

  best_send_window: (m) => {
    const top = (m.top_hours_utc as number[] | undefined) ?? [];
    const topRate = num(m, "top_rate") * 100;
    const avg = num(m, "avg_rate") * 100;
    return {
      ua: {
        headline: `Найкращі години розсилки: ${top.map((h) => `${h}:00`).join(", ")} UTC`,
        why: `Конверсія в ці години ~${topRate.toFixed(1)}% vs середнє ${avg.toFixed(1)}%. Просто переніс розсилки — і отримуєш більше без додаткових витрат.`,
        what_to_do: `Налаштуй scheduler автоматично класти розсилки в це вікно.`,
      },
      en: {
        headline: `Best send hours: ${top.map((h) => `${h}:00`).join(", ")} UTC`,
        why: `Conversion in these hours ~${topRate.toFixed(1)}% vs ${avg.toFixed(1)}% avg. Just moving sends here = more revenue, zero extra cost.`,
        what_to_do: `Configure scheduler to auto-place sends in this window.`,
      },
    };
  },

  csat_request: (m) => {
    const name = str(m, "customer_name") || str(m, "customer_email", "клієнт");
    return {
      ua: {
        headline: `Час просити фідбек: ${name}`,
        why: `Замовлення доставлено ~5 днів тому — це "теплий момент". Запит зараз дає 30-40% response, через тиждень — <10%. І це шанс зловити проблему до refund.`,
        what_to_do: `Apply → відправляється короткий 1-5⭐ запит з draft нижче.`,
      },
      en: {
        headline: `Time to ask for feedback: ${name}`,
        why: `Order delivered ~5 days ago — the warm window. Asking now gets 30-40% response vs <10% later. Also catches issues before refunds.`,
        what_to_do: `Apply → sends a short 1-5⭐ request using the draft below.`,
      },
    };
  },

  nurture_low_roi: (m) => {
    const trig = str(m, "trigger", "trigger");
    const roi = num(m, "roi_per_msg_cents") / 100;
    const avg = num(m, "avg_roi_per_msg_cents") / 100;
    return {
      ua: {
        headline: `Trigger "${trig}" втрачає гроші ($${roi.toFixed(2)}/msg)`,
        why: `ROI у 2× нижче середнього ($${avg.toFixed(2)}). Ці повідомлення жеруть attention клієнта, ризикують unsubscribe, і не повертають витрат.`,
        what_to_do: `Поставити на паузу або переписати hook — звільнить квоту для триггерів, що працюють.`,
      },
      en: {
        headline: `Trigger "${trig}" loses money ($${roi.toFixed(2)}/msg)`,
        why: `ROI is half of average ($${avg.toFixed(2)}). These messages eat customer attention, risk unsubs, return nothing.`,
        what_to_do: `Pause or rewrite the hook — frees quota for triggers that work.`,
      },
    };
  },

  nurture_high_roi: (m) => {
    const trig = str(m, "trigger", "trigger");
    const roi = num(m, "roi_per_msg_cents") / 100;
    const ratio = num(m, "ratio");
    return {
      ua: {
        headline: `Trigger "${trig}" — зірка ($${roi.toFixed(2)}/msg, ${ratio.toFixed(1)}× середнього)`,
        why: `Цей нурт-сценарій працює у рази краще за інші. Кожне додаткове надсилання — чистий прибуток.`,
        what_to_do: `Розширити охоплення цього trigger: збільшити сегмент або частоту.`,
      },
      en: {
        headline: `Trigger "${trig}" is a winner ($${roi.toFixed(2)}/msg, ${ratio.toFixed(1)}× average)`,
        why: `This nurture scenario beats others by a wide margin. Every extra send = pure profit.`,
        what_to_do: `Scale this trigger: enlarge segment or increase frequency.`,
      },
    };
  },

  // ---------- Batch 5: SEO/Content ----------
  seo_rewrite_opportunity: (m) => {
    const slug = str(m, "slug", "page");
    const ctr = num(m, "ctr") * 100;
    const impr = num(m, "impressions_30d");
    const reason = str(m, "reason", "low_ctr");
    return {
      ua: {
        headline:
          reason === "low_ctr"
            ? `/${slug}: CTR ${ctr.toFixed(2)}% — title не "продає"`
            : `/${slug}: пусті SEO-поля`,
        why:
          reason === "low_ctr"
            ? `${impr} показів у Google за місяць, але клікають мало. Title/description не цікавлять — прокручують далі.`
            : `Опубліковано без seo_title/description — Google генерує власну версію, часто гіршу.`,
        what_to_do: "Apply → ШІ перепише title (≤60 chars) + description (≤155) під реальний намір.",
      },
      en: {
        headline:
          reason === "low_ctr"
            ? `/${slug}: ${ctr.toFixed(2)}% CTR — title doesn't sell`
            : `/${slug}: SEO fields empty`,
        why:
          reason === "low_ctr"
            ? `${impr} Google impressions / month but few clicks. Title/description don't grab — they scroll past.`
            : `Published with no seo_title/description — Google fabricates its own, usually worse.`,
        what_to_do: "Apply → AI rewrites title (≤60 chars) + description (≤155) for real intent.",
      },
    };
  },

  content_velocity_low: (m) => {
    const last30 = num(m, "published_30d");
    const last90 = num(m, "published_90d");
    return {
      ua: {
        headline: `Темп контенту просів: ${last30} постів за місяць`,
        why: `За 90 днів — лише ${last90} публікацій. Алгоритм Google "забуває" сайти без свіжого контенту, рейтинги падають.`,
        what_to_do: "Запланувати ≥4 публікації/місяць (1/тиж). Apply створить контент-план з ідеями.",
      },
      en: {
        headline: `Content velocity dropped: ${last30} posts in 30d`,
        why: `Only ${last90} pages in 90 days. Google's algorithm "forgets" sites without fresh content — rankings slide.`,
        what_to_do: "Schedule ≥4 posts/month (1/wk). Apply generates a content plan with ideas.",
      },
    };
  },

  content_stale_topperformer: (m) => {
    const age = num(m, "age_days");
    const views = num(m, "views_30d");
    const slug = str(m, "slug", "page");
    return {
      ua: {
        headline: `/${slug}: топ-сторінка, але ${age} днів без апдейту`,
        why: `${views} переглядів/міс — це твоя робоча "конячка". Refresh (нові дані, скрін, рік у title) часто дає +20-40%.`,
        what_to_do: "Apply → ШІ запропонує що оновити (sections, dates, examples).",
      },
      en: {
        headline: `/${slug}: top page, ${age} days stale`,
        why: `${views} views/month — your workhorse. Refresh (new data, screenshot, year in title) usually adds 20-40%.`,
        what_to_do: "Apply → AI suggests what to refresh (sections, dates, examples).",
      },
    };
  },

  ugc_harvest_opportunity: (m) => {
    const n = num(m, "eligible_count");
    const exp = num(m, "expected_responses");
    return {
      ua: {
        headline: `${n} лояльних клієнтів — час просити відгук`,
        why: `2+ замовлення за 60 днів = вони люблять продукт. Цей момент гасне через 7-14 днів.`,
        what_to_do: `Apply → відправляється запит на відгук + фото. Очікувано ~${exp} нових social proof.`,
      },
      en: {
        headline: `${n} loyal customers ready for review ask`,
        why: `2+ orders in 60 days = they love the product. This window fades in 7-14 days.`,
        what_to_do: `Apply → sends a review + photo request. ~${exp} new social-proof items expected.`,
      },
    };
  },

  ugc_low_volume: (m) => {
    const n = num(m, "ugc_count");
    return {
      ua: {
        headline: `Лише ${n} відгуків — мало для довіри новачків`,
        why: "Бренди з 20+ відгуків мають у 1.4× вищу конверсію. Без social proof новий покупець вагається.",
        what_to_do: "Запусти автоматичний post-purchase запит для кожного оплаченого замовлення.",
      },
      en: {
        headline: `Only ${n} reviews — too thin for new-buyer trust`,
        why: "Brands with 20+ reviews convert ~1.4× better. Without social proof, first-time buyers hesitate.",
        what_to_do: "Turn on automatic post-purchase review requests for every paid order.",
      },
    };
  },

  search_intent_unmet: (m) => {
    const q = str(m, "query", "запит");
    const total = num(m, "searches_30d");
    const clicks = num(m, "clicks");
    return {
      ua: {
        headline: `"${q}": ${clicks}/${total} кліків, 0 покупок`,
        why: `Високий інтерес — клікають у пів випадків. Але сторінка не закриває намір (ціна, опис, фото, наявність).`,
        what_to_do: "Apply → ШІ перевірить landing і запропонує що поміняти, або редирект на правильний продукт.",
      },
      en: {
        headline: `"${q}": ${clicks}/${total} clicks, 0 purchases`,
        why: `Strong intent — clicked half the time. But the landing doesn't close the intent (price, description, photo, stock).`,
        what_to_do: "Apply → AI audits the page and suggests what to change, or redirects to the right product.",
      },
    };
  },

  search_zero_results_cluster: (m) => {
    const q = str(m, "query", "запит");
    const zero = num(m, "zero_results");
    const total = num(m, "total_searches");
    return {
      ua: {
        headline: `"${q}": ${zero}/${total} пошуків — порожньо`,
        why: "Гарячий попит, але немає що показати. Кожен такий запит — втрачений продаж.",
        what_to_do: "Додай товар АБО створи SEO-landing з alternative recommendations.",
      },
      en: {
        headline: `"${q}": ${zero}/${total} searches return nothing`,
        why: "Hot demand with nothing to show. Each one is a lost sale.",
        what_to_do: "Add a matching product OR build a SEO landing with alternative recommendations.",
      },
    };
  },

  programmatic_seo_opportunity: (m) => {
    const proposed = (m.proposed_pages as { slug: string; title: string }[] | undefined) ?? [];
    const n = proposed.length;
    return {
      ua: {
        headline: `${n} programmatic landing-сторінок готові`,
        why: "Знайдені gap між пошуковими запитами і існуючими сторінками. Шаблонна генерація закриє довгий хвіст SEO.",
        what_to_do: `Apply → ШІ згенерує ${n} сторінок (≈300 слів кожна) і опублікує як draft для рев'ю.`,
      },
      en: {
        headline: `${n} programmatic landings ready`,
        why: "Found gaps between search queries and existing pages. Template-based generation closes the long-tail SEO.",
        what_to_do: `Apply → AI generates ${n} pages (~300 words each) and publishes as drafts for review.`,
      },
    };
  },

  // ---------- Batch 6: Customer/Loyalty ----------
  loyalty_tier_proposal: (m) => {
    const silver = num(m, "silver_threshold_cents") / 100;
    const gold = num(m, "gold_threshold_cents") / 100;
    const platinum = num(m, "platinum_threshold_cents") / 100;
    return {
      ua: {
        headline: `Loyalty-tiers готові: Silver $${silver.toFixed(0)} / Gold $${gold.toFixed(0)} / Platinum $${platinum.toFixed(0)}`,
        why: "Природні breakpoints за розподілом LTV. Tier-програма дає 10-20% росту retention через статусний ефект.",
        what_to_do: "Apply → створює 4 рівні з цими порогами і вмикає авто-присвоєння.",
      },
      en: {
        headline: `Loyalty tiers ready: Silver $${silver.toFixed(0)} / Gold $${gold.toFixed(0)} / Platinum $${platinum.toFixed(0)}`,
        why: "Natural breakpoints from your LTV distribution. Tiers usually lift retention 10-20% via status effect.",
        what_to_do: "Apply → creates 4 tiers with these thresholds and enables auto-assignment.",
      },
    };
  },

  next_best_product: (m) => {
    const from = str(m, "from_name", "товар А");
    const to = str(m, "to_name", "товар Б");
    const count = num(m, "transition_count");
    return {
      ua: {
        headline: `Після "${from}" беруть "${to}" (${count}× за 90д)`,
        why: "Стійкий sequential паттерн — клієнти самі вибирають це. Auto-recommend закриває цикл без зусиль.",
        what_to_do: `Додати "${to}" у post-purchase / reorder-нагадування для покупців "${from}".`,
      },
      en: {
        headline: `After "${from}" they buy "${to}" (${count}× in 90d)`,
        why: "Stable sequential pattern — customers choose it themselves. Auto-recommend closes the loop effortlessly.",
        what_to_do: `Add "${to}" to post-purchase / reorder reminders for "${from}" buyers.`,
      },
    };
  },
  first_order_funnel_weak: (m) => {
    const conv = num(m, "conversion") * 100;
    const from = str(m, "weakest_from", "step");
    const to = str(m, "weakest_to", "step");
    const drop = num(m, "weakest_drop") * 100;
    return {
      ua: {
        headline: `First-order конверсія: ${conv.toFixed(2)}% — слабка`,
        why: `Найбільша втрата: ${from} → ${to} (-${drop.toFixed(0)}%). Це місце де нові відвідувачі найчастіше "відвалюються".`,
        what_to_do: "Apply → ШІ перевірить цей крок (UX, ціна, довіра) і запропонує 2-3 fix.",
      },
      en: {
        headline: `First-order conversion: ${conv.toFixed(2)}% — weak`,
        why: `Biggest drop: ${from} → ${to} (-${drop.toFixed(0)}%). This is where first-time visitors bail most.`,
        what_to_do: "Apply → AI audits this step (UX, price, trust) and suggests 2-3 fixes.",
      },
    };
  },

  // ---------- Batch 7: ops/safety ----------
  inventory_forecast_warn: (m) => {
    const name = str(m, "product_name", "товар");
    const days = num(m, "days_until_stockout");
    const reorder = num(m, "recommended_reorder_qty");
    return {
      ua: {
        headline: `${name}: запас закінчується через ~${days.toFixed(1)} дн.`,
        why: `Прогноз попиту на 30 днів = ${num(m, "predicted_demand_30d")} шт., поточний залишок = ${num(m, "stock")} шт.`,
        what_to_do: `Замовте ще ~${reorder} шт. у постачальника, щоб покрити наступний місяць без розривів.`,
      },
      en: {
        headline: `${name}: runs out in ~${days.toFixed(1)} days`,
        why: `30-day demand forecast = ${num(m, "predicted_demand_30d")} units, current stock = ${num(m, "stock")} units.`,
        what_to_do: `Reorder ~${reorder} units to cover the next month without gaps.`,
      },
    };
  },
  restock_alert_urgent: (m) => {
    const name = str(m, "product_name", "товар");
    const days = num(m, "days_until_stockout");
    const reorder = num(m, "recommended_reorder_qty");
    const lost = num(m, "potential_lost_revenue_cents");
    return {
      ua: {
        headline: `🚨 ${name}: терміновий restock (${days.toFixed(1)} дн.)`,
        why: `Залишок ${num(m, "stock")} шт. До stockout ≤ 7 днів. Без дії втратите ~${cents(lost)} продажів.`,
        what_to_do: `Створіть PO на ${reorder} шт. сьогодні — Apply відкриває чернетку замовлення.`,
      },
      en: {
        headline: `🚨 ${name}: urgent restock (${days.toFixed(1)} days)`,
        why: `Stock ${num(m, "stock")} units. Stockout in ≤ 7 days. Without action you lose ~${cents(lost)} in sales.`,
        what_to_do: `Create a PO for ${reorder} units today — Apply opens the order draft.`,
      },
    };
  },
  fraud_risk_high: (m) => {
    const score = num(m, "risk_score");
    const total = num(m, "total_cents");
    const sigs = (m.signals as Array<{ kind: string }> | undefined)?.map((s) => s.kind) ?? [];
    return {
      ua: {
        headline: `⚠️ Замовлення на ${cents(total)}: підозра на fraud (${(score * 100).toFixed(0)}%)`,
        why: `Триггери: ${sigs.join(", ")}. Це не блокує, але вимагає ручного огляду — ризик chargeback.`,
        what_to_do: "Перевірте замовлення вручну до виконання. Якщо ОК — позначте reviewed=approved.",
      },
      en: {
        headline: `⚠️ Order ${cents(total)}: fraud suspicion (${(score * 100).toFixed(0)}%)`,
        why: `Triggers: ${sigs.join(", ")}. Not blocking, but needs manual review — chargeback risk.`,
        what_to_do: "Review the order manually before fulfillment. If OK — mark reviewed=approved.",
      },
    };
  },
  action_loop_unclosed: (m) => {
    const agent = str(m, "agent_id", "agent");
    const n = num(m, "stale_count");
    return {
      ua: {
        headline: `${agent}: ${n} дій без вимірювання ≥ 7 днів`,
        why: "Agent застосував зміни, але impact не виміряно. Без feedback ШІ не вчиться — ризик повторення помилок.",
        what_to_do: "Apply → запускає feedback-loop, що визначає реальний impact кожної дії.",
      },
      en: {
        headline: `${agent}: ${n} actions unmeasured for ≥ 7 days`,
        why: "Agent applied changes, but impact wasn't measured. Without feedback the AI can't learn — risk of repeating mistakes.",
        what_to_do: "Apply → runs the feedback-loop that measures real impact for each action.",
      },
    };
  },
  agent_conflict_detected: (m) => {
    const entity = str(m, "target_entity", "target");
    const agents = (m.agents as string[] | undefined) ?? [];
    return {
      ua: {
        headline: `Конфлікт: ${agents.length} агенти на одному ${entity}`,
        why: `${agents.join(", ")} одночасно діють на той самий ${entity}. ROI вимірювання буде спотворене — невідомо, чий ефект.`,
        what_to_do: "Виберіть pick-a-winner: який agent залишити активним для цього target.",
      },
      en: {
        headline: `Conflict: ${agents.length} agents on the same ${entity}`,
        why: `${agents.join(", ")} simultaneously act on the same ${entity}. ROI measurement gets distorted — unclear whose effect.`,
        what_to_do: "Pick-a-winner: choose which agent stays active for this target.",
      },
    };
  },
};
