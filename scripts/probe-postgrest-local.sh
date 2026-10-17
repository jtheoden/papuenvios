#!/usr/bin/env bash
# Runs the HTTP contract probe (scripts/probe-postgrest-contract.mjs) end to end against a LOCAL PostgREST:
#
#   1. builds the scratch database papuenvios_test_pgrst (schema clone + every repo migration, so migration A is in)
#      with scripts/test-db-bootstrap.sh, then loads scripts/probe-postgrest-seed.sql;
#   2. starts an ephemeral PostgREST container (image already present locally; nothing is pulled) on 127.0.0.1,
#      pointed at that database, with the DB URI and JWT secret read AT RUNTIME from the local e2e PostgREST
#      container's environment (they are never written to a file or printed);
#   3. mints short-lived JWTs (anon / customer / admin) in memory;
#   4. phase before-b  -> applies contract B -> phase after-b -> applies the B rollback -> before-b again,
#      comparing the table/column grants before B and after the rollback;
#   5. on ANY exit, removes the container and drops the scratch database.
#
# Never touches the hosted Supabase project, the `postgres` database or `papuenvios_test`.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

DB_NAME="papuenvios_test_pgrst"
DB_HOST="127.0.0.1"
DB_PORT="55322"
DB_USER="${TEST_DB_USER:-postgres}"
# Local scratch default: the password equals the user name (the e2e container's convention); no
# password literal is committed.
export PGPASSWORD="${TEST_DB_PASSWORD:-$DB_USER}"
SRC_REST="supabase_rest_e2e-supabase"
NETWORK="supabase_network_e2e-supabase"
IMAGE="${PROBE_POSTGREST_IMAGE:-public.ecr.aws/supabase/postgrest:v14.1}"
CONTAINER="papuenvios_probe_postgrest"
HOST_PORT="${PROBE_LOCAL_PORT:-54701}"
CUSTOMER_SUB="9026d846-b1a8-482f-95b4-8ec8e67c1555"
ADMIN_SUB="d9dd264f-116c-4b0c-b1e2-4760fd61f7bd"
CONTRACT="supabase/contract/20261016160100_phase0b_contract_revoke_cost_columns.sql"
ROLLBACK="supabase/rollbacks/20261016160100_phase0b_contract_revoke_cost_columns_down.sql"

log() { echo "[probe-local] $*" >&2; }
die() { echo "probe-local: $*" >&2; exit 1; }
psql_db() { local db="$1"; shift; psql -X -q -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$db" -v ON_ERROR_STOP=1 "$@"; }

command -v docker >/dev/null || die "docker is required"
command -v psql >/dev/null || die "psql is required"
docker image inspect "$IMAGE" >/dev/null 2>&1 || die "image $IMAGE is not present locally (this runner never pulls); set PROBE_POSTGREST_IMAGE to a local PostgREST image"
docker inspect "$SRC_REST" >/dev/null 2>&1 || die "container $SRC_REST not found: the local e2e Supabase stack must be running"

cleanup() {
  local rc=$?
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  psql_db postgres -c "DROP DATABASE IF EXISTS \"$DB_NAME\" WITH (FORCE)" >/dev/null 2>&1 || true
  log "cleanup done (container removed, $DB_NAME dropped)"
  exit "$rc"
}
trap cleanup EXIT

container_env() {
  docker inspect "$SRC_REST" --format '{{range .Config.Env}}{{println .}}{{end}}' | awk -F= -v k="$1" '$1==k { sub(/^[^=]*=/, ""); print; exit }'
}

# ---- 1. scratch database ---------------------------------------------------------------------------------
log "building scratch database $DB_NAME"
TEST_DB_NAME="$DB_NAME" bash scripts/test-db-bootstrap.sh --recreate >&2
psql_db "$DB_NAME" -f scripts/probe-postgrest-seed.sql >/dev/null

# ---- 2. ephemeral PostgREST -------------------------------------------------------------------------------
SRC_URI="$(container_env PGRST_DB_URI)"
[ -n "$SRC_URI" ] || die "could not read PGRST_DB_URI from $SRC_REST"
PGRST_DB_URI="${SRC_URI%/*}/$DB_NAME"
PGRST_JWT_SECRET="$(container_env PGRST_JWT_SECRET)"
[ -n "$PGRST_JWT_SECRET" ] || die "could not read PGRST_JWT_SECRET from $SRC_REST"
export PGRST_DB_URI PGRST_JWT_SECRET
export PGRST_DB_SCHEMAS="public" PGRST_DB_ANON_ROLE="anon" PGRST_DB_EXTRA_SEARCH_PATH="public,extensions" PGRST_DB_MAX_ROWS="1000"

docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
log "starting $IMAGE on 127.0.0.1:$HOST_PORT"
docker run -d --rm --name "$CONTAINER" --network "$NETWORK" -p "127.0.0.1:$HOST_PORT:3000" \
  -e PGRST_DB_URI -e PGRST_JWT_SECRET -e PGRST_DB_SCHEMAS -e PGRST_DB_ANON_ROLE -e PGRST_DB_EXTRA_SEARCH_PATH -e PGRST_DB_MAX_ROWS \
  "$IMAGE" >/dev/null

# ---- 3. in-memory JWTs ------------------------------------------------------------------------------------
mint() { PROBE_JWT_SECRET="$PGRST_JWT_SECRET" node scripts/probe-postgrest-contract.mjs --mint="$1" ${2:+--sub="$2"}; }
export PROBE_BASE_URL="http://127.0.0.1:$HOST_PORT"
PROBE_ANON_KEY="$(mint anon)"
PROBE_CUSTOMER_JWT="$(mint customer "$CUSTOMER_SUB")"
PROBE_ADMIN_JWT="$(mint admin "$ADMIN_SUB")"
export PROBE_ANON_KEY PROBE_CUSTOMER_JWT PROBE_ADMIN_JWT

log "waiting for PostgREST"
ready=0
last_status="no-response"
for _ in $(seq 1 60); do
  last_status="$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $PROBE_ANON_KEY" "$PROBE_BASE_URL/products?select=id&limit=1" 2>/dev/null || true)"
  if [ "$last_status" = "200" ]; then ready=1; break; fi
  sleep 0.5
done
[ "$ready" = "1" ] || { docker logs "$CONTAINER" 2>&1 | tail -15 >&2; die "PostgREST did not become ready (last HTTP status: $last_status)"; }
docker logs "$CONTAINER" 2>&1 | grep -Ei "listening|starting postgrest|schema cache loaded" >&2 || true

reload_schema() {
  docker kill -s USR1 "$CONTAINER" >/dev/null 2>&1 || true   # schema cache reload, besides the NOTIFY in B
  sleep 1.5
}

grants_snapshot() {
  psql_db "$DB_NAME" -At -c "
    SELECT 'T|' || table_name || '|' || grantee || '|' || privilege_type FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND grantee IN ('anon','authenticated')
       AND table_name IN ('products','combo_products','combo_items','product_categories','inventory','shipping_zones','remittance_services','order_analytics')
    UNION ALL
    SELECT 'C|' || table_name || '|' || column_name || '|' || grantee || '|' || privilege_type FROM information_schema.column_privileges
     WHERE table_schema = 'public' AND grantee IN ('anon','authenticated')
       AND table_name IN ('products','combo_products','combo_items','product_categories','inventory','shipping_zones','remittance_services','order_analytics')
    ORDER BY 1"
}

FAILED=0
run_phase() {
  local label="$1" phase="$2"
  echo
  echo "=================== $label ==================="
  node scripts/probe-postgrest-contract.mjs --phase="$phase" || FAILED=$((FAILED + 1))
}

# ---- 4. phases ---------------------------------------------------------------------------------------------
GRANTS_BEFORE="$(grants_snapshot)"

# Negative control: the after-b assertions MUST fail while B is not applied, otherwise the probe proves nothing.
echo
echo "=================== 0. negative control (after-b assertions against the NOT contracted DB: must FAIL) ==================="
set +e
CONTROL_OUT="$(node scripts/probe-postgrest-contract.mjs --phase=after-b)"
CONTROL_RC=$?
set -e
printf '%s\n' "$CONTROL_OUT" | tail -n 1
if [ "$CONTROL_RC" -eq 1 ]; then
  echo "negative control OK: the probe detects the open leak (exit 1)"
else
  echo "negative control BROKEN: expected exit 1, got $CONTROL_RC (the probe would pass on a leaky database)"
  FAILED=$((FAILED + 1))
fi

run_phase "1. before-b (contract NOT applied: documents the leak)" before-b

log "applying contract B to $DB_NAME"
psql_db "$DB_NAME" -f "$CONTRACT" >/dev/null
reload_schema
run_phase "2. after-b (contract applied)" after-b

log "applying the B rollback to $DB_NAME"
psql_db "$DB_NAME" -f "$ROLLBACK" >/dev/null
reload_schema
run_phase "3. before-b again (after the rollback)" before-b

GRANTS_AFTER_ROLLBACK="$(grants_snapshot)"
echo
if [ "$GRANTS_BEFORE" = "$GRANTS_AFTER_ROLLBACK" ]; then
  echo "grants snapshot: identical before B and after the rollback ($(printf '%s\n' "$GRANTS_BEFORE" | wc -l) entries)"
else
  echo "grants snapshot: DIFFERENT after the rollback"
  diff <(printf '%s\n' "$GRANTS_BEFORE") <(printf '%s\n' "$GRANTS_AFTER_ROLLBACK") | head -20 || true
  FAILED=$((FAILED + 1))
fi

echo
if [ "$FAILED" -eq 0 ]; then echo "ALL PHASES PASSED"; else echo "FAILED CHECKS: $FAILED"; fi
exit "$FAILED"
