-- NikCar rental lifecycle v1: owner-only atomic handover/return, no synthetic records.
alter type public.nikcar_request_state add value if not exists 'completed';
alter table public.rental_requests
 add column if not exists handed_over_at timestamptz,
 add column if not exists returned_at timestamptz,
 add column if not exists odometer_out_km integer,
 add column if not exists odometer_in_km integer,
 add column if not exists fuel_full_out boolean,
 add column if not exists fuel_full_in boolean,
 add column if not exists handover_note text not null default '',
 add column if not exists return_note text not null default '';
alter table public.rental_requests
 add constraint rental_odometer_out_valid check (odometer_out_km is null or odometer_out_km between 0 and 3000000),
 add constraint rental_odometer_in_valid check (odometer_in_km is null or (odometer_out_km is not null and odometer_in_km between odometer_out_km and 3000000)),
 add constraint rental_handover_consistent check ((handed_over_at is null and odometer_out_km is null and fuel_full_out is null) or (handed_over_at is not null and odometer_out_km is not null and fuel_full_out is true)),
 add constraint rental_return_consistent check ((returned_at is null and odometer_in_km is null and fuel_full_in is null) or (returned_at is not null and handed_over_at is not null and odometer_in_km is not null and fuel_full_in is true and returned_at >= handed_over_at));
create or replace function private.reserve_car_for_approved_request()
returns trigger language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if new.car_id is distinct from old.car_id or new.driver_id is distinct from old.driver_id or new.created_at is distinct from old.created_at then
  raise exception 'Rental request identity is immutable' using errcode='42501';
 end if;
 if old.status='pending' and new.status in ('approved','rejected','cancelled') then
  if new.status='approved' then
   if not private.is_owner() then raise exception 'Only owner can approve' using errcode='42501'; end if;
   update public.cars set status='reserved' where id=new.car_id and status='free';
   get diagnostics n=row_count;
   if n<>1 then raise exception 'Car is no longer available' using errcode='23514'; end if;
  elsif new.status='cancelled' then
   if not (old.driver_id=private.my_profile_id() and private.can_apply()) then raise exception 'Only requesting driver can cancel' using errcode='42501'; end if;
  elsif not private.is_owner() then
   raise exception 'Only owner can reject' using errcode='42501';
  end if;
  new.decided_at=clock_timestamp();
  return new;
 end if;
 if old.status='approved' and new.status='completed' then
  if not private.is_owner() then raise exception 'Only owner can close rental' using errcode='42501'; end if;
  if old.handed_over_at is null or new.returned_at is null or new.fuel_full_in is distinct from true then
   raise exception 'Return must be documented with full fuel tank' using errcode='23514';
  end if;
  return new;
 end if;
 if old.status='approved' and new.status='approved' then
  if not private.is_owner() then raise exception 'Only owner can record handover' using errcode='42501'; end if;
  if old.handed_over_at is not null or new.handed_over_at is null or new.fuel_full_out is distinct from true then
   raise exception 'Handover requires full tank and must occur once' using errcode='23514';
  end if;
  return new;
 end if;
 raise exception 'Invalid rental request transition' using errcode='42501';
end $$;
create or replace function private.nikcar_handover_internal(p_request uuid,p_odometer integer,p_full_tank boolean,p_note text default '')
returns void language plpgsql security definer set search_path='' as $$
declare r public.rental_requests%rowtype; n integer;
begin
 if auth.uid() is null or not private.is_owner() then raise exception 'Owner required' using errcode='42501'; end if;
 if p_odometer is null or p_odometer<0 or p_odometer>3000000 or p_full_tank is distinct from true then
  raise exception 'Valid odometer and full tank required' using errcode='23514';
 end if;
 select * into r from public.rental_requests where id=p_request for update;
 if not found or r.status<>'approved' or r.handed_over_at is not null then raise exception 'Rental not ready for handover' using errcode='23514'; end if;
 update public.cars set status='rented' where id=r.car_id and status='reserved';
 get diagnostics n=row_count;
 if n<>1 then raise exception 'Car must be reserved' using errcode='23514'; end if;
 update public.rental_requests set handed_over_at=clock_timestamp(),odometer_out_km=p_odometer,fuel_full_out=true,handover_note=left(coalesce(p_note,''),2000) where id=p_request;
end $$;
create or replace function private.nikcar_return_internal(p_request uuid,p_odometer integer,p_full_tank boolean,p_note text default '')
returns void language plpgsql security definer set search_path='' as $$
declare r public.rental_requests%rowtype; n integer;
begin
 if auth.uid() is null or not private.is_owner() then raise exception 'Owner required' using errcode='42501'; end if;
 select * into r from public.rental_requests where id=p_request for update;
 if not found or r.status<>'approved' or r.handed_over_at is null or r.returned_at is not null then
  raise exception 'No active rental to return' using errcode='23514';
 end if;
 if p_full_tank is distinct from true or p_odometer is null or p_odometer<r.odometer_out_km or p_odometer>3000000 then
  raise exception 'Return requires full tank and valid final odometer' using errcode='23514';
 end if;
 update public.rental_requests set status='completed',returned_at=clock_timestamp(),odometer_in_km=p_odometer,fuel_full_in=true,return_note=left(coalesce(p_note,''),2000) where id=p_request;
 update public.cars set status='free' where id=r.car_id and status='rented';
 get diagnostics n=row_count;
 if n<>1 then raise exception 'Car not in rented state' using errcode='23514'; end if;
end $$;
create or replace function public.nikcar_handover_rental(p_request uuid,p_odometer integer,p_full_tank boolean,p_note text default '')
returns void language sql set search_path='' as $$select private.nikcar_handover_internal(p_request,p_odometer,p_full_tank,p_note)$$;
create or replace function public.nikcar_return_rental(p_request uuid,p_odometer integer,p_full_tank boolean,p_note text default '')
returns void language sql set search_path='' as $$select private.nikcar_return_internal(p_request,p_odometer,p_full_tank,p_note)$$;
revoke all on function public.nikcar_handover_rental(uuid,integer,boolean,text) from public,anon;
revoke all on function public.nikcar_return_rental(uuid,integer,boolean,text) from public,anon;
grant execute on function public.nikcar_handover_rental(uuid,integer,boolean,text) to authenticated;
grant execute on function public.nikcar_return_rental(uuid,integer,boolean,text) to authenticated;
revoke all on function private.nikcar_handover_internal(uuid,integer,boolean,text) from public,anon,authenticated;
revoke all on function private.nikcar_return_internal(uuid,integer,boolean,text) from public,anon,authenticated;
