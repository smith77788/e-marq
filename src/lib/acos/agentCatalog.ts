/**
 * Agent Catalog — human-readable metadata for every agent in the fleet.
 *
 * Used by:
 *   - /agents/$agentId (deep-dive page)
 *   - /agents (library)
 *   - AgentTimeline / AgentHealthHeatmap tooltips
 *
 * Translations live in i18n.ts under `agc.<key>.*`. This file holds only
 * structural data (category, default risk, can_auto_apply hint, icon name).
 */

export type AgentCategory =
  | "growth"
  | "retention"
  | "operations"
  | "ai_quality"
  | "communication"
  | "content_seo"
  | "analytics"
  | "safety";

export type AgentMeta = {
  /** Stable agent_id used in DB and route paths */
  id: string;
  /** Lucide icon name (rendered dynamically via icon map) */
  icon:
    | "Users"
    | "Boxes"
    | "ShoppingCart"
    | "Search"
    | "Tag"
    | "Mail"
    | "Bot"
    | "Brain"
    | "Sparkles"
    | "Shield"
    | "Truck"
    | "Coins"
    | "Activity"
    | "Bell"
    | "BarChart3"
    | "Megaphone"
    | "Zap";
  category: AgentCategory;
  /** Default action risk this agent typically produces (used to set sensible default permissions) */
  defaultRisk: "low" | "medium" | "high";
  /** Whether this agent ever produces actions that can be auto-applied (true = supports `auto` mode). Otherwise it stays advisory. */
  supportsAutoApply: boolean;
  /** i18n key prefix; resolves to: agc.<i18nKey>.title / .what / .when / .impact */
  i18nKey: string;
};

export const AGENT_CATALOG: AgentMeta[] = [
  // === Growth ===
  {
    id: "aov-optimizer",
    icon: "ShoppingCart",
    category: "growth",
    defaultRisk: "medium",
    supportsAutoApply: true,
    i18nKey: "aovOptimizer",
  },
  {
    id: "price-optimizer",
    icon: "Tag",
    category: "growth",
    defaultRisk: "high",
    supportsAutoApply: true,
    i18nKey: "priceOptimizer",
  },
  {
    id: "predictive-pricing",
    icon: "Tag",
    category: "growth",
    defaultRisk: "high",
    supportsAutoApply: false,
    i18nKey: "predictivePricing",
  },
  {
    id: "discount-elasticity",
    icon: "Tag",
    category: "growth",
    defaultRisk: "medium",
    supportsAutoApply: false,
    i18nKey: "discountElasticity",
  },
  {
    id: "bundle-recommender",
    icon: "Sparkles",
    category: "growth",
    defaultRisk: "low",
    supportsAutoApply: true,
    i18nKey: "bundleRecommender",
  },
  {
    id: "promo-portfolio",
    icon: "Tag",
    category: "growth",
    defaultRisk: "medium",
    supportsAutoApply: false,
    i18nKey: "promoPortfolio",
  },
  {
    id: "first-order-funnel",
    icon: "Activity",
    category: "growth",
    defaultRisk: "medium",
    supportsAutoApply: true,
    i18nKey: "firstOrderFunnel",
  },
  {
    id: "second-order-nurture",
    icon: "Mail",
    category: "growth",
    defaultRisk: "low",
    supportsAutoApply: true,
    i18nKey: "secondOrderNurture",
  },

  // === Retention ===
  {
    id: "churn-risk",
    icon: "Users",
    category: "retention",
    defaultRisk: "medium",
    supportsAutoApply: true,
    i18nKey: "churnRisk",
  },
  {
    id: "customer-churn-predictor",
    icon: "Users",
    category: "retention",
    defaultRisk: "medium",
    supportsAutoApply: false,
    i18nKey: "customerChurnPredictor",
  },
  {
    id: "ltv-predictor",
    icon: "Coins",
    category: "retention",
    defaultRisk: "low",
    supportsAutoApply: false,
    i18nKey: "ltvPredictor",
  },
  {
    id: "loyalty-tiers",
    icon: "Sparkles",
    category: "retention",
    defaultRisk: "low",
    supportsAutoApply: true,
    i18nKey: "loyaltyTiers",
  },
  {
    id: "vip-concierge",
    icon: "Sparkles",
    category: "retention",
    defaultRisk: "medium",
    supportsAutoApply: true,
    i18nKey: "vipConcierge",
  },
  {
    id: "winback-roi",
    icon: "Mail",
    category: "retention",
    defaultRisk: "medium",
    supportsAutoApply: false,
    i18nKey: "winbackRoi",
  },

  // === Operations ===
  {
    id: "stockout",
    icon: "Boxes",
    category: "operations",
    defaultRisk: "high",
    supportsAutoApply: true,
    i18nKey: "stockout",
  },
  {
    id: "inventory-forecast",
    icon: "Boxes",
    category: "operations",
    defaultRisk: "medium",
    supportsAutoApply: false,
    i18nKey: "inventoryForecast",
  },
  {
    id: "inventory-rebalance",
    icon: "Boxes",
    category: "operations",
    defaultRisk: "medium",
    supportsAutoApply: true,
    i18nKey: "inventoryRebalance",
  },
  {
    id: "restock-alert",
    icon: "Bell",
    category: "operations",
    defaultRisk: "low",
    supportsAutoApply: true,
    i18nKey: "restockAlert",
  },
  {
    id: "shipping-optimizer",
    icon: "Truck",
    category: "operations",
    defaultRisk: "medium",
    supportsAutoApply: true,
    i18nKey: "shippingOptimizer",
  },
  {
    id: "payment-retry",
    icon: "Coins",
    category: "operations",
    defaultRisk: "low",
    supportsAutoApply: true,
    i18nKey: "paymentRetry",
  },
  {
    id: "refund-risk",
    icon: "Shield",
    category: "operations",
    defaultRisk: "medium",
    supportsAutoApply: false,
    i18nKey: "refundRisk",
  },
  {
    id: "return-predictor",
    icon: "Shield",
    category: "operations",
    defaultRisk: "medium",
    supportsAutoApply: false,
    i18nKey: "returnPredictor",
  },

  // === Communication ===
  {
    id: "cart-recovery",
    icon: "ShoppingCart",
    category: "communication",
    defaultRisk: "medium",
    supportsAutoApply: true,
    i18nKey: "cartRecovery",
  },
  {
    id: "browse-abandonment",
    icon: "ShoppingCart",
    category: "communication",
    defaultRisk: "low",
    supportsAutoApply: true,
    i18nKey: "browseAbandonment",
  },
  {
    id: "broadcast-composer",
    icon: "Megaphone",
    category: "communication",
    defaultRisk: "medium",
    supportsAutoApply: false,
    i18nKey: "broadcastComposer",
  },
  {
    id: "best-time-to-send",
    icon: "Activity",
    category: "communication",
    defaultRisk: "low",
    supportsAutoApply: true,
    i18nKey: "bestTimeToSend",
  },
  {
    id: "csat-dispatcher",
    icon: "Mail",
    category: "communication",
    defaultRisk: "low",
    supportsAutoApply: true,
    i18nKey: "csatDispatcher",
  },
  {
    id: "notification-router",
    icon: "Bell",
    category: "communication",
    defaultRisk: "low",
    supportsAutoApply: true,
    i18nKey: "notificationRouter",
  },
  {
    id: "bot-sequences",
    icon: "Bot",
    category: "communication",
    defaultRisk: "low",
    supportsAutoApply: true,
    i18nKey: "botSequences",
  },

  // === AI Quality ===
  {
    id: "bot-quality",
    icon: "Brain",
    category: "ai_quality",
    defaultRisk: "low",
    supportsAutoApply: false,
    i18nKey: "botQuality",
  },
  {
    id: "memory-feedback",
    icon: "Brain",
    category: "ai_quality",
    defaultRisk: "low",
    supportsAutoApply: true,
    i18nKey: "memoryFeedback",
  },
  {
    id: "learning-loop-monitor",
    icon: "Brain",
    category: "ai_quality",
    defaultRisk: "low",
    supportsAutoApply: false,
    i18nKey: "learningLoopMonitor",
  },
  {
    id: "elasticity-meta-loop",
    icon: "Brain",
    category: "ai_quality",
    defaultRisk: "medium",
    supportsAutoApply: false,
    i18nKey: "elasticityMetaLoop",
  },
  {
    id: "meta-prior-injector",
    icon: "Brain",
    category: "ai_quality",
    defaultRisk: "low",
    supportsAutoApply: true,
    i18nKey: "metaPriorInjector",
  },

  // === Content & SEO ===
  {
    id: "search-gap",
    icon: "Search",
    category: "content_seo",
    defaultRisk: "low",
    supportsAutoApply: false,
    i18nKey: "searchGap",
  },
  {
    id: "search-intent-miner",
    icon: "Search",
    category: "content_seo",
    defaultRisk: "low",
    supportsAutoApply: false,
    i18nKey: "searchIntentMiner",
  },
  {
    id: "seo-rewriter",
    icon: "Sparkles",
    category: "content_seo",
    defaultRisk: "low",
    supportsAutoApply: true,
    i18nKey: "seoRewriter",
  },
  {
    id: "programmatic-seo",
    icon: "Sparkles",
    category: "content_seo",
    defaultRisk: "medium",
    supportsAutoApply: true,
    i18nKey: "programmaticSeo",
  },
  {
    id: "autonomous-seo-loop",
    icon: "Sparkles",
    category: "content_seo",
    defaultRisk: "medium",
    supportsAutoApply: true,
    i18nKey: "autonomousSeoLoop",
  },
  {
    id: "content-velocity",
    icon: "Activity",
    category: "content_seo",
    defaultRisk: "low",
    supportsAutoApply: false,
    i18nKey: "contentVelocity",
  },
  {
    id: "ugc-harvester",
    icon: "Sparkles",
    category: "content_seo",
    defaultRisk: "low",
    supportsAutoApply: true,
    i18nKey: "ugcHarvester",
  },

  // === Analytics ===
  {
    id: "aov-leak",
    icon: "BarChart3",
    category: "analytics",
    defaultRisk: "medium",
    supportsAutoApply: false,
    i18nKey: "aovLeak",
  },
  {
    id: "cohort-engine",
    icon: "BarChart3",
    category: "analytics",
    defaultRisk: "low",
    supportsAutoApply: false,
    i18nKey: "cohortEngine",
  },
  {
    id: "attribution",
    icon: "BarChart3",
    category: "analytics",
    defaultRisk: "low",
    supportsAutoApply: false,
    i18nKey: "attribution",
  },
  {
    id: "funnel-healer",
    icon: "BarChart3",
    category: "analytics",
    defaultRisk: "medium",
    supportsAutoApply: true,
    i18nKey: "funnelHealer",
  },
  {
    id: "anomaly-detector",
    icon: "Activity",
    category: "analytics",
    defaultRisk: "medium",
    supportsAutoApply: false,
    i18nKey: "anomalyDetector",
  },
  {
    id: "morning-brief",
    icon: "Bell",
    category: "analytics",
    defaultRisk: "low",
    supportsAutoApply: true,
    i18nKey: "morningBrief",
  },
  {
    id: "daily-digest-v2",
    icon: "Bell",
    category: "analytics",
    defaultRisk: "low",
    supportsAutoApply: true,
    i18nKey: "dailyDigest",
  },
  {
    id: "owner-playbook",
    icon: "Brain",
    category: "analytics",
    defaultRisk: "low",
    supportsAutoApply: false,
    i18nKey: "ownerPlaybook",
  },
  {
    id: "geo-demand",
    icon: "BarChart3",
    category: "analytics",
    defaultRisk: "low",
    supportsAutoApply: false,
    i18nKey: "geoDemand",
  },
  {
    id: "seasonality-detector",
    icon: "Activity",
    category: "analytics",
    defaultRisk: "low",
    supportsAutoApply: false,
    i18nKey: "seasonalityDetector",
  },

  // === Safety ===
  {
    id: "anti-fraud",
    icon: "Shield",
    category: "safety",
    defaultRisk: "high",
    supportsAutoApply: true,
    i18nKey: "antiFraud",
  },
  {
    id: "action-watchdog",
    icon: "Shield",
    category: "safety",
    defaultRisk: "low",
    supportsAutoApply: true,
    i18nKey: "actionWatchdog",
  },
  {
    id: "conflict-resolver",
    icon: "Shield",
    category: "safety",
    defaultRisk: "medium",
    supportsAutoApply: true,
    i18nKey: "conflictResolver",
  },
  {
    id: "price-revert",
    icon: "Shield",
    category: "safety",
    defaultRisk: "low",
    supportsAutoApply: true,
    i18nKey: "priceRevert",
  },
  {
    id: "data-gap-auditor",
    icon: "Shield",
    category: "safety",
    defaultRisk: "low",
    supportsAutoApply: false,
    i18nKey: "dataGapAuditor",
  },
];

export const AGENT_BY_ID = new Map(AGENT_CATALOG.map((a) => [a.id, a]));

export function getAgentMeta(id: string): AgentMeta | null {
  return AGENT_BY_ID.get(id) ?? null;
}

export const CATEGORY_ORDER: AgentCategory[] = [
  "growth",
  "retention",
  "operations",
  "communication",
  "content_seo",
  "analytics",
  "ai_quality",
  "safety",
];
