-- =====================================================
-- ACOS-ULTRA FOUNDATION
-- Multi-tenant SaaS core for D2C e-commerce brands
-- =====================================================

-- ---------- ENUMS ----------
CREATE TYPE public.app_role AS ENUM ('super_admin');
CREATE TYPE public.tenant_role AS ENUM ('owner', 'admin', 'member');
CREATE TYPE public.tenant_status AS ENUM ('active', 'suspended', 'archived');
CREATE TYPE public.order_status AS ENUM ('pending', 'paid', 'fulfilled', 'cancelled', 'refunded');
CREATE TYPE public.event_type AS ENUM (
  'product_viewed',
  'add_to_cart',
  'checkout_started',
  'purchase_completed',
  'reorder_clicked',
  'bot_interaction',
  'content_viewed'
);

-- ---------- UTILITY: updated_at trigger ----------
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------- TENANTS ----------
CREATE TABLE public.tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status public.tenant_status NOT NULL DEFAULT 'active',
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tenants_owner ON public.tenants(owner_user_id);
CREATE INDEX idx_tenants_status ON public.tenants(status);

CREATE TRIGGER trg_tenants_updated_at
BEFORE UPDATE ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- USER_ROLES (global roles, super_admin only) ----------
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
CREATE INDEX idx_user_roles_user ON public.user_roles(user_id);

-- ---------- TENANT_MEMBERSHIPS ----------
CREATE TABLE public.tenant_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.tenant_role NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);
CREATE INDEX idx_memberships_user ON public.tenant_memberships(user_id);
CREATE INDEX idx_memberships_tenant ON public.tenant_memberships(tenant_id);

-- ---------- SECURITY DEFINER FUNCTIONS ----------
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'super_admin');
$$;

CREATE OR REPLACE FUNCTION public.is_tenant_member(_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_memberships
    WHERE tenant_id = _tenant_id AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_tenant_admin(_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_memberships
    WHERE tenant_id = _tenant_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin')
  );
$$;

-- ---------- PRODUCTS ----------
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  sku TEXT,
  name TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  image_url TEXT,
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, sku)
);
CREATE INDEX idx_products_tenant ON public.products(tenant_id);
CREATE INDEX idx_products_active ON public.products(tenant_id, is_active);

CREATE TRIGGER trg_products_updated_at
BEFORE UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- ORDERS ----------
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  customer_email TEXT,
  customer_name TEXT,
  status public.order_status NOT NULL DEFAULT 'pending',
  total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_orders_tenant ON public.orders(tenant_id);
CREATE INDEX idx_orders_customer ON public.orders(customer_user_id);
CREATE INDEX idx_orders_status ON public.orders(tenant_id, status);
CREATE INDEX idx_orders_created ON public.orders(tenant_id, created_at DESC);

CREATE TRIGGER trg_orders_updated_at
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- ORDER_ITEMS ----------
CREATE TABLE public.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_order_items_order ON public.order_items(order_id);
CREATE INDEX idx_order_items_tenant ON public.order_items(tenant_id);

-- ---------- EVENTS (event-driven reality) ----------
CREATE TABLE public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  type public.event_type NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id TEXT,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_events_tenant_type_time ON public.events(tenant_id, type, created_at DESC);
CREATE INDEX idx_events_tenant_time ON public.events(tenant_id, created_at DESC);
CREATE INDEX idx_events_session ON public.events(tenant_id, session_id);

-- ---------- TENANT_CONFIGS (control layer) ----------
CREATE TABLE public.tenant_configs (
  tenant_id UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  brand_name TEXT NOT NULL,
  ui JSONB NOT NULL DEFAULT '{}'::jsonb,
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  bot JSONB NOT NULL DEFAULT '{}'::jsonb,
  seo JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_tenant_configs_updated_at
BEFORE UPDATE ON public.tenant_configs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- AUTO-MEMBERSHIP for tenant owner ----------
CREATE OR REPLACE FUNCTION public.ensure_owner_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.tenant_memberships (tenant_id, user_id, role)
  VALUES (NEW.id, NEW.owner_user_id, 'owner')
  ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'owner';

  INSERT INTO public.tenant_configs (tenant_id, brand_name)
  VALUES (NEW.id, NEW.name)
  ON CONFLICT (tenant_id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tenants_owner_membership
AFTER INSERT ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.ensure_owner_membership();

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_configs ENABLE ROW LEVEL SECURITY;

-- ---------- tenants policies ----------
CREATE POLICY "tenants_select_member_or_super"
ON public.tenants FOR SELECT
TO authenticated
USING (public.is_super_admin() OR public.is_tenant_member(id));

CREATE POLICY "tenants_insert_authenticated_self_owner"
ON public.tenants FOR INSERT
TO authenticated
WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY "tenants_update_admin_or_super"
ON public.tenants FOR UPDATE
TO authenticated
USING (public.is_super_admin() OR public.is_tenant_admin(id))
WITH CHECK (public.is_super_admin() OR public.is_tenant_admin(id));

CREATE POLICY "tenants_delete_super_only"
ON public.tenants FOR DELETE
TO authenticated
USING (public.is_super_admin());

-- ---------- user_roles policies (super_admin only manages) ----------
CREATE POLICY "user_roles_select_super_or_self"
ON public.user_roles FOR SELECT
TO authenticated
USING (public.is_super_admin() OR user_id = auth.uid());

CREATE POLICY "user_roles_super_only_write"
ON public.user_roles FOR ALL
TO authenticated
USING (public.is_super_admin())
WITH CHECK (public.is_super_admin());

-- ---------- tenant_memberships policies ----------
CREATE POLICY "memberships_select_self_or_tenant_admin_or_super"
ON public.tenant_memberships FOR SELECT
TO authenticated
USING (
  public.is_super_admin()
  OR user_id = auth.uid()
  OR public.is_tenant_admin(tenant_id)
);

CREATE POLICY "memberships_insert_admin_or_super"
ON public.tenant_memberships FOR INSERT
TO authenticated
WITH CHECK (public.is_super_admin() OR public.is_tenant_admin(tenant_id));

CREATE POLICY "memberships_update_admin_or_super"
ON public.tenant_memberships FOR UPDATE
TO authenticated
USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id))
WITH CHECK (public.is_super_admin() OR public.is_tenant_admin(tenant_id));

CREATE POLICY "memberships_delete_admin_or_super"
ON public.tenant_memberships FOR DELETE
TO authenticated
USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id));

-- ---------- products policies ----------
-- Public read of active products (storefront/bot needs this)
CREATE POLICY "products_public_read_active"
ON public.products FOR SELECT
TO anon, authenticated
USING (is_active = true OR public.is_super_admin() OR public.is_tenant_member(tenant_id));

CREATE POLICY "products_insert_tenant_member"
ON public.products FOR INSERT
TO authenticated
WITH CHECK (public.is_super_admin() OR public.is_tenant_member(tenant_id));

CREATE POLICY "products_update_tenant_member"
ON public.products FOR UPDATE
TO authenticated
USING (public.is_super_admin() OR public.is_tenant_member(tenant_id))
WITH CHECK (public.is_super_admin() OR public.is_tenant_member(tenant_id));

CREATE POLICY "products_delete_tenant_admin"
ON public.products FOR DELETE
TO authenticated
USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id));

-- ---------- orders policies ----------
CREATE POLICY "orders_select_tenant_or_customer_or_super"
ON public.orders FOR SELECT
TO authenticated
USING (
  public.is_super_admin()
  OR public.is_tenant_member(tenant_id)
  OR customer_user_id = auth.uid()
);

-- Anyone (incl. anon checkout) may create an order; integrity enforced by app + total recompute trigger later
CREATE POLICY "orders_insert_public"
ON public.orders FOR INSERT
TO anon, authenticated
WITH CHECK (true);

CREATE POLICY "orders_update_tenant_member"
ON public.orders FOR UPDATE
TO authenticated
USING (public.is_super_admin() OR public.is_tenant_member(tenant_id))
WITH CHECK (public.is_super_admin() OR public.is_tenant_member(tenant_id));

CREATE POLICY "orders_delete_super_only"
ON public.orders FOR DELETE
TO authenticated
USING (public.is_super_admin());

-- ---------- order_items policies ----------
CREATE POLICY "order_items_select_tenant_or_super"
ON public.order_items FOR SELECT
TO authenticated
USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));

CREATE POLICY "order_items_insert_public"
ON public.order_items FOR INSERT
TO anon, authenticated
WITH CHECK (true);

CREATE POLICY "order_items_update_tenant_member"
ON public.order_items FOR UPDATE
TO authenticated
USING (public.is_super_admin() OR public.is_tenant_member(tenant_id))
WITH CHECK (public.is_super_admin() OR public.is_tenant_member(tenant_id));

CREATE POLICY "order_items_delete_tenant_admin"
ON public.order_items FOR DELETE
TO authenticated
USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id));

-- ---------- events policies ----------
-- Public WRITE (anonymous shoppers generate events). READ restricted to tenant members.
CREATE POLICY "events_insert_public"
ON public.events FOR INSERT
TO anon, authenticated
WITH CHECK (true);

CREATE POLICY "events_select_tenant_or_super"
ON public.events FOR SELECT
TO authenticated
USING (public.is_super_admin() OR public.is_tenant_member(tenant_id));

-- No UPDATE/DELETE on events (immutable log)

-- ---------- tenant_configs policies ----------
-- Public read so storefront/bot can pull brand config without auth
CREATE POLICY "tenant_configs_public_read"
ON public.tenant_configs FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "tenant_configs_insert_admin_or_super"
ON public.tenant_configs FOR INSERT
TO authenticated
WITH CHECK (public.is_super_admin() OR public.is_tenant_admin(tenant_id));

CREATE POLICY "tenant_configs_update_admin_or_super"
ON public.tenant_configs FOR UPDATE
TO authenticated
USING (public.is_super_admin() OR public.is_tenant_admin(tenant_id))
WITH CHECK (public.is_super_admin() OR public.is_tenant_admin(tenant_id));

CREATE POLICY "tenant_configs_delete_super_only"
ON public.tenant_configs FOR DELETE
TO authenticated
USING (public.is_super_admin());