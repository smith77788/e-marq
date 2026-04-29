
CREATE OR REPLACE VIEW public.acos_loop_overview AS
SELECT
  t.id AS tenant_id,
  t.name AS tenant_name,
  COALESCE(i.insights_30d, 0)        AS insights_30d,
  COALESCE(i.insights_new, 0)        AS insights_new,
  COALESCE(d.decisions_30d, 0)       AS decisions_30d,
  COALESCE(d.decisions_pending, 0)   AS decisions_pending,
  COALESCE(d.decisions_approved, 0)  AS decisions_approved,
  COALESCE(d.decisions_done, 0)      AS decisions_done,
  COALESCE(d.decisions_rejected, 0)  AS decisions_rejected,
  COALESCE(d.decisions_failed, 0)    AS decisions_failed,
  COALESCE(o.outcomes_total, 0)      AS outcomes_total,
  COALESCE(o.outcomes_measured, 0)   AS outcomes_measured,
  COALESCE(o.outcomes_success, 0)    AS outcomes_success,
  COALESCE(o.attributed_revenue_cents, 0) AS attributed_revenue_cents,
  CASE WHEN COALESCE(o.outcomes_measured,0) > 0
       THEN ROUND(o.outcomes_success::numeric / o.outcomes_measured, 3)
       ELSE NULL END                  AS success_rate
FROM public.tenants t
LEFT JOIN (
  SELECT tenant_id,
    COUNT(*) FILTER (WHERE created_at >= now() - interval '30 days') AS insights_30d,
    COUNT(*) FILTER (WHERE status = 'new') AS insights_new
  FROM public.ai_insights GROUP BY tenant_id
) i ON i.tenant_id = t.id
LEFT JOIN (
  SELECT tenant_id,
    COUNT(*) FILTER (WHERE created_at >= now() - interval '30 days') AS decisions_30d,
    COUNT(*) FILTER (WHERE status = 'pending')  AS decisions_pending,
    COUNT(*) FILTER (WHERE status = 'approved') AS decisions_approved,
    COUNT(*) FILTER (WHERE status = 'done')     AS decisions_done,
    COUNT(*) FILTER (WHERE status = 'rejected') AS decisions_rejected,
    COUNT(*) FILTER (WHERE status = 'failed')   AS decisions_failed
  FROM public.decision_queue GROUP BY tenant_id
) d ON d.tenant_id = t.id
LEFT JOIN (
  SELECT tenant_id,
    COUNT(*) AS outcomes_total,
    COUNT(success) AS outcomes_measured,
    COUNT(*) FILTER (WHERE success IS TRUE) AS outcomes_success,
    COALESCE(SUM(attributed_revenue_cents),0) AS attributed_revenue_cents
  FROM public.action_outcomes GROUP BY tenant_id
) o ON o.tenant_id = t.id;

CREATE OR REPLACE VIEW public.agent_performance_30d AS
SELECT
  ao.tenant_id,
  ao.agent_id,
  ao.action_type,
  COUNT(*)                                          AS executions,
  COUNT(success)                                    AS measured,
  COUNT(*) FILTER (WHERE success IS TRUE)           AS successes,
  COALESCE(SUM(ao.attributed_revenue_cents),0)      AS revenue_cents,
  ROUND(AVG(CASE WHEN success IS TRUE THEN 1 WHEN success IS FALSE THEN 0 END), 3) AS success_rate,
  MAX(ao.measured_at)                               AS last_measured_at
FROM public.action_outcomes ao
WHERE ao.measured_at >= now() - interval '30 days'
GROUP BY ao.tenant_id, ao.agent_id, ao.action_type;

GRANT SELECT ON public.acos_loop_overview TO authenticated;
GRANT SELECT ON public.agent_performance_30d TO authenticated;
