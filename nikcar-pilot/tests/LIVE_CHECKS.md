# NikCar live verification
The offline regression suite covers mock uploads, UI roles and rental logic. The database RPC end-to-end test was also executed on 2026-11-08 inside a rollback-only transaction: owner approval, handover (125430 km, full tank), return (125450 km, full tank), car free, rental completed; driver RPC access denied. The public RPC wrappers needed SECURITY DEFINER to invoke private functions; the fix is in the SQL file.

## Live photo upload
Create a dedicated *test driver* through the normal Supabase Auth signup/login flow. Set NIKCAR_SUPABASE_URL, NIKCAR_PUBLISHABLE_KEY, NIKCAR_TEST_EMAIL, NIKCAR_TEST_PASSWORD in your shell (never commit secrets), then run `node nikcar-pilot/tests/live-storage-smoke.mjs`. The script signs in as that driver, uploads a clearly named fictional 1x1 PNG into their own private storage path, requests a signed URL, and removes the temporary file. It never writes to driver_documents or real driver files. A passing local mock test is **not** proof of live storage.

## Backup and isolated restore
Supply source and a **different disposable staging database** as SOURCE_DATABASE_URL and RESTORE_DATABASE_URL, set CONFIRM_DISPOSABLE_RESTORE_DB=YES, then run `bash nikcar-pilot/tests/backup-restore-check.sh`. The script creates a custom pg_dump, checks the archive, restores to staging, and checks core tables. The live source is never overwritten. This is not yet a completed restore test until the script runs against a separate staging database. Supabase Storage files and Auth configuration require a separate backup strategy.
