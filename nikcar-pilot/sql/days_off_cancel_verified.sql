CREATE OR REPLACE FUNCTION private.nikcar_cancel_days_off_internal(p_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor record; item record;
begin
 if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'Authentication required' using errcode='42501'; end if;
 select p.id,p.role,p.access,sa.staff_role into actor from public.profiles p left join public.nikcar_staff_assignments sa on sa.profile_id=p.id where p.user_id=auth.uid();
 if actor.id is null or actor.access::text is distinct from 'active' or not coalesce(actor.role::text='owner' or actor.staff_role='administrator',false) then raise exception 'Not authorized' using errcode='42501'; end if;
 select * into item from public.driver_days_off where id=p_id for update;
 if not found then raise exception 'Days off not found' using errcode='22023'; end if;
 if item.status='cancelled' then return p_id; end if;
 update public.driver_days_off set status='cancelled',cancelled_at=now(),cancelled_by=actor.id where id=p_id;
 insert into public.driver_days_off_audit(day_off_id,action,actor_id,actor_role) values(p_id,'cancelled',actor.id,case when actor.role::text='owner' then 'owner' else 'administrator' end);
 insert into public.days_off_notifications(day_off_id,recipient_profile_id,kind)
 select p_id,p.id,'cancelled' from public.profiles p where p.id=item.driver_id or (p.access::text='active' and (p.role::text='owner' or exists(select 1 from public.nikcar_staff_assignments s where s.profile_id=p.id and s.staff_role='accountant')));
 return p_id;
end $function$
;
CREATE OR REPLACE FUNCTION public.nikcar_cancel_days_off_v085(p_id uuid)
 RETURNS uuid
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select private.nikcar_cancel_days_off_internal(p_id) $function$
;
CREATE OR REPLACE FUNCTION public.nikcar_approve_days_off_v085(p_car_id uuid, p_from date, p_to date, p_reason text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor record; rental record; result_id uuid; actor_role text;
begin
 if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'Authentication required' using errcode='42501'; end if;
 select p.id,p.role,p.access,sa.staff_role into actor from public.profiles p left join public.nikcar_staff_assignments sa on sa.profile_id=p.id where p.user_id=auth.uid() limit 1;
 if actor.id is null or actor.access::text<>'active' or not coalesce(actor.role::text='owner' or actor.staff_role='administrator',false) then raise exception 'Not authorized' using errcode='42501'; end if;
 if p_car_id is null or p_from is null or p_to is null or p_to<p_from or p_to>p_from+365 then raise exception 'Invalid dates' using errcode='22023'; end if;
 select r.driver_id,r.id into rental from public.rental_requests r where r.car_id=p_car_id and r.handed_over_at is not null and r.handed_over_at::date<=p_from and (r.returned_at is null or r.returned_at::date>=p_to) order by r.handed_over_at desc limit 1;
 if rental.id is null then raise exception 'No rental covering selected period' using errcode='22023'; end if;
 actor_role:=case when actor.role::text='owner' then 'owner' else 'administrator' end;
 insert into public.driver_days_off(driver_id,vehicle_id,date_from,date_to,reason,approved_by,approved_role) values(rental.driver_id,p_car_id,p_from,p_to,left(coalesce(p_reason,''),500),actor.id,actor_role) returning id into result_id;
 insert into public.driver_days_off_audit(day_off_id,action,actor_id,actor_role) values(result_id,'approved',actor.id,actor_role);
 insert into public.days_off_notifications(day_off_id,recipient_profile_id,kind) select result_id,p.id,'approved' from public.profiles p where p.id=rental.driver_id or (p.role::text='owner' and p.access::text='active') or (p.access::text='active' and exists(select 1 from public.nikcar_staff_assignments sa where sa.profile_id=p.id and sa.staff_role='accountant'));
 return result_id;
end $function$
;
REVOKE ALL ON FUNCTION private.nikcar_cancel_days_off_internal(uuid), public.nikcar_cancel_days_off_v085(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.nikcar_cancel_days_off_internal(uuid), public.nikcar_cancel_days_off_v085(uuid) TO authenticated;

