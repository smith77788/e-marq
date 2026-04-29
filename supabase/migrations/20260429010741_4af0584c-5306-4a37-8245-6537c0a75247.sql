
REVOKE EXECUTE ON FUNCTION public.refresh_product_metrics_14d(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.refresh_customer_metrics_30d(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.refresh_funnel_metrics_14d(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.refresh_all_signal_metrics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_all_signal_metrics() TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_product_metrics_14d(uuid) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_customer_metrics_30d(uuid) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_funnel_metrics_14d(uuid) TO service_role, authenticated;
