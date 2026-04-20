---
name: MFD → ACOS port roadmap
description: Mapping 88 MFD acos-* edge functions to 45 generalized ACOS agents in 9 batches
type: feature
---
**Strategy**: 40-50 generalized agents (not 1:1 port). Full MFD-stack tables (22) added in batch 0.
**Status**: COMPLETE — 45/45 agents ported across B1-B9.
**Done**: B0 (22 tables + RLS), B1-B7 as before, B8 (social-proof-live, broadcast-roi, winback-roi, elasticity-meta-loop, learning-loop-monitor), B9 (notification-router, daily-digest-v2, owner-playbook, meta-prior-injector, autonomous-seo-loop).
**All 45 wired into** `agents.run-all.ts` orchestrator. Localized copy (UA+EN) added for every insight type in `src/lib/acos/insightCopy.ts`.
**Skipped (MFD-specific, not portable)**: monobank-*, telegram-poll (already have), respeecher-tts, generate-blog-covers (need image gen budget per tenant), instagram-sync.
