CREATE OR REPLACE FUNCTION public.get_effective_limit(_tenant_id uuid, _limit_key text)
RETURNS bigint
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _override jsonb;
  _override_val bigint;
  _plan_val bigint;
BEGIN
  SELECT s.overrides
  INTO _override
  FROM public.tenant_subscriptions s
  WHERE s.tenant_id = _tenant_id;

  -- check override first
  IF _override IS NOT NULL AND _override ? _limit_key THEN
    BEGIN
      _override_val := (_override ->> _limit_key)::bigint;
      RETURN _override_val;
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;

  -- fall back to plan column
  EXECUTE format('SELECT %I FROM public.plans p JOIN public.tenant_subscriptions s ON s.plan_id = p.id WHERE s.tenant_id = $1', _limit_key)
    INTO _plan_val USING _tenant_id;

  RETURN _plan_val;
END;
$function$;