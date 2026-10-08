#!/usr/bin/env bash
# Restore a production pg_dump (-Fc) into a SEPARATE local database for
# manual testing, bring it up to this branch's schema, and point server/.env
# at it. The existing local dev database is left untouched.
#
#   bash server/scripts/restore-prod-copy.sh prod-2026-09-30.dump [db_name]
#
# Refuses to run unless server/.env's DATABASE_URL is on localhost. Switch back
# by restoring the DATABASE_URL line saved in server/.env.before-prod-copy.
set -euo pipefail

DUMP="${1:?usage: restore-prod-copy.sh <file.dump> [db_name]}"
TARGET_DB="${2:-delphic_prod_copy}"
SERVER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$SERVER_DIR/.env"
PG_BIN="${PG_BIN:-/c/Program Files/PostgreSQL/18/bin}"

[ -f "$DUMP" ] || { echo "Dump not found: $DUMP" >&2; exit 1; }

CURRENT_URL="$(grep '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"')"
# postgres://user:pass@host:port/db?params
re='^postgres(ql)?://([^:]+):([^@]*)@([^:/]+):([0-9]+)/([^?]+)(\?.*)?$'
[[ "$CURRENT_URL" =~ $re ]] || { echo "Could not parse DATABASE_URL in $ENV_FILE" >&2; exit 1; }
PGUSER="${BASH_REMATCH[2]}"; PGPASSWORD="${BASH_REMATCH[3]}"; PGHOST="${BASH_REMATCH[4]}"
PGPORT="${BASH_REMATCH[5]}"; CURRENT_DB="${BASH_REMATCH[6]}"; PARAMS="${BASH_REMATCH[7]:-}"
export PGUSER PGPASSWORD PGHOST PGPORT

case "$PGHOST" in localhost|127.0.0.1) ;; *) echo "Refusing: DATABASE_URL host is $PGHOST, not local" >&2; exit 1 ;; esac
[ "$TARGET_DB" != "$CURRENT_DB" ] || { echo "Refusing: $TARGET_DB is the current dev database" >&2; exit 1; }

echo "== Checking the dump"
"$PG_BIN/pg_restore.exe" --list "$DUMP" > /dev/null

echo "== (Re)creating local database $TARGET_DB on $PGHOST:$PGPORT"
"$PG_BIN/dropdb.exe" --if-exists "$TARGET_DB"
"$PG_BIN/createdb.exe" "$TARGET_DB"

echo "== Restoring (a few 'already exists' / role warnings are normal)"
"$PG_BIN/pg_restore.exe" --no-owner --no-privileges --jobs=4 -d "$TARGET_DB" "$DUMP" || echo "pg_restore reported warnings (see above)"

NEW_URL="postgres://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/$TARGET_DB$PARAMS"

echo "== Applying this branch's migrations"
(cd "$SERVER_DIR" && DATABASE_URL="$NEW_URL" npx prisma migrate deploy)

echo "== Row counts"
"$PG_BIN/psql.exe" -d "$TARGET_DB" -tAc "select 'profiles', count(*) from profiles union all select 'submissions', count(*) from submissions union all select 'org_memberships', count(*) from org_memberships union all select 'accounts', count(*) from accounts"

echo "== Pointing server/.env at $TARGET_DB"
[ -f "$ENV_FILE.before-prod-copy" ] || grep '^DATABASE_URL=' "$ENV_FILE" > "$ENV_FILE.before-prod-copy"
sed -i "s#^DATABASE_URL=.*#DATABASE_URL=$NEW_URL#" "$ENV_FILE"
echo "Done. Restart the server. Previous DATABASE_URL saved in server/.env.before-prod-copy"
