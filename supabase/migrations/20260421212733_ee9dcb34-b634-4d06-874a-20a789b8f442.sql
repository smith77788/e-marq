create table if not exists public.bootstrap_facts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  fact_kind text not null,
  fact_key text not null default 'default',
  value jsonb not null default '{}'::jsonb,
  source text not null default 'agent',
  confidence numeric not null default 0.5,
  evidence jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, fact_kind, fact_key)
);

create index if not exists idx_bootstrap_facts_tenant on public.bootstrap_facts(tenant_id);
create index if not exists idx_bootstrap_facts_kind on public.bootstrap_facts(tenant_id, fact_kind);

alter table public.bootstrap_facts enable row level security;

create policy "bootstrap_facts_member_read"
  on public.bootstrap_facts for select
  to authenticated
  using (is_super_admin() or is_tenant_member(tenant_id));

create policy "bootstrap_facts_admin_write"
  on public.bootstrap_facts for insert
  to authenticated
  with check (is_super_admin() or is_tenant_admin(tenant_id));

create policy "bootstrap_facts_admin_update"
  on public.bootstrap_facts for update
  to authenticated
  using (is_super_admin() or is_tenant_admin(tenant_id))
  with check (is_super_admin() or is_tenant_admin(tenant_id));

create policy "bootstrap_facts_admin_delete"
  on public.bootstrap_facts for delete
  to authenticated
  using (is_super_admin() or is_tenant_admin(tenant_id));

create trigger trg_bootstrap_facts_updated_at
  before update on public.bootstrap_facts
  for each row execute function public.update_updated_at_column();

comment on table public.bootstrap_facts is
  'Discovered business context written by bootstrap agents after onboarding. Used by working agents as ground truth.';