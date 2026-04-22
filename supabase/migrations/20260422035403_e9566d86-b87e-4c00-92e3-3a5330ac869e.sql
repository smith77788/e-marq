-- 1) Make is_tenant_member super-admin-aware so admins inherit access
CREATE OR REPLACE FUNCTION public.is_tenant_member(_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.tenant_memberships
      WHERE tenant_id = _tenant_id AND user_id = auth.uid()
    );
$$;

-- 2) Allow inserting brand profiles (was blocked: empty WITH CHECK)
DROP POLICY IF EXISTS "site_brand_profiles insert" ON public.site_brand_profiles;
CREATE POLICY "site_brand_profiles insert"
ON public.site_brand_profiles
FOR INSERT
TO authenticated
WITH CHECK (public.is_tenant_member(tenant_id) OR public.is_super_admin());

-- And site_builds insert (was also empty)
DROP POLICY IF EXISTS "site_builds insert" ON public.site_builds;
CREATE POLICY "site_builds insert"
ON public.site_builds
FOR INSERT
TO authenticated
WITH CHECK (public.is_tenant_member(tenant_id) OR public.is_super_admin());

-- 3) Manager-driven top-up requests
CREATE TABLE IF NOT EXISTS public.topup_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  credits integer NOT NULL CHECK (credits >= 100),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'UAH',
  payment_method text NOT NULL DEFAULT 'card'
    CHECK (payment_method IN ('card','bank','crypto','other')),
  contact text,
  note text,
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','in_review','paid','cancelled')),
  manager_note text,
  handled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  handled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS topup_requests_tenant_created_idx
  ON public.topup_requests (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS topup_requests_status_idx
  ON public.topup_requests (status, created_at DESC);

ALTER TABLE public.topup_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "topup_requests select"
ON public.topup_requests FOR SELECT TO authenticated
USING (public.is_tenant_member(tenant_id) OR public.is_super_admin());

CREATE POLICY "topup_requests insert"
ON public.topup_requests FOR INSERT TO authenticated
WITH CHECK (public.is_tenant_member(tenant_id) OR public.is_super_admin());

CREATE POLICY "topup_requests update by member"
ON public.topup_requests FOR UPDATE TO authenticated
USING (public.is_tenant_member(tenant_id) OR public.is_super_admin())
WITH CHECK (public.is_tenant_member(tenant_id) OR public.is_super_admin());

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_topup_requests()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS topup_requests_touch ON public.topup_requests;
CREATE TRIGGER topup_requests_touch
BEFORE UPDATE ON public.topup_requests
FOR EACH ROW EXECUTE FUNCTION public.touch_topup_requests();