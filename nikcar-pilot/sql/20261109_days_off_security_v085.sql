-- v0.85: enforce days-off approvals in database (apply after schema review).
create extension if not exists btree_gist;
alter table public.driver_days_off
 add constraint driver_days_off_no_overlap exclude using gist
 (vehicle_id with =, daterange(date_from,date_to,'[]') with &&)
 where (status='approved');
create table if not exists public.days_off_notifications (
 id uuid primary key default gen_random_uuid(),
 day_off_id uuid not null references public.driver_days_off(id),
 recipient_profile_id uuid not null references public.profiles(id),
 kind text not null check(kind in ('approved','cancelled')),
 created_at timestamptz not null default now(),
 read_at timestamptz
);
alter table public.days_off_notifications enable row level security;
create policy days_off_notifications_read on public.days_off_notifications
 for select to authenticated using (
 exists(select 1 from public.profiles p
 where p.id=recipient_profile_id and p.user_id=(select auth.uid()) and p.access='active')
 );
-- No browser write policies for notifications or approval history.
-- Only trusted transactional backend may create/cancel days off after checking
-- active owner/admin authorization against profiles + nikcar_staff_assignments,
-- active rental_request driver/car/date interval, and audit all changes.
-- Accountant is read-only and notified; driver only sees own approved intervals.
