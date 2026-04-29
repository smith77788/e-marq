CREATE OR REPLACE FUNCTION public._decision_semantic_key(_action_type text, _payload jsonb, _insight_type text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
    NULLIF(_payload->>'action', ''),
    NULLIF(_payload->>'task_key', ''),
    NULLIF(_payload->>'insight_type', ''),
    NULLIF(_insight_type, ''),
    NULLIF(_payload->>'product_id', ''),
    NULLIF(_payload->>'customer_id', ''),
    NULLIF(_payload->>'insight_id', ''),
    'unspecified'
  );
$$;

-- Add overload that takes title as last-resort key
CREATE OR REPLACE FUNCTION public._decision_semantic_key_full(_action_type text, _payload jsonb, _insight_type text, _title text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
    NULLIF(_payload->>'action', ''),
    NULLIF(_payload->>'task_key', ''),
    NULLIF(_payload->>'insight_type', ''),
    NULLIF(_insight_type, ''),
    NULLIF(_payload->>'product_id', ''),
    NULLIF(_payload->>'customer_id', ''),
    NULLIF(_payload->>'insight_id', ''),
    NULLIF(lower(regexp_replace(COALESCE(_title,''), '\s+', ' ', 'g')), ''),
    'unspecified'
  );
$$;

-- Re-cleanup using full key (title-aware)
WITH ranked AS (
  SELECT dq.id,
         row_number() OVER (
           PARTITION BY dq.tenant_id, dq.action_type,
                        public._decision_semantic_key_full(dq.action_type, dq.payload, ai.insight_type, dq.title)
           ORDER BY dq.created_at ASC
         ) AS rn
  FROM public.decision_queue dq
  LEFT JOIN public.ai_insights ai ON ai.id = dq.insight_id
  WHERE dq.status = 'pending'
)
UPDATE public.decision_queue
SET status = 'rejected',
    rejected_reason = 'semantic_duplicate',
    updated_at = now()
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Update converter to use full key
CREATE OR REPLACE FUNCTION public.convert_insights_to_decisions()
RETURNS TABLE(converted integer, skipped integer, by_action jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_converted int := 0;
  v_skipped   int := 0;
  v_by jsonb := '{}'::jsonb;
  i RECORD;
  v_action text;
  v_owner_action bool;
  v_new_id uuid;
  v_impact jsonb;
  v_sem_key text;
  v_payload jsonb;
  v_title text;
BEGIN
  FOR i IN
    SELECT * FROM public.ai_insights
     WHERE status IN ('new','in_review')
       AND created_at > now() - interval '30 days'
     ORDER BY created_at ASC
     LIMIT 500
  LOOP
    v_action := public._map_insight_to_action(i.insight_type);
    IF v_action IS NULL THEN
      UPDATE public.ai_insights SET status='applied', updated_at=now() WHERE id=i.id;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;
    v_owner_action := v_action IN ('owner_setup_task','owner_review','flag_for_review');

    v_impact := CASE
      WHEN i.expected_impact IS NULL OR i.expected_impact = '' THEN '{}'::jsonb
      ELSE jsonb_build_object('summary', i.expected_impact)
    END;

    v_payload := jsonb_build_object(
      'insight_id', i.id, 'insight_type', i.insight_type,
      'metrics', i.metrics, 'risk_level', i.risk_level,
      'requires_owner', v_owner_action
    );
    IF i.metrics ? 'action' THEN
      v_payload := v_payload || jsonb_build_object('action', i.metrics->>'action');
    END IF;

    v_title := COALESCE(NULLIF(i.title,''), i.insight_type);
    v_sem_key := public._decision_semantic_key_full(v_action, v_payload, i.insight_type, v_title);

    IF EXISTS (
      SELECT 1 FROM public.decision_queue dq WHERE dq.insight_id = i.id
    ) THEN
      UPDATE public.ai_insights SET status='applied', updated_at=now() WHERE id=i.id;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.decision_queue dq
       LEFT JOIN public.ai_insights ai2 ON ai2.id = dq.insight_id
       WHERE dq.tenant_id = i.tenant_id
         AND dq.action_type = v_action
         AND dq.status IN ('pending','approved')
         AND public._decision_semantic_key_full(dq.action_type, dq.payload, ai2.insight_type, dq.title) = v_sem_key
    ) THEN
      UPDATE public.ai_insights SET status='applied', updated_at=now() WHERE id=i.id;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.decision_queue(
      tenant_id, insight_id, agent_id, action_type, title, rationale,
      payload, status, confidence, expected_impact, requires_approval,
      created_at, updated_at
    ) VALUES (
      i.tenant_id, i.id, 'sql_insight_converter', v_action,
      v_title, i.description, v_payload, 'pending',
      COALESCE(i.confidence, 0.5), v_impact, v_owner_action, now(), now()
    ) RETURNING id INTO v_new_id;

    UPDATE public.ai_insights SET status='applied', updated_at=now() WHERE id=i.id;
    v_converted := v_converted + 1;
    v_by := jsonb_set(v_by, ARRAY[v_action], to_jsonb(COALESCE((v_by->>v_action)::int,0)+1));
  END LOOP;

  RETURN QUERY SELECT v_converted, v_skipped, v_by;
END;
$function$;