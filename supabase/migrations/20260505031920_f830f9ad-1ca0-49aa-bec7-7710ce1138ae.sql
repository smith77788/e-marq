
ALTER FUNCTION public.compute_bundle_suggestions(int,numeric,numeric,int) RENAME TO _compute_bundle_suggestions_v1;

CREATE OR REPLACE FUNCTION public.compute_bundle_suggestions(
  _window_days int DEFAULT 90,
  _min_support_pct numeric DEFAULT 2.0,
  _min_lift numeric DEFAULT 1.05,
  _min_co_orders int DEFAULT 5
)
RETURNS TABLE(processed_tenants int, pairs_inserted int, pairs_updated int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM public._compute_bundle_suggestions_v1(_window_days, _min_support_pct, _min_lift, _min_co_orders) LOOP
    processed_tenants := r.processed_tenants;
    pairs_inserted := r.pairs_inserted;
    pairs_updated := r.pairs_updated;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.compute_bundle_suggestions(int,numeric,numeric,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_bundle_suggestions(int,numeric,numeric,int) TO service_role;

DO $$
DECLARE _e record; _i record;
BEGIN
  SELECT * INTO _e FROM public.compute_bundle_suggestions();
  SELECT * INTO _i FROM public.detect_bundle_signals();
  RAISE NOTICE 'engine tenants=% ins=% upd=% insights=%',
    _e.processed_tenants, _e.pairs_inserted, _e.pairs_updated, _i.insights_created;
END $$;
