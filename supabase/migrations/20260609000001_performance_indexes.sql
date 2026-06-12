-- Performance indexes for frequently queried columns
-- Identified via code audit: tenant lookups, notification reads, permission checks

-- tenant_memberships: user lookup (used in every authenticated request via get_my_tenants)
create index if not exists idx_tenant_memberships_user_id
  on tenant_memberships (user_id);

-- tenant_memberships: composite for membership check
create index if not exists idx_tenant_memberships_tenant_user
  on tenant_memberships (tenant_id, user_id);

-- owner_notifications: unread notifications per tenant
create index if not exists idx_owner_notifications_tenant_unread
  on owner_notifications (tenant_id, is_read)
  where is_read = false;

-- owner_notifications: general tenant listing ordered by created_at
create index if not exists idx_owner_notifications_tenant_created
  on owner_notifications (tenant_id, created_at desc);

-- admin_permissions: user capability lookup
create index if not exists idx_admin_permissions_user_capability
  on admin_permissions (user_id, capability);

-- ai_insights: agent insights per tenant ordered by created_at
create index if not exists idx_ai_insights_tenant_created
  on ai_insights (tenant_id, created_at desc);

-- ai_actions: pending actions per tenant
create index if not exists idx_ai_actions_tenant_status
  on ai_actions (tenant_id, status);

-- events: tenant events by type and created_at (used by most agents)
create index if not exists idx_events_tenant_type_created
  on events (tenant_id, type, created_at desc);

-- orders: tenant orders by status and created_at
create index if not exists idx_orders_tenant_created
  on orders (tenant_id, created_at desc);

create index if not exists idx_orders_tenant_status_created
  on orders (tenant_id, status, created_at desc);

-- outbound_messages: tenant messages by template and sent_at (email agents)
create index if not exists idx_outbound_messages_tenant_template
  on outbound_messages (tenant_id, template_key, sent_at desc);

-- cart_recovery_attempts: session dedup (used by cart-recovery agent)
create index if not exists idx_cart_recovery_session
  on cart_recovery_attempts (tenant_id, session_id);

-- agent_health: per-agent health lookup
create index if not exists idx_agent_health_tenant_agent
  on agent_health (tenant_id, agent_id, measured_on desc);

-- pricing_decisions: agent pricing history
create index if not exists idx_pricing_decisions_tenant_agent
  on pricing_decisions (tenant_id, agent, created_at desc);
