
CREATE OR REPLACE FUNCTION public.refresh_all_signal_metrics()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _t record; _result jsonb := '[]'::jsonb; _pm int; _cm int; _fm int;
BEGIN
  FOR _t IN
    SELECT id FROM public.tenants
    WHERE status IN ('active','verified','live','approved') OR status IS NULL
  LOOP
    BEGIN
      _pm := public.refresh_product_metrics_14d(_t.id);
      _cm := public.refresh_customer_metrics_30d(_t.id);
      _fm := public.refresh_funnel_metrics_14d(_t.id);
      _result := _result || jsonb_build_object('tenant_id', _t.id, 'pm14', _pm, 'cm30', _cm, 'fm14', _fm);
    EXCEPTION WHEN OTHERS THEN
      _result := _result || jsonb_build_object('tenant_id', _t.id, 'error', SQLERRM);
    END;
  END LOOP;
  RETURN _result;
END $$;
REVOKE EXECUTE ON FUNCTION public.refresh_all_signal_metrics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_all_signal_metrics() TO service_role;
