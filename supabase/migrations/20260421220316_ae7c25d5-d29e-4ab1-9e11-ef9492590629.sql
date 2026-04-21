CREATE TABLE IF NOT EXISTS public.loyalty_programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Програма лояльності',
  points_per_100_uah INTEGER NOT NULL DEFAULT 1,
  uah_per_point NUMERIC NOT NULL DEFAULT 1.0,
  min_redeem_points INTEGER NOT NULL DEFAULT 100,
  tiers JSONB NOT NULL DEFAULT '[
    {"name":"Бронза","min_points":0,"discount_pct":0},
    {"name":"Срібло","min_points":500,"discount_pct":5},
    {"name":"Золото","min_points":2000,"discount_pct":10},
    {"name":"Платина","min_points":5000,"discount_pct":15}
  ]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_loyalty_programs_updated_at ON public.loyalty_programs;
CREATE TRIGGER trg_loyalty_programs_updated_at BEFORE UPDATE ON public.loyalty_programs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.loyalty_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_email TEXT NOT NULL,
  balance_points INTEGER NOT NULL DEFAULT 0,
  lifetime_points INTEGER NOT NULL DEFAULT 0,
  tier TEXT NOT NULL DEFAULT 'bronze',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, customer_email)
);
CREATE INDEX IF NOT EXISTS idx_loyalty_tenant_email ON public.loyalty_accounts(tenant_id, customer_email);
DROP TRIGGER IF EXISTS trg_loyalty_accounts_updated_at ON public.loyalty_accounts;
CREATE TRIGGER trg_loyalty_accounts_updated_at BEFORE UPDATE ON public.loyalty_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.loyalty_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.loyalty_accounts(id) ON DELETE CASCADE,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('earn','redeem','expire','bonus','refund')),
  points INTEGER NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_loyalty_tx_account ON public.loyalty_transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_tx_tenant ON public.loyalty_transactions(tenant_id);

ALTER TABLE public.loyalty_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "loyalty_programs_member_read" ON public.loyalty_programs;
CREATE POLICY "loyalty_programs_member_read" ON public.loyalty_programs FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));
DROP POLICY IF EXISTS "loyalty_programs_admin_write" ON public.loyalty_programs;
CREATE POLICY "loyalty_programs_admin_write" ON public.loyalty_programs FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id))
  WITH CHECK (public.is_super_admin() OR public.is_tenant_admin(tenant_id));
DROP POLICY IF EXISTS "loyalty_programs_anon_read" ON public.loyalty_programs;
CREATE POLICY "loyalty_programs_anon_read" ON public.loyalty_programs FOR SELECT TO anon
  USING (is_active = true);

DROP POLICY IF EXISTS "loyalty_accounts_member_read" ON public.loyalty_accounts;
CREATE POLICY "loyalty_accounts_member_read" ON public.loyalty_accounts FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));
DROP POLICY IF EXISTS "loyalty_accounts_admin_write" ON public.loyalty_accounts;
CREATE POLICY "loyalty_accounts_admin_write" ON public.loyalty_accounts FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id))
  WITH CHECK (public.is_super_admin() OR public.is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "loyalty_tx_member_read" ON public.loyalty_transactions;
CREATE POLICY "loyalty_tx_member_read" ON public.loyalty_transactions FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));
DROP POLICY IF EXISTS "loyalty_tx_admin_write" ON public.loyalty_transactions;
CREATE POLICY "loyalty_tx_admin_write" ON public.loyalty_transactions FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id))
  WITH CHECK (public.is_super_admin() OR public.is_tenant_admin(tenant_id));