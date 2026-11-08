-- NikCar Fleet Control: remove only a user's own orphaned driver-document uploads.
-- A failed two-step upload (Storage object then public.driver_documents row) may
-- leave an unlinked object. The browser can clean up only that newly uploaded
-- object; an already linked document is never eligible for deletion.
-- Always delete via the Supabase Storage API, not with SQL DELETE.
create policy nikcar_driver_docs_cleanup_unlinked
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'nikcar-driver-docs'
  and owner_id = (select auth.uid()::text)
  and split_part(name, '/', 1) = (select auth.uid()::text)
  and not exists (
    select 1
    from public.driver_documents d
    where d.object_path = objects.name
  )
);
