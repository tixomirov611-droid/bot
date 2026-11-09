-- NikCar v0.85 staging migration. DO NOT apply until schema and RLS reviewed.
create table if not exists public.driver_days_off (
 id uuid primary key default gen_random_uuid(),
 driver_id uuid not null,
 vehicle_id uuid not null,
 date_from date not null,
 date_to date not null,
 reason text,
 approved_by uuid not null,
 approved_role text not null check (approved_role in ('owner','admin')),
 status text not null default 'approved' check (status in ('approved','cancelled')),
 created_at timestamptz not null default now(),
 cancelled_at timestamptz,
 cancelled_by uuid,
 constraint driver_days_off_valid_dates check (date_to >= date_from)
);
create index if not exists driver_days_off_vehicle_dates_idx on public.driver_days_off(vehicle_id,date_from,date_to) where status='approved';
create table if not exists public.driver_days_off_audit (
 id uuid primary key default gen_random_uuid(),
 day_off_id uuid not null references public.driver_days_off(id),
 action text not null check (action in ('approved','cancelled')),
 actor_id uuid not null,
 actor_role text not null,
 occurred_at timestamptz not null default now()
);
alter table public.driver_days_off enable row level security;
alter table public.driver_days_off_audit enable row level security;
-- Intentionally no permissive policies: wire authenticated server RPC before production.
