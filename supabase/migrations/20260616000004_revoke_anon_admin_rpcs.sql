-- ============================================================
-- Revoke anon access from admin/owner-only RPC functions.
--
-- These three functions were incorrectly granted to the `anon`
-- role, leaking operational intelligence (agent settings, ROI
-- metrics) to any unauthenticated visitor.
--
-- get_agent_permission    — exposes auto-apply mode & max risk
-- can_auto_apply_action   — exposes agent auto-apply status
-- get_owner_roi_summary   — exposes revenue KPIs & win rates
-- ============================================================

-- Revoke anon; authenticated users must also be tenant members
-- (the functions themselves do not enforce this, so at minimum
--  we require an active Supabase session).
REVOKE EXECUTE ON FUNCTION public.get_agent_permission(uuid, text)
  FROM anon;

REVOKE EXECUTE ON FUNCTION public.can_auto_apply_action(uuid, text, public.agent_risk_level)
  FROM anon;

REVOKE EXECUTE ON FUNCTION public.get_owner_roi_summary(uuid)
  FROM anon;
