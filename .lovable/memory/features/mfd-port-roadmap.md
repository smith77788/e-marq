---
name: MFD → ACOS port roadmap
description: Mapping 88 MFD acos-* edge functions to 45 generalized ACOS agents in 9 batches
type: feature
---
**Strategy**: 40-50 generalized agents (not 1:1 port). Full MFD-stack tables (22) added in batch 0.
**Done**: Batch 0 (22 tables + RLS), Batch 1 (margin-optimizer, ltv-predictor, cart-recovery, anomaly-detector, morning-brief), Batch 2 (bundle-recommender, promo-fatigue, promo-portfolio, discount-elasticity, predictive-pricing), Batch 3 (cohort-engine, attribution, funnel-healer, browse-abandonment, second-order-nurture).
**Remaining batches** (5 agents each):
- B4: bot-sequences, broadcast-composer, best-time-to-send, csat-dispatcher, nurture-roi
- B5: seo-rewriter, content-velocity, ugc-harvester, search-intent-miner, programmatic-seo
- B6: customer-segments-auto, loyalty-tiers, product-affinity, customer-churn-predictor, first-order-funnel
- B7: inventory-forecast, restock-alert, anti-fraud, action-watchdog, conflict-resolver
- B8: social-proof-live, broadcast-roi, winback-roi, elasticity-meta-loop, learning-loop-monitor
- B9: notification-router, daily-digest-v2, owner-playbook, meta-prior-injector, autonomous-seo-loop
**Skipped (MFD-specific, not portable)**: monobank-*, telegram-poll (already have), respeecher-tts, generate-blog-covers (need image gen budget per tenant), instagram-sync.
