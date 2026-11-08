-- Applied to Supabase 2026-11-08 after a real rollback-only end-to-end test.
-- Public wrappers execute as their owner so they can invoke the private
-- SECURITY DEFINER implementations; those implementations check auth.uid()
-- and private.is_owner(), and private schema EXECUTE stays revoked.
alter function public.nikcar_handover_rental(uuid,integer,boolean,text) security definer;
alter function public.nikcar_return_rental(uuid,integer,boolean,text) security definer;
revoke all on function public.nikcar_handover_rental(uuid,integer,boolean,text) from public,anon;
revoke all on function public.nikcar_return_rental(uuid,integer,boolean,text) from public,anon;
grant execute on function public.nikcar_handover_rental(uuid,integer,boolean,text) to authenticated;
grant execute on function public.nikcar_return_rental(uuid,integer,boolean,text) to authenticated;
