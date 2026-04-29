CREATE OR REPLACE FUNCTION public._decision_semantic_key(_action_type text, _payload jsonb, _insight_type text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
    NULLIF(_payload->>'action', ''),
    NULLIF(_payload->>'task_key', ''),
    NULLIF(_payload->>'insight_type', ''),
    NULLIF(_insight_type, ''),
    NULLIF(_payload->>'insight_id', ''),
    'unspecified'
  );
$$;

-- Restore decisions that were rejected by overly-broad dedup
UPDATE public.decision_queue
SET status = 'pending', rejected_reason = NULL, updated_at = now()
WHERE status='rejected' AND rejected_reason='semantic_duplicate'
  AND created_at > now() - interval '1 day';

-- Re-run cleanup with corrected key
WITH ranked AS (
  SELECT dq.id,
         row_number() OVER (
           PARTITION BY dq.tenant_id, dq.action_type,
                        public._decision_semantic_key(dq.action_type, dq.payload, ai.insight_type)
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