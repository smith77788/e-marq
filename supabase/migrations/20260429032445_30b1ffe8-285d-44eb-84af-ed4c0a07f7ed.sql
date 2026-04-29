-- Defense in depth: revoke EXECUTE from anon on internal functions.
-- These functions still validate auth internally, but should not be exposed to public.
REVOKE EXECUTE ON FUNCTION public.admin_set_cron_job_command(text, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_repair_cron_auth(text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.notify_owner_telegram(uuid, text, uuid) FROM anon, public;

-- Keep EXECUTE for authenticated (tenant members) and service_role.
GRANT EXECUTE ON FUNCTION public.admin_set_cron_job_command(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_repair_cron_auth(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notify_owner_telegram(uuid, text, uuid) TO authenticated, service_role;