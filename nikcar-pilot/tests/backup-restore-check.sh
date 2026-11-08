#!/usr/bin/env bash
# Requires PostgreSQL client tools (pg_dump, pg_restore, psql).
# SOURCE_DATABASE_URL: source DB; RESTORE_DATABASE_URL: EMPTY ISOLATED TEST DB.
# This never restores over the source. Never commit connection strings.
set -euo pipefail
: "${SOURCE_DATABASE_URL:?Set SOURCE_DATABASE_URL}"
: "${RESTORE_DATABASE_URL:?Set RESTORE_DATABASE_URL (isolated disposable database)}"
if [[ "$SOURCE_DATABASE_URL" == "$RESTORE_DATABASE_URL" ]]; then echo "Refusing source=destination" >&2; exit 1; fi
for tool in pg_dump pg_restore psql; do command -v "$tool" >/dev/null || { echo "Missing $tool" >&2; exit 1; }; done
if [[ "${CONFIRM_DISPOSABLE_RESTORE_DB:-}" != "YES" ]]; then
 echo "Set CONFIRM_DISPOSABLE_RESTORE_DB=YES after verifying destination is disposable" >&2; exit 1
fi
backup="$(mktemp "${TMPDIR:-/tmp}/nikcar-backup-XXXXXXXX.dump")"
trap 'rm -f "$backup"' EXIT
pg_dump --format=custom --no-owner --no-privileges --file="$backup" "$SOURCE_DATABASE_URL"
pg_restore --list "$backup" >/dev/null
echo "PASS: backup archive readable"
# Destination must be isolated and disposable; --clean drops objects in that destination only.
pg_restore --dbname="$RESTORE_DATABASE_URL" --clean --if-exists --no-owner --no-privileges --exit-on-error "$backup"
psql "$RESTORE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atc "select case when to_regclass('public.profiles') is not null and to_regclass('public.cars') is not null and to_regclass('public.rental_requests') is not null and to_regclass('public.driver_documents') is not null then 'PASS: restored core NikCar tables' else 'FAIL: missing core tables' end"
echo "Restore completed in isolated database. Verify record counts before using it."
