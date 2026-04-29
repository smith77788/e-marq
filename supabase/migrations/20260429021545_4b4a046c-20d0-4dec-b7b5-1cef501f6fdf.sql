-- Унікальний ключ для UPSERT (якщо ще немає)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_health_unique_per_day'
  ) THEN
    -- tenant_id може бути NULL → використовуємо partial unique index, бо UNIQUE constraint не працює з NULL
    CREATE UNIQUE INDEX IF NOT EXISTS agent_health_unique_per_day_t
      ON public.agent_health (tenant_id, agent_id, measured_on)
      WHERE tenant_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS agent_health_unique_per_day_g
      ON public.agent_health (agent_id, measured_on)
      WHERE tenant_id IS NULL;
  END IF;
END$$;

CREATE OR REPLACE FUNCTION public.compute_agent_health_daily()
RETURNS TABLE(rows_upserted int) LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public' AS $$
DECLARE
  v_n int := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT
      tenant_id,
      agent_id,
      current_date AS measured_on,
      COUNT(*)::int AS runs_total,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END)::int AS runs_failed,
      0::int AS insights_created,
      0::int AS insights_approved,
      0::int AS insights_dismissed,
      0::bigint AS measured_revenue_lift_cents
    FROM public.acos_agent_runs
    WHERE started_at::date = current_date
    GROUP BY tenant_id, agent_id
  LOOP
    IF r.tenant_id IS NULL THEN
      INSERT INTO public.agent_health(
        tenant_id, agent_id, measured_on, runs_total, runs_failed,
        insights_created, insights_approved, insights_dismissed,
        measured_revenue_lift_cents, health_score
      ) VALUES (
        NULL, r.agent_id, r.measured_on, r.runs_total, r.runs_failed,
        0, 0, 0, 0,
        CASE WHEN r.runs_total > 0
             THEN ROUND(1.0 - r.runs_failed::numeric / r.runs_total, 2)
             ELSE NULL END
      )
      ON CONFLICT (agent_id, measured_on) WHERE tenant_id IS NULL
      DO UPDATE SET
        runs_total = EXCLUDED.runs_total,
        runs_failed = EXCLUDED.runs_failed,
        health_score = EXCLUDED.health_score;
    ELSE
      INSERT INTO public.agent_health(
        tenant_id, agent_id, measured_on, runs_total, runs_failed,
        insights_created, insights_approved, insights_dismissed,
        measured_revenue_lift_cents, health_score
      ) VALUES (
        r.tenant_id, r.agent_id, r.measured_on, r.runs_total, r.runs_failed,
        0, 0, 0, 0,
        CASE WHEN r.runs_total > 0
             THEN ROUND(1.0 - r.runs_failed::numeric / r.runs_total, 2)
             ELSE NULL END
      )
      ON CONFLICT (tenant_id, agent_id, measured_on) WHERE tenant_id IS NOT NULL
      DO UPDATE SET
        runs_total = EXCLUDED.runs_total,
        runs_failed = EXCLUDED.runs_failed,
        health_score = EXCLUDED.health_score;
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN QUERY SELECT v_n;
END;
$$;

-- cron — щогодини
SELECT cron.unschedule('agent-health-hourly') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='agent-health-hourly');
SELECT cron.schedule('agent-health-hourly','7 * * * *', $cron$SELECT public.compute_agent_health_daily();$cron$);

-- Прогон одразу
SELECT * FROM public.compute_agent_health_daily();