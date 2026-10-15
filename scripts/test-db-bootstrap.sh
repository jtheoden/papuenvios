#!/usr/bin/env bash
# Builds the LOCAL scratch Postgres used by the real-database tests (src/tests/concurrency/).
#
#   1. creates the dedicated scratch database (default: papuenvios_test) on a LOCAL server,
#   2. clones the schema (public + auth + extensions + storage) from a schema source:
#        - default: pg_dump of the `postgres` database of the local e2e container, or
#        - --schema-dump FILE: a committed plain-SQL schema dump,
#   3. replays the repo migrations (supabase/migrations/*.sql, filename order) from the replay
#      window on, stopping on the first error and naming the file,
#   4. loads the minimal fixture seed (scripts/test-db-seed.sql).
#
# Safety: only 127.0.0.1 / localhost / ::1 are accepted, the port must be the expected container
# port (55322) unless --allow-nondefault-port is given, the target database name must start with
# `papuenvios_test`, and the remote Supabase host is never contacted. The source database is only
# READ (pg_dump). The scratch database is dropped only with --recreate (or --probe, which uses and
# removes its own throwaway database).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/supabase/migrations"
SEED_FILE="$SCRIPT_DIR/test-db-seed.sql"

# Ambient libpq settings must not redirect us to another server; notices are noise here.
unset PGHOST PGHOSTADDR PGPORT PGUSER PGDATABASE PGSERVICE PGSERVICEFILE PGSSLMODE PGPASSFILE
export PGOPTIONS="-c client_min_messages=error"

DEFAULT_PORT=55322
DB_HOST="${TEST_DB_HOST:-127.0.0.1}"
DB_PORT="${TEST_DB_PORT:-$DEFAULT_PORT}"
DB_USER="${TEST_DB_USER:-postgres}"
# Local scratch default: the password equals the user name (the e2e container's convention); no
# password literal is committed.
export PGPASSWORD="${TEST_DB_PASSWORD:-$DB_USER}"
DB_NAME="${TEST_DB_NAME:-papuenvios_test}"
SOURCE_DB="${TEST_DB_SOURCE:-postgres}"
SOURCE_CONTAINER="${TEST_DB_SOURCE_CONTAINER:-supabase_db_e2e-supabase}"

# First migration the local e2e clone does NOT contain (see README of src/tests/concurrency).
REPLAY_FROM="${TEST_DB_REPLAY_FROM:-20261014180000}"

RECREATE=0
PROBE=0
SEED=1
ALLOW_PORT=0
SCHEMA_DUMP=""

usage() {
  cat <<'EOF'
Usage: scripts/test-db-bootstrap.sh [options]

  --recreate               drop and rebuild the scratch database (papuenvios_test)
  --schema-dump FILE       clone the schema from a committed plain-SQL dump instead of pg_dump
  --source-db NAME         database to pg_dump from (letters, digits, underscore only; default postgres)
  --replay-from PREFIX     14-digit migration timestamp the replay starts at (default 20261014180000)
  --probe                  replay EVERY migration into a throwaway papuenvios_test_probe database,
                           list all failures, then drop it
  --no-seed                skip scripts/test-db-seed.sql
  --allow-nondefault-port  required when TEST_DB_PORT is not 55322
  -h, --help               this help

Environment: TEST_DB_HOST (local only), TEST_DB_PORT, TEST_DB_USER, TEST_DB_PASSWORD, TEST_DB_NAME,
TEST_DB_SOURCE, TEST_DB_SOURCE_CONTAINER, TEST_DB_REPLAY_FROM.
EOF
}
die() { echo "test-db-bootstrap: $*" >&2; exit 1; }
log() { echo "[bootstrap] $*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --recreate) RECREATE=1 ;;
    --probe) PROBE=1 ;;
    --no-seed) SEED=0 ;;
    --allow-nondefault-port) ALLOW_PORT=1 ;;
    --schema-dump) [ $# -ge 2 ] || die "--schema-dump needs a file"; shift; SCHEMA_DUMP="$1" ;;
    --source-db) [ $# -ge 2 ] || die "--source-db needs a name"; shift; SOURCE_DB="$1" ;;
    --replay-from) [ $# -ge 2 ] || die "--replay-from needs a migration prefix"; shift; REPLAY_FROM="$1" ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
  shift
done

# --probe never touches the regular scratch database: own name, implicit recreate, dropped at the end.
if [ "$PROBE" = "1" ]; then
  DB_NAME="papuenvios_test_probe"
  RECREATE=1
fi

# ---- safety gates (all before any connection) -------------------------------------------------
case "$DB_HOST" in
  127.0.0.1|localhost|::1) ;;
  *) die "refusing non-local host '$DB_HOST' (only 127.0.0.1, localhost, ::1 are allowed)" ;;
esac
[[ "$DB_PORT" =~ ^[0-9]+$ ]] || die "TEST_DB_PORT must be numeric (got '$DB_PORT')"
if [ "$DB_PORT" != "$DEFAULT_PORT" ] && [ "$ALLOW_PORT" != "1" ]; then
  die "port $DB_PORT is not the expected local container port $DEFAULT_PORT; pass --allow-nondefault-port to confirm"
fi
[[ "$DB_USER" =~ ^[A-Za-z0-9_]+$ ]] || die "TEST_DB_USER must match ^[A-Za-z0-9_]+\$"
[[ "$DB_NAME" =~ ^papuenvios_test[a-z0-9_]*$ ]] || die "scratch database name must match ^papuenvios_test[a-z0-9_]*\$ (got '$DB_NAME')"
# The source name reaches pg_dump: libpq treats a value containing '=' or a URI as a full connection string
# that overrides -h/-p, so only a bare identifier is accepted.
[[ "$SOURCE_DB" =~ ^[A-Za-z0-9_]+$ ]] || die "--source-db / TEST_DB_SOURCE must match ^[A-Za-z0-9_]+\$ (got '$SOURCE_DB')"
[ "$DB_NAME" != "$SOURCE_DB" ] || die "scratch database and schema source database must differ"
[[ "$REPLAY_FROM" =~ ^[0-9]{14}$ ]] || die "--replay-from must be a 14-digit migration timestamp (got '$REPLAY_FROM')"
[ -d "$MIGRATIONS_DIR" ] || die "migrations directory not found: $MIGRATIONS_DIR"
if [ -n "$SCHEMA_DUMP" ]; then [ -f "$SCHEMA_DUMP" ] || die "schema dump not found: $SCHEMA_DUMP"; fi

# The port must really be the expected local Supabase Postgres container (when docker is available).
if [ "$DB_PORT" = "$DEFAULT_PORT" ] && command -v docker >/dev/null 2>&1; then
  mapped="$(docker port "$SOURCE_CONTAINER" 5432/tcp 2>/dev/null || true)"
  case "$mapped" in
    *":$DB_PORT"*) ;;
    *) die "container '$SOURCE_CONTAINER' is not publishing 5432 on host port $DB_PORT (docker port says: '${mapped:-nothing}'); is the local e2e Postgres container running?" ;;
  esac
fi

PSQL_BASE=(psql -X -q -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER")
psql_db() { local db="$1"; shift; "${PSQL_BASE[@]}" -d "$db" -v ON_ERROR_STOP=1 "$@"; }
psql_val() { local db="$1"; shift; "${PSQL_BASE[@]}" -d "$db" -At -v ON_ERROR_STOP=1 "$@"; }

psql_val postgres -c 'SELECT 1' >/dev/null 2>&1 \
  || die "cannot connect to $DB_HOST:$DB_PORT as $DB_USER (is the local e2e Postgres container running?)"

tmp_dump=""; filtered=""
cleanup() {
  rm -f "$tmp_dump" "$filtered"
  if [ "$PROBE" = "1" ]; then
    psql_db postgres -c "DROP DATABASE IF EXISTS \"$DB_NAME\" WITH (FORCE)" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

sha() { sha256sum "$1" | cut -d' ' -f1; }

# ---- 1. scratch database ----------------------------------------------------------------------
exists="$(psql_val postgres -c "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'")"
if [ "$exists" = "1" ] && [ "$RECREATE" = "1" ]; then
  log "dropping scratch database $DB_NAME (--recreate/--probe)"
  psql_db postgres -c "DROP DATABASE \"$DB_NAME\" WITH (FORCE)"
  exists=""
fi

if [ "$exists" != "1" ]; then
  log "creating scratch database $DB_NAME"
  psql_db postgres -c "CREATE DATABASE \"$DB_NAME\""

  drop_partial() {
    echo "test-db-bootstrap: schema clone failed; dropping the partial database $DB_NAME" >&2
    psql_db postgres -c "DROP DATABASE IF EXISTS \"$DB_NAME\" WITH (FORCE)" >/dev/null 2>&1 || true
  }

  # ---- 2. schema clone (only into a fresh database) ------------------------------------------
  # Supabase roles referenced by grants / SET ROLE in the tests. Cluster-level, created only if missing.
  psql_db "$DB_NAME" -c "
    DO \$\$
    DECLARE r text;
    BEGIN
      FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
          EXECUTE format('CREATE ROLE %I NOLOGIN', r);
        END IF;
      END LOOP;
    END \$\$;
    CREATE SCHEMA IF NOT EXISTS extensions;
    CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\" WITH SCHEMA extensions;
    CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;" || { drop_partial; die "could not prepare roles/extensions"; }

  tmp_dump="$(mktemp)"
  filtered="$(mktemp)"
  if [ -n "$SCHEMA_DUMP" ]; then
    log "schema source: committed dump $SCHEMA_DUMP"
    cp "$SCHEMA_DUMP" "$tmp_dump"
  else
    log "schema source: pg_dump of database '$SOURCE_DB' at $DB_HOST:$DB_PORT (read-only)"
    dump_err="$(mktemp)"
    dump_args=(--schema-only --no-owner --schema=public --schema=auth --schema=extensions --schema=storage)
    if ! PGDATABASE="$SOURCE_DB" pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "${dump_args[@]}" -f "$tmp_dump" 2>"$dump_err"; then
      log "host pg_dump failed: $(tail -n 3 "$dump_err" | tr '\n' ' ')"
      log "retrying inside container $SOURCE_CONTAINER"
      if ! docker exec -e PGPASSWORD="$PGPASSWORD" -e PGDATABASE="$SOURCE_DB" "$SOURCE_CONTAINER" \
            pg_dump -h 127.0.0.1 -U "$DB_USER" "${dump_args[@]}" >"$tmp_dump" 2>"$dump_err"; then
        cat "$dump_err" >&2; rm -f "$dump_err"; drop_partial; die "pg_dump failed on host and in container"
      fi
    fi
    rm -f "$dump_err"
  fi

  # The dump keeps privileges on purpose: the grant tests assert them. Drop only what cannot or need not
  # be restored: schemas created above / present in the template, and default privileges of roles other
  # than postgres (not ours to change; the template already carries the postgres ones).
  awk '
    /^CREATE SCHEMA (extensions|public);$/ { next }
    /^COMMENT ON SCHEMA public IS/ { next }
    /^ALTER DEFAULT PRIVILEGES FOR ROLE / && $0 !~ /^ALTER DEFAULT PRIVILEGES FOR ROLE postgres / { next }
    { print }
  ' "$tmp_dump" >"$filtered" || { drop_partial; die "could not filter the schema dump"; }
  [ -s "$filtered" ] || { drop_partial; die "schema dump is empty"; }

  log "restoring schema ($(wc -l <"$filtered") lines, single transaction)"
  if ! out="$(psql_db "$DB_NAME" --single-transaction -f "$filtered" 2>&1 >/dev/null)"; then
    printf '%s\n' "$out" | grep -E 'ERROR' | head -5 >&2 || true
    drop_partial; die "schema restore failed"
  fi

  psql_db "$DB_NAME" -c "
    CREATE SCHEMA IF NOT EXISTS test_bootstrap;
    CREATE TABLE test_bootstrap.clone_done (done_at timestamptz NOT NULL DEFAULT now());
    INSERT INTO test_bootstrap.clone_done DEFAULT VALUES;" || { drop_partial; die "could not write the clone marker"; }
fi

# A database without the marker is a partial or foreign clone: never build on it.
marker="$(psql_val "$DB_NAME" -c "SELECT to_regclass('test_bootstrap.clone_done') IS NOT NULL")"
[ "$marker" = "t" ] || die "$DB_NAME exists but has no clone_done marker (partial or foreign database); re-run with --recreate"

# ---- 3. migration replay -----------------------------------------------------------------------
psql_db "$DB_NAME" -c "
  CREATE TABLE IF NOT EXISTS test_bootstrap.replayed_migrations (
    filename text PRIMARY KEY,
    checksum text,
    replayed_at timestamptz NOT NULL DEFAULT now()
  );"

replayed=0; skipped=0; failed=0; failures=()
for file in "$MIGRATIONS_DIR"/*.sql; do
  name="$(basename "$file")"
  ts="${name%%_*}"
  # Below the replay window the clone is assumed to contain the migration already, unless probing.
  if [ "$PROBE" = "0" ] && [[ "$ts" < "$REPLAY_FROM" ]]; then skipped=$((skipped + 1)); continue; fi
  sum="$(sha "$file")"
  recorded="$(psql_val "$DB_NAME" -c "SELECT COALESCE(checksum, '') FROM test_bootstrap.replayed_migrations WHERE filename = '$name'")"
  if [ -n "$recorded" ] || [ "$(psql_val "$DB_NAME" -c "SELECT 1 FROM test_bootstrap.replayed_migrations WHERE filename = '$name'")" = "1" ]; then
    if [ "$recorded" != "$sum" ]; then
      die "migration $name changed since it was replayed into $DB_NAME (recorded checksum '${recorded:-none}', file $sum); re-run with --recreate"
    fi
    skipped=$((skipped + 1)); continue
  fi
  if err="$(psql_db "$DB_NAME" --single-transaction -f "$file" 2>&1 >/dev/null)"; then
    psql_db "$DB_NAME" -c "INSERT INTO test_bootstrap.replayed_migrations (filename, checksum) VALUES ('$name', '$sum') ON CONFLICT DO NOTHING"
    replayed=$((replayed + 1))
    log "replayed  $name"
  else
    failed=$((failed + 1)); failures+=("$name")
    echo "[bootstrap] FAILED    $name" >&2
    printf '%s\n' "$err" | grep -E 'ERROR' | head -3 | sed 's/^/[bootstrap]   /' >&2 || true
    if [ "$PROBE" = "0" ]; then
      die "stopped on first failing migration: $name (use --probe to list every failure)"
    fi
  fi
done

# ---- 4. seed -----------------------------------------------------------------------------------
if [ "$SEED" = "1" ] && [ "$PROBE" = "0" ]; then
  log "loading fixture seed"
  psql_db "$DB_NAME" -f "$SEED_FILE" >/dev/null
fi

log "done: replayed=$replayed skipped=$skipped failed=$failed"
if [ "$failed" -gt 0 ]; then
  printf '[bootstrap] failing migrations: %s\n' "${failures[*]}" >&2
fi
if [ "$PROBE" = "0" ]; then
  echo
  echo "Run the DB tests with:  npm run test:concurrency"
  echo "(default target is $DB_NAME on $DB_HOST:$DB_PORT; override with STOCK_TEST_DB_URL, localhost only)"
fi
[ "$failed" -eq 0 ] || exit 1
