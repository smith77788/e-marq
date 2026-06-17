-- ============================================================================
-- Performance indexes for critical query patterns
-- ============================================================================

-- Orders: customer email lookup (account page, winback engine)
CREATE INDEX IF NOT EXISTS idx_orders_tenant_customer_email
  ON public.orders (tenant_id, customer_email);

-- Customers: marketing consent + last order (winback engine)
CREATE INDEX IF NOT EXISTS idx_customers_tenant_marketing_last_order
  ON public.customers (tenant_id, consent_marketing, last_order_at DESC);

-- Customers: predicted next order (reorder engine)
CREATE INDEX IF NOT EXISTS idx_customers_tenant_predicted_order
  ON public.customers (tenant_id, predicted_next_order_at);

-- Tenants: owner lookup (useTenantContext fallback)
CREATE INDEX IF NOT EXISTS idx_tenants_owner_user_id
  ON public.tenants (owner_user_id);

-- User roles: auth check (useAuth super_admin query)
CREATE INDEX IF NOT EXISTS idx_user_roles_user_role
  ON public.user_roles (user_id, role);

-- Order items: tenant + order (order detail, agent analytics)
CREATE INDEX IF NOT EXISTS idx_order_items_tenant_order
  ON public.order_items (tenant_id, order_id);
