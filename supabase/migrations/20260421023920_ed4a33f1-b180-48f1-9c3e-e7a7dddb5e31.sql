-- RPC to create or refresh a tenant invitation; returns token + invite URL data.
CREATE OR REPLACE FUNCTION public.create_tenant_invitation(
  _tenant_id uuid,
  _email text,
  _role text DEFAULT 'admin'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(trim(_email));
  v_token text;
  v_id uuid;
  v_expires timestamptz;
BEGIN
  IF NOT (public.is_super_admin() OR public.is_tenant_admin(_tenant_id)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_email IS NULL OR v_email = '' OR v_email !~ '^[^@]+@[^@]+\.[^@]+$' THEN
    RAISE EXCEPTION 'invalid email' USING ERRCODE = '22023';
  END IF;

  IF _role NOT IN ('admin','editor','viewer') THEN
    RAISE EXCEPTION 'invalid role' USING ERRCODE = '22023';
  END IF;

  -- Try to refresh existing pending invitation; otherwise insert new
  UPDATE public.tenant_invitations
     SET expires_at = now() + interval '14 days',
         role = _role,
         invited_by = auth.uid()
   WHERE tenant_id = _tenant_id
     AND lower(email) = v_email
     AND status = 'pending'
   RETURNING id, token, expires_at INTO v_id, v_token, v_expires;

  IF v_id IS NULL THEN
    INSERT INTO public.tenant_invitations (tenant_id, email, role, invited_by)
    VALUES (_tenant_id, v_email, _role, auth.uid())
    RETURNING id, token, expires_at INTO v_id, v_token, v_expires;
  END IF;

  RETURN jsonb_build_object(
    'invitation_id', v_id,
    'token', v_token,
    'email', v_email,
    'role', _role,
    'expires_at', v_expires
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_tenant_invitation(uuid, text, text) TO authenticated;