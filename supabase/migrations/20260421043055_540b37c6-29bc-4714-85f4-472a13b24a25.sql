ALTER TABLE public.acos_agent_runs
DROP CONSTRAINT IF EXISTS acos_agent_runs_status_check;

ALTER TABLE public.acos_agent_runs
ADD CONSTRAINT acos_agent_runs_status_check
CHECK (
  status = ANY (ARRAY['running'::text, 'success'::text, 'failed'::text, 'failure'::text, 'skipped'::text])
);