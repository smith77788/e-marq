
-- Phase 16: trigger immediate auto-approve to validate skip_reason tagging
SELECT public.auto_approve_eligible_decisions();
