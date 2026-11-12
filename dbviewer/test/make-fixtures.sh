#!/usr/bin/env bash
# Rebuilds the two tiny fixture dumps the viewer tests read (dbviewer/test/fixtures/*.dump).
# Needs a local Postgres 16 and its client tools. Only used when the fixtures must change; the dumps are committed.
#   PGBIN=/c/Program\ Files/PostgreSQL/16/bin PGPASSWORD=postgres bash dbviewer/test/make-fixtures.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="${PGBIN:-}"; [ -n "$BIN" ] && BIN="$BIN/"
HOST="${PGHOST:-localhost}"; PORT="${PGPORT:-5432}"; USER_="${PGUSER:-postgres}"
psqlc() { "${BIN}psql" -h "$HOST" -p "$PORT" -U "$USER_" -q -v ON_ERROR_STOP=1 "$@"; }
OUT="$HERE/fixtures"; mkdir -p "$OUT"
DB=dbv_fixture_tmp

build() { # dump-file  sql-file
  psqlc -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
  psqlc -d $DB -f "$2"
  "${BIN}pg_dump" -h "$HOST" -p "$PORT" -U "$USER_" -Fc -f "$1" $DB
  psqlc -d postgres -c "DROP DATABASE $DB"
}

# ---- A: the older snapshot ----------------------------------------------------------------------------------------------
cat > "$OUT/a.sql" <<'SQL'
CREATE TABLE _prisma_migrations (id text PRIMARY KEY, migration_name text NOT NULL);
INSERT INTO _prisma_migrations VALUES ('m1', '20260101000000_init'), ('m2', '20260201000000_people');

CREATE TABLE people (
  id text PRIMARY KEY,
  name text NOT NULL,
  note text,
  password_hash text,
  aadhaar_number text,
  amount numeric(10,2)
);
INSERT INTO people VALUES
  ('p1', 'Asha',   E'tab\there and newline\nand back\\slash and "quotes"', 'hash-A-1', '1111 2222 3333', 10.50),
  ('p2', 'Bilal',  NULL,                                                  'hash-B-1', '4444 5555 6666', 20.00),
  ('p3', 'Chitra', 'plain',                                               'hash-C-1', NULL,            30.00),
  ('p4', 'Dev',    'gone later',                                          'hash-D-1', NULL,            40.00),
  ('p5', 'Esha',   '',                                                    NULL,       NULL,            NULL);

-- no primary key: compared as whole rows
CREATE TABLE events (kind text, n integer);
INSERT INTO events VALUES ('login', 1), ('login', 1), ('logout', 2), ('old-only', 9);

CREATE TABLE dropped_later (id integer PRIMARY KEY, label text);
INSERT INTO dropped_later VALUES (1, 'will be gone');

CREATE TABLE same_in_both (id integer PRIMARY KEY, v text);
INSERT INTO same_in_both VALUES (1, 'x'), (2, 'y');
SQL

# ---- B: the newer snapshot ----------------------------------------------------------------------------------------------
cat > "$OUT/b.sql" <<'SQL'
CREATE TABLE _prisma_migrations (id text PRIMARY KEY, migration_name text NOT NULL);
INSERT INTO _prisma_migrations VALUES ('m1', '20260101000000_init'), ('m2', '20260201000000_people'), ('m3', '20260301000000_nicknames');

-- password-like and nickname columns: "nickname" is new; "note" is gone is NOT done (kept), "amount" kept
CREATE TABLE people (
  id text PRIMARY KEY,
  name text NOT NULL,
  note text,
  password_hash text,
  aadhaar_number text,
  amount numeric(10,2),
  nickname text
);
INSERT INTO people VALUES
  ('p1', 'Asha',   E'tab\there and newline\nand back\\slash and "quotes"', 'hash-A-1',    '1111 2222 3333', 10.50, 'ash'),     -- only nickname is new (NULL -> 'ash')
  ('p2', 'Bilal K','changed note',                                        'hash-B-2',    '4444 5555 6666', 20.00, NULL),      -- name, note, secret hash changed
  ('p3', 'Chitra', 'plain',                                               'hash-C-1',    '7777 8888 9999', 31.00, NULL),      -- aadhaar and amount changed
  ('p5', 'Esha',   '',                                                    NULL,          NULL,             NULL,  NULL),      -- unchanged
  ('p6', 'Farah',  'new person',                                          'hash-F-1',    NULL,             60.00, NULL);      -- added (p4 removed)

CREATE TABLE events (kind text, n integer);
INSERT INTO events VALUES ('login', 1), ('logout', 2), ('logout', 2), ('new-only', 7);

CREATE TABLE same_in_both (id integer PRIMARY KEY, v text);
INSERT INTO same_in_both VALUES (1, 'x'), (2, 'y');

CREATE TABLE brand_new (id integer PRIMARY KEY, label text);
INSERT INTO brand_new VALUES (1, 'hello');
SQL

build "$OUT/predeploy-2026-11-04-130200.dump" "$OUT/a.sql"
build "$OUT/auto-2026-11-05-081000.dump" "$OUT/b.sql"
rm -f "$OUT/a.sql" "$OUT/b.sql"
ls -l "$OUT"
