-- Data integrity and RLS fixes identified in audit

-- 1. UNIQUE constraint on customers(tenant_id, email)
--    Prevents duplicate customer profiles for the same email per tenant.
--    Uses a partial index so NULL emails (anonymous) don't conflict.
create unique index if not exists idx_customers_tenant_email_unique
  on customers (tenant_id, lower(email))
  where email is not null;

-- 2. conversations — add missing UPDATE / DELETE RLS policies
--    Previously only had INSERT and SELECT. Owners can update/delete their tenant's threads.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'conversations'
      and policyname = 'conversations_member_update'
  ) then
    execute $policy$
      create policy conversations_member_update on conversations
        for update using (is_tenant_member(tenant_id));
    $policy$;
  end if;

  if not exists (
    select 1 from pg_policies
    where tablename = 'conversations'
      and policyname = 'conversations_member_delete'
  ) then
    execute $policy$
      create policy conversations_member_delete on conversations
        for delete using (is_tenant_member(tenant_id));
    $policy$;
  end if;
end;
$$;

-- 3. order_fraud_signals — add simple risk scoring function
--    Computes a 0-1 risk score from the signals jsonb column.
--    Agents can call this instead of re-implementing per-agent.
create or replace function score_order_risk(_order_id uuid)
returns numeric
language sql
security definer
stable
as $$
  select coalesce(
    (select (signals->>'risk_score')::numeric from order_fraud_signals where order_id = _order_id limit 1),
    0
  );
$$;

-- 4. Add missing index on order_items for the orders FK
--    All agent queries that join orders → order_items benefit from this.
create index if not exists idx_order_items_order_id
  on order_items (order_id);

create index if not exists idx_order_items_tenant_product
  on order_items (tenant_id, product_id);

-- 5. customers — index for email lookup (dedup + suppression check)
create index if not exists idx_customers_tenant_email
  on customers (tenant_id, lower(email));

-- 6. email_suppressions — composite index for suppression check
--    The campaign-send endpoint queries this heavily.
create index if not exists idx_email_suppressions_tenant_email_reason
  on email_suppressions (lower(email), reason, tenant_id);

-- 7. outbound_messages — add missing index for cart-recovery dedup
create index if not exists idx_outbound_messages_template_meta
  on outbound_messages (tenant_id, template_key)
  where converted_at is null;
