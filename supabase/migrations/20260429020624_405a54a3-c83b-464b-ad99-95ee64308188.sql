SELECT public.execute_decisions_all_tenants();
SELECT public.measure_pending_outcomes();
SELECT * FROM public.acos_loop_overview ORDER BY tenant_name;