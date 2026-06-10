---
name: realtime-revenue-pulse
description: Live 24h revenue sparkline tile on /brand dashboard, subscribes to orders via Supabase Realtime for sub-second updates and pulse-glow on new paid orders
type: feature
---

RealtimeRevenuePulse (`src/components/owner/RealtimeRevenuePulse.tsx`) — tile під CockpitHero на /brand.

- 24-годинний sparkline по hour-buckets (orders.paid_at, status='paid')
- Subscribe `postgres_changes` event=\* table=orders filter=tenant_id=eq.{id} → на paid+paid_at інкрементує liveDelta лічильник, тригерить refetch і pulse-glow на 1.5s (border-primary + shadow color-mix primary 60%)
- Badge "REALTIME" з animate-pulse
- Liva-delta показується inline: "+N (+X грн) щойно"
- Realtime publication: `orders` додано до `supabase_realtime` (migration 2026-05-05).
- Інші realtime-кандидати на майбутнє: ai_insights, acos_decisions, owner_notifications.
