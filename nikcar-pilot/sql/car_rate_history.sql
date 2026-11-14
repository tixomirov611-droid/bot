create table public.nikcar_car_rate_history(
 car_id uuid not null references public.cars(id) on delete cascade,
 effective_from date not null,weekly_rate numeric not null check(weekly_rate>=0),
 changed_at timestamptz not null default now(),changed_by uuid,
 primary key(car_id,effective_from));
alter table public.nikcar_car_rate_history enable row level security;
revoke all on public.nikcar_car_rate_history from anon,authenticated;
create or replace function private.nikcar_capture_car_rate() returns trigger language plpgsql security definer set search_path='' as $$
declare old_rate numeric; new_rate numeric; effective date;
begin
 old_rate:=coalesce(old.weekly_rate,old.daily_rate*7);
 new_rate:=coalesce(new.weekly_rate,new.daily_rate*7);
 if new_rate is not distinct from old_rate then return new; end if;
 if new_rate is null or new_rate<0 then raise exception 'Invalid rental price';end if;
 effective:=(now() at time zone 'Europe/Kyiv')::date+1;
 insert into public.nikcar_car_rate_history(car_id,effective_from,weekly_rate,changed_by)
 values(old.id,'-infinity'::date,old_rate,auth.uid()) on conflict do nothing;
 insert into public.nikcar_car_rate_history(car_id,effective_from,weekly_rate,changed_by)
 values(old.id,effective,new_rate,auth.uid())
 on conflict(car_id,effective_from) do update set weekly_rate=excluded.weekly_rate,changed_at=now(),changed_by=excluded.changed_by;
 return new;
end $$;
revoke all on function private.nikcar_capture_car_rate() from public,anon,authenticated;
create trigger nikcar_capture_car_rate before update of weekly_rate,daily_rate on public.cars for each row execute function private.nikcar_capture_car_rate();
CREATE OR REPLACE FUNCTION public.nikcar_refresh_weekly_rent_v087()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor record; rec record; w date; today_kyiv date; start_day date; end_day date; n integer; off_count integer; charge numeric; rent_gross numeric; rent_discount numeric; due_time timestamptz; affected integer:=0;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select p.id,p.role,p.access into actor from public.profiles p where p.user_id=auth.uid() limit 1;
 if actor.id is null or actor.role::text<>'owner' or actor.access::text<>'active' then raise exception 'Not authorized' using errcode='42501'; end if;
 today_kyiv:=(now() at time zone 'Europe/Kyiv')::date;
 for rec in select rr.id,rr.driver_id,rr.car_id,coalesce(c.weekly_rate,c.daily_rate*7)/7 as daily_rate,rr.handed_over_at,rr.returned_at
 from public.rental_requests rr join public.cars c on c.id=rr.car_id
 where rr.handed_over_at is not null and rr.handed_over_at <= now()
 loop
 start_day:=(rec.handed_over_at at time zone 'Europe/Kyiv')::date;
 end_day:=least(today_kyiv,coalesce((rec.returned_at at time zone 'Europe/Kyiv')::date,today_kyiv));
 if end_day<start_day then continue; end if;
 for w in select generate_series(date_trunc('week',start_day::timestamp)::date,date_trunc('week',end_day::timestamp)::date,interval '7 days')::date loop
  select count(*) into n from generate_series(greatest(w,start_day),least(w+6,end_day),interval '1 day') g;
  select count(*) into off_count from generate_series(greatest(w,start_day),least(w+6,end_day),interval '1 day') g
   where exists(select 1 from public.driver_days_off o where o.vehicle_id=rec.car_id and o.driver_id=rec.driver_id and o.status='approved' and g::date between o.date_from and o.date_to);
  select coalesce(sum(rate),0),coalesce(sum(case when free then rate else 0 end),0) into rent_gross,rent_discount
 from (select coalesce((select h.weekly_rate/7 from public.nikcar_car_rate_history h where h.car_id=rec.car_id and h.effective_from<=g::date order by h.effective_from desc limit 1),rec.daily_rate) as rate,
 exists(select 1 from public.driver_days_off o where o.vehicle_id=rec.car_id and o.driver_id=rec.driver_id and o.status='approved' and g::date between o.date_from and o.date_to) as free
 from generate_series(greatest(w,start_day),least(w+6,end_day),interval '1 day') g) rates;
 charge:=greatest(0,rent_gross-rent_discount);
  due_time:=(w::timestamp+interval '12 hours') at time zone 'Europe/Kyiv';
  insert into public.nikcar_weekly_rent(rental_id,driver_id,car_id,week_start,due_at,gross,discount,amount_due,status)
  values(rec.id,rec.driver_id,rec.car_id,w,due_time,rent_gross,rent_discount,charge,
   case when charge<=0 then 'paid' when now()>due_time then 'overdue' else 'pending' end)
  on conflict(rental_id,week_start) do update set
   gross=excluded.gross,discount=excluded.discount,amount_due=excluded.amount_due,
   status=case when public.nikcar_weekly_rent.paid_amount>=excluded.amount_due then 'paid'
    when now()>excluded.due_at then 'overdue' else 'pending' end;
  affected:=affected+1;
 end loop;
 end loop;
 return affected;
end $function$
;
