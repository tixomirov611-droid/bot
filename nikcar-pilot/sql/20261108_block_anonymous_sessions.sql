-- Applied to Supabase on 2026-11-08.
-- Defense in depth: Supabase anonymous sign-ins use the authenticated DB role.
-- The restrictive policy is ANDed with existing per-user/owner RLS policies.
-- Do not weaken or replace the existing business-specific policies.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'announcements','cars','chat_messages','driver_documents',
    'expense_entries','payment_claims','profiles','rental_requests',
    'repair_jobs','repair_parts','sos_requests'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',
                   'nikcar_no_anonymous_sessions',t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
       USING ((select auth.uid()) IS NOT NULL AND
              (select auth.jwt()->>''is_anonymous'') IS DISTINCT FROM ''true'')
       WITH CHECK ((select auth.uid()) IS NOT NULL AND
                   (select auth.jwt()->>''is_anonymous'') IS DISTINCT FROM ''true'')',
      'nikcar_no_anonymous_sessions',t
    );
  END LOOP;
END $$;
DROP POLICY IF EXISTS nikcar_no_anonymous_sessions ON storage.objects;
CREATE POLICY nikcar_no_anonymous_sessions
ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
USING (
  bucket_id <> 'nikcar-driver-docs'
  OR ((select auth.uid()) IS NOT NULL
      AND (select auth.jwt()->>'is_anonymous') IS DISTINCT FROM 'true')
)
WITH CHECK (
  bucket_id <> 'nikcar-driver-docs'
  OR ((select auth.uid()) IS NOT NULL
      AND (select auth.jwt()->>'is_anonymous') IS DISTINCT FROM 'true')
);
