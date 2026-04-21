create table if not exists public.dntrade_health_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  integration_id uuid references public.tenant_integrations(id) on delete set null,
  status text not null check (status in ('healthy','degraded','unhealthy','missing','error')),
  http_status int not null,
  ready boolean not null default false,
  blockers jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  last_sync_status text,
  last_sync_age_seconds int,
  checked_at timestamptz not null default now()
);

create index if not exists dntrade_health_log_tenant_time_idx
  on public.dntrade_health_log (tenant_id, checked_at desc);
create index if not exists dntrade_health_log_status_time_idx
  on public.dntrade_health_log (status, checked_at desc);

alter table public.dntrade_health_log enable row level security;

drop policy if exists "tenant members read own health log" on public.dntrade_health_log;
create policy "tenant members read own health log"
  on public.dntrade_health_log
  for select
  to authenticated
  using (public.is_super_admin() or public.is_tenant_member(tenant_id));

create or replace function public.dntrade_unhealthy_streak_minutes(_tenant_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  with recent as (
    select status, checked_at
    from public.dntrade_health_log
    where tenant_id = _tenant_id
    order by checked_at desc
    limit 50
  ),
  first_ok as (
    select max(checked_at) as ok_at
    from recent
    where status not in ('unhealthy','error','missing')
  ),
  oldest_unhealthy as (
    select min(checked_at) as start_at
    from recent
    where status in ('unhealthy','error','missing')
      and checked_at > coalesce((select ok_at from first_ok), '-infinity'::timestamptz)
  )
  select coalesce(extract(epoch from (now() - start_at))::int / 60, 0)
  from oldest_unhealthy;
$$;

create or replace function public.dntrade_partial_count_recent(_tenant_id uuid, _hours int default 6)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.dntrade_health_log
  where tenant_id = _tenant_id
    and last_sync_status = 'partial'
    and checked_at > now() - make_interval(hours => _hours);
$$;