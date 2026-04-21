/**
 * Людські назви агентів — єдине джерело правди.
 * Ключі покривають обидва формати ID: kebab-case (з роутів) і snake_case (з БД).
 */
export const AGENT_HUMAN_LABELS: Record<string, string> = {
  // Базові
  onboarding: "Привітання нових клієнтів",
  onboarding_coach: "Привітання нових клієнтів",
  "churn-risk": "Ризик втрати клієнта",
  churn_risk_predictor: "Ризик втрати клієнта",
  "customer-churn-predictor": "Прогноз відтоку клієнтів",
  stockout: "Закінчується товар",
  stockout_predictor: "Закінчується товар",
  "aov-leak": "Просідання середнього чека",
  aov_leak_detector: "Просідання середнього чека",
  "search-gap": "Чого шукають, але не знаходять",
  search_gap_detector: "Чого шукають, але не знаходять",
  "aov-optimizer": "Підняти середній чек",
  aov_optimizer: "Підняти середній чек",
  "price-optimizer": "Розумні ціни",
  price_optimizer: "Розумні ціни",
  "price-revert": "Запобіжник цін",
  price_revert_safety: "Запобіжник цін",
  "bot-quality": "Якість відповідей бота",
  bot_quality_audit: "Якість відповідей бота",
  segmentation: "Розподіл клієнтів на групи",
  customer_segmentation: "Розподіл клієнтів на групи",
  "memory-feedback": "Навчання на досвіді",
  feedback_loop: "Навчання на досвіді",

  // Маржа й прогнози
  "margin-optimizer": "Оптимізація прибутковості",
  "ltv-predictor": "Прогноз цінності клієнта",
  "cart-recovery": "Повернення кинутих кошиків",
  "anomaly-detector": "Виявлення аномалій",
  "morning-brief": "Ранкове зведення",

  // Промо й комплекти
  "bundle-recommender": "Підбір комплектів товарів",
  "promo-fatigue": "Втома від акцій",
  "promo-portfolio": "Планування акцій",
  "discount-elasticity": "Як знижки впливають на продажі",
  "predictive-pricing": "Передбачувальне ціноутворення",

  // Аналітика
  "cohort-engine": "Аналіз когорт клієнтів",
  attribution: "Звідки приходять продажі",
  "funnel-healer": "Лікування воронки продажів",
  "browse-abandonment": "Переглянули, але не купили",
  "second-order-nurture": "Підштовхнути до другої покупки",

  // Повідомлення
  "bot-sequences": "Послідовності повідомлень",
  "broadcast-composer": "Підготовка розсилок",
  "best-time-to-send": "Найкращий час для розсилки",
  "csat-dispatcher": "Опитування про задоволеність",
  "nurture-roi": "Окупність повідомлень",

  // Контент і SEO
  "seo-rewriter": "Покращення текстів для пошуку",
  "content-velocity": "Швидкість випуску контенту",
  "ugc-harvester": "Збір відгуків клієнтів",
  "search-intent-miner": "Що насправді шукають люди",
  "programmatic-seo": "Автоматичні сторінки під пошук",

  // Клієнти й лояльність
  "customer-segments-auto": "Автоматичні групи клієнтів",
  "loyalty-tiers": "Рівні лояльності",
  "product-affinity": "Що купують разом",
  "first-order-funnel": "Перша покупка нового клієнта",

  // Ops і безпека
  "inventory-forecast": "Прогноз запасів",
  "restock-alert": "Час замовити поповнення",
  "anti-fraud": "Захист від шахрайства",
  "action-watchdog": "Сторож дій агентів",
  "conflict-resolver": "Розв'язання суперечливих дій",

  // ROI та навчання
  "social-proof-live": "Живі відгуки на сайті",
  "broadcast-roi": "Окупність розсилок",
  "winback-roi": "Окупність повернення клієнтів",
  "elasticity-meta-loop": "Навчання на цінових змінах",
  "learning-loop-monitor": "Контроль навчання системи",

  // Оркестрація
  "notification-router": "Маршрутизація сповіщень",
  "daily-digest-v2": "Щоденне зведення",
  "owner-playbook": "Підказки власнику",
  "meta-prior-injector": "Передавання знань між агентами",
  "autonomous-seo-loop": "Автономне SEO",

  // Логістика й клієнти
  "shipping-optimizer": "Оптимізація доставки",
  "return-predictor": "Передбачення повернень",
  "vip-concierge": "Турбота про VIP-клієнтів",
  "review-velocity": "Збір відгуків у вдалий момент",
  "payment-retry": "Повторна спроба оплати",
  "geo-demand": "Попит за регіонами",
  "time-of-day-pricer": "Ціни за годинами доби",
  "refund-risk": "Ризик повернення коштів",
  "lifecycle-trigger-tuner": "Налаштування тригерів",
  "inventory-rebalance": "Перерозподіл запасів",

  // Інше
  orchestrator: "Диригент агентів",
  telegram_reorder_bot: "Бот повторних замовлень",
  sales_bot: "Бот продажів",
  reorder_engine: "Двигун повторних замовлень",
  winback_engine: "Двигун повернення клієнтів",
};

/** Перетворює технічний ID на людську назву. Якщо немає в словнику — робить читабельним. */
export function humanizeAgentId(id: string): string {
  if (!id) return "Агент";
  if (AGENT_HUMAN_LABELS[id]) return AGENT_HUMAN_LABELS[id];
  // Fallback: snake/kebab → "Words"
  return id
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
