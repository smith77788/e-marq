INSERT INTO public.auto_approval_policy (action_type, enabled, max_age_hours, min_success_history, notes)
VALUES ('bundle_suggest', true, 72, 0, 'Bundle Suggestion Engine (SQL agent #12) — apriori cross-product mining; bootstrap auto-approve up to 3/tenant until causal lift measured')
ON CONFLICT (action_type) DO UPDATE SET enabled=true, max_age_hours=72;