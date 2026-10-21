-- ============================================================================
-- Financial audit trail: who changed which money column, when, from what to what.   PREPARED, NOT APPLIED
-- ============================================================================
-- WHY: an admin can PATCH money columns of remittances / orders (and the pricing config in remittance_types /
--   shipping_zones) straight through PostgREST and nothing records it: remittance_status_history and
--   order_status_history only audit `status`. activity_logs cannot be reused: it is client-writable (forgeable),
--   has a 90-day TTL (pg_cron job purge-old-activity-logs, migration 20260809000002 / SEC-07) and rewrites its
--   content (email redaction). A financial trail must be append-only, trigger-written and kept.
--
-- WHAT:
--   1. public.financial_audit_log: ONE ROW PER CHANGED COLUMN (table_name, row_id, column_name, old_value,
--      new_value as text, operation, changed_by, changed_by_role, via_function, txid, changed_at). One row per
--      column keeps the UI trivial (filter by row_id / changed_by / column_name, no jsonb unpacking) and
--      numeric::text keeps the exact scale. Rows of one UPDATE share `txid`.
--   2. public.financial_audit_columns(table_name): IMMUTABLE, the ONLY place where the monitored column lists live.
--      Used by the trigger function and by the DO block that generates each trigger's `UPDATE OF <cols>` and
--      `WHEN (OLD.c IS DISTINCT FROM NEW.c OR ...)`, so the lists cannot diverge. A new money column needs a new
--      migration that extends it (tests check every listed column exists and that trigger and function agree).
--        remittances       commission_percentage, commission_fixed, commission_total, exchange_rate, amount_sent,
--                          amount_to_deliver, discount_amount, delivery_cost, shipping_zone_id, remittance_type_id,
--                          currency_sent, currency_delivered
--        orders            subtotal, discount_amount, shipping_cost, tax_amount, total_amount, shipping_zone_id,
--                          payment_amount, payment_usd_reference, payment_fx_rate, currency_id, payment_currency
--        remittance_types  exchange_rate, commission_percentage, commission_fixed, min_amount, max_amount,
--                          is_active, currency_code, delivery_currency
--        shipping_zones    shipping_cost, transport_cost, free_shipping, is_active
--        exchange_rates    rate, is_active, effective_date, from_currency_id, to_currency_id
--   3. public.audit_financial_changes(): AFTER UPDATE OF <monitored cols> ... WHEN (a monitored col changed) on
--      remittances, orders, remittance_types, shipping_zones, exchange_rates; AFTER DELETE on remittance_types,
--      shipping_zones, exchange_rates. Status / stock / any other UPDATE never reaches the function (the trigger is
--      gated in the catalog, like guard_bizum_quote_immutable). The function still compares column by column
--      (IS DISTINCT FROM; DELETE: every monitored column, new_value NULL) as defence in depth.
--   4. Actor: changed_by = auth.uid(); changed_by_role = super_admin | admin | user | service_role | system
--      (no JWT subject: GUC role = service_role -> 'service_role', anything else, e.g. the SQL editor -> 'system').
--      via_function = nearest calling PL/pgSQL function taken from PG_CONTEXT (e.g. the remittance
--      re-pricing RPC), NULL for a direct UPDATE such as a PostgREST PATCH. Informational.
--   5. Immutability (what it is and what it is NOT): BEFORE UPDATE/DELETE (row) and BEFORE TRUNCATE (statement)
--      triggers raise for every role on DML, postgres included, and all audit/log triggers are ENABLE ALWAYS (they
--      also fire under session_replication_role = replica). This protects the log against the app and against admins
--      (PostgREST / RPC). It does NOT protect against whoever runs SQL with table-owner privileges: an owner can
--      ALTER TABLE ... DISABLE TRIGGER or DROP TABLE. In prod `postgres` is not a superuser and only
--      supabase_admin can set session_replication_role = replica. Such actions are outside the guarantee.
--
-- DESIGN NOTES
--   * FAIL-CLOSED: if the audit INSERT fails, the money UPDATE fails. Because of UPDATE OF ... WHEN the function runs
--     only when a monitored column really changed (rare: admin edits, the remittance re-pricing RPC, config changes),
--     so a failure can never abort an unrelated stock/status UPDATE; a money change without a trace is worse than an
--     error. The checkout INSERT never fires it (UPDATE/DELETE triggers only); payment validation, cancellation, stock
--     reservation and execute_platform_reset do not change monitored columns (reset DELETEs orders/remittances, and
--     those tables have no DELETE audit trigger), all covered by DB tests.
--   * SECURITY DEFINER (owner writes the table; no API role has INSERT). search_path = public, pg_temp; EXECUTE revoked
--     from PUBLIC/anon/authenticated. auth.uid()/is_admin_user() still see the caller inside DEFINER.
--   * RLS on; SELECT only for is_admin_user() (admin + super_admin, enabled); GRANT SELECT to authenticated and
--     service_role. All other privileges are REVOKED explicitly because Supabase default privileges grant ALL to
--     anon/authenticated/service_role on new public tables (verified in prod, pg_default_acl).
--   * No FK (execute_platform_reset and deletes are never blocked; rows of deleted remittances/orders stay by design:
--     the reset KEEPS this table, like activity_logs and admin_destructive_ops_log). Not added to supabase_realtime.
--   * No PII: only ids, column names and monetary / boolean / zone-id values. Nothing about the recipient.
--   * Indexes: (table_name, row_id, changed_at DESC, id DESC) = history of one remittance/order/type/zone;
--     (changed_at DESC, id DESC) = global feed with keyset pagination. Nothing on changed_by/column_name yet
--     (expected volume: hundreds of rows; add when EXPLAIN says so).
--   * Not audited on purpose: INSERTs (a new row has no "before"; checkout must stay untouched), status changes (own
--     history tables), proof/recipient fields.
--
-- UI contract (future RPC/view, not built here): id, changed_at, table_name, row_id, column_name, old_value,
--   new_value, operation, changed_by, changed_by_role, via_function, txid. Join user_profiles on changed_by for the name
--   and remittances/orders on row_id for the number. Read it with SELECT + RLS, paginate by (changed_at, id).
--
-- Production verification (read-only SELECTs via MCP, 2026-10-19, project qcwnlbpultscerwdnzbm):
--   All monitored columns exist with the names above (remittances 9, orders 9, remittance_types 8, shipping_zones 3);
--   financial_audit_log absent; remittance_types and shipping_zones have no triggers; 27 remittances, 31 orders,
--   4 remittance_types, 26 shipping_zones. The only functions that UPDATE these tables: the remittance re-pricing RPC
--   (money) and the stock functions _reserve_order_locked, _release_order_locked, expire_stale_order_reservations,
--   reserve_order_inventory, restock_order_inventory (no monitored column). activity_logs: 783 rows, TTL cron
--   purge-old-activity-logs '0 3 * * *' active, only 14 remittance entries. is_admin_user() = profile role in
--   (admin, super_admin) AND is_enabled. pg_default_acl grants ALL to anon/authenticated/service_role.
--
-- Added columns verified by SELECT on information_schema in prod and in the scratch DB (2026-10-19): exchange_rates
--   (id uuid, rate numeric(.,6), is_active, effective_date, from/to_currency_id), remittances.remittance_type_id /
--   currency_sent / currency_delivered, orders.currency_id / payment_currency, shipping_zones.is_active.
--
-- Preconditions: is_admin_user(), auth.uid(), the five tables. No data is modified. Idempotent (IF NOT EXISTS,
--   CREATE OR REPLACE, DROP ... IF EXISTS before CREATE). Needs the owner's "dale" to apply remotely.
--
-- ROLLBACK (exact; also in supabase/rollbacks/20261020100000_financial_audit_log_down.sql). Destroys the audit rows:
--   export them first if the table already holds data.
--   DROP TRIGGER IF EXISTS audit_financial_update ON public.remittances;
--   DROP TRIGGER IF EXISTS audit_financial_update ON public.orders;
--   DROP TRIGGER IF EXISTS audit_financial_update ON public.remittance_types;
--   DROP TRIGGER IF EXISTS audit_financial_delete ON public.remittance_types;
--   DROP TRIGGER IF EXISTS audit_financial_update ON public.shipping_zones;
--   DROP TRIGGER IF EXISTS audit_financial_delete ON public.shipping_zones;
--   DROP TRIGGER IF EXISTS audit_financial_update ON public.exchange_rates;
--   DROP TRIGGER IF EXISTS audit_financial_delete ON public.exchange_rates;
--   DROP FUNCTION IF EXISTS public.audit_financial_changes();
--   DROP FUNCTION IF EXISTS public.financial_audit_columns(text);
--   DROP TABLE IF EXISTS public.financial_audit_log;          -- also drops its immutability triggers and policy
--   DROP FUNCTION IF EXISTS public.financial_audit_log_block_mutation();
-- ============================================================================

SET LOCAL lock_timeout = '5s';

-- ----------------------------------------------------------------------------------------------------
-- 1. Table (append-only, admin-readable, written only by the trigger)
-- ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.financial_audit_log (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_name      text        NOT NULL,
  row_id          uuid        NOT NULL,
  column_name     text        NOT NULL,
  old_value       text,
  new_value       text,
  operation       text        NOT NULL CHECK (operation IN ('UPDATE', 'DELETE')),
  changed_by      uuid,
  changed_by_role text        NOT NULL CHECK (changed_by_role IN ('super_admin', 'admin', 'user', 'service_role', 'system')),
  via_function    text,
  txid            bigint      NOT NULL DEFAULT txid_current(),
  changed_at      timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.financial_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS financial_audit_log_select_admin ON public.financial_audit_log;
CREATE POLICY financial_audit_log_select_admin ON public.financial_audit_log
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_user()));

REVOKE ALL ON public.financial_audit_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.financial_audit_log TO authenticated, service_role;

CREATE INDEX IF NOT EXISTS financial_audit_log_row_idx
  ON public.financial_audit_log (table_name, row_id, changed_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS financial_audit_log_changed_at_idx
  ON public.financial_audit_log (changed_at DESC, id DESC);

-- ----------------------------------------------------------------------------------------------------
-- 2. Immutability (DML only, every role incl. postgres; see header point 5 for the limits)
-- ----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.financial_audit_log_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION 'financial_audit_log_is_append_only' USING ERRCODE = '42501';
END;
$function$;

REVOKE ALL ON FUNCTION public.financial_audit_log_block_mutation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS financial_audit_log_immutable_row ON public.financial_audit_log;
CREATE TRIGGER financial_audit_log_immutable_row
  BEFORE UPDATE OR DELETE ON public.financial_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.financial_audit_log_block_mutation();

DROP TRIGGER IF EXISTS financial_audit_log_immutable_truncate ON public.financial_audit_log;
CREATE TRIGGER financial_audit_log_immutable_truncate
  BEFORE TRUNCATE ON public.financial_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.financial_audit_log_block_mutation();

-- ----------------------------------------------------------------------------------------------------
-- 3. Monitored columns (single source of truth) and the audit trigger function (fail-closed: no exception handler)
-- ----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.financial_audit_columns(p_table text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
  SELECT CASE p_table
    WHEN 'remittances' THEN ARRAY['commission_percentage', 'commission_fixed', 'commission_total', 'exchange_rate',
                                  'amount_sent', 'amount_to_deliver', 'discount_amount', 'delivery_cost', 'shipping_zone_id',
                                  'remittance_type_id', 'currency_sent', 'currency_delivered']
    WHEN 'orders' THEN ARRAY['subtotal', 'discount_amount', 'shipping_cost', 'tax_amount', 'total_amount',
                             'shipping_zone_id', 'payment_amount', 'payment_usd_reference', 'payment_fx_rate',
                             'currency_id', 'payment_currency']
    WHEN 'remittance_types' THEN ARRAY['exchange_rate', 'commission_percentage', 'commission_fixed', 'min_amount',
                                       'max_amount', 'is_active', 'currency_code', 'delivery_currency']
    WHEN 'shipping_zones' THEN ARRAY['shipping_cost', 'transport_cost', 'free_shipping', 'is_active']
    WHEN 'exchange_rates' THEN ARRAY['rate', 'is_active', 'effective_date', 'from_currency_id', 'to_currency_id']
    ELSE ARRAY[]::text[]
  END;
$function$;

REVOKE ALL ON FUNCTION public.financial_audit_columns(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.audit_financial_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_cols     text[] := public.financial_audit_columns(TG_TABLE_NAME);
  v_col      text;
  v_old      jsonb := to_jsonb(OLD);
  v_new      jsonb;
  v_uid      uuid  := auth.uid();
  v_role     text;
  v_ctx      text;
  v_via      text;
  v_resolved boolean := false;
BEGIN
  v_new := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;

  FOREACH v_col IN ARRAY v_cols LOOP
    IF TG_OP = 'UPDATE' AND (v_old -> v_col) IS NOT DISTINCT FROM (v_new -> v_col) THEN
      CONTINUE;
    END IF;

    IF NOT v_resolved THEN
      v_role := CASE
        WHEN v_uid IS NULL THEN
          CASE WHEN COALESCE(current_setting('role', true), '') = 'service_role' THEN 'service_role' ELSE 'system' END
        WHEN public.is_super_admin() THEN 'super_admin'
        WHEN public.is_admin_user() THEN 'admin'
        ELSE 'user'
      END;
      GET DIAGNOSTICS v_ctx = PG_CONTEXT;
      -- First "PL/pgSQL function x(" AFTER our own frame = the nearest calling function (NULL for a direct UPDATE).
      v_via := substring(v_ctx FROM E'\nPL/pgSQL function ([^(\\s]+)\\(');
      v_resolved := true;
    END IF;

    INSERT INTO public.financial_audit_log
      (table_name, row_id, column_name, old_value, new_value, operation, changed_by, changed_by_role, via_function)
    VALUES
      (TG_TABLE_NAME, OLD.id, v_col, v_old ->> v_col, v_new ->> v_col, TG_OP, v_uid, v_role, v_via);
  END LOOP;

  RETURN NULL; -- AFTER trigger: return value is ignored
END;
$function$;

REVOKE ALL ON FUNCTION public.audit_financial_changes() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------------------------------
-- 4. Triggers. UPDATE OF / WHEN are generated from financial_audit_columns() so they cannot drift from the function.
--    ENABLE ALWAYS: they fire in every session_replication_role (origin, replica, local).
-- ----------------------------------------------------------------------------------------------------
DO $$
DECLARE
  t      text;
  v_cols text[];
  v_when text;
BEGIN
  FOREACH t IN ARRAY ARRAY['remittances', 'orders', 'remittance_types', 'shipping_zones', 'exchange_rates'] LOOP
    v_cols := public.financial_audit_columns(t);
    SELECT string_agg(format('OLD.%1$I IS DISTINCT FROM NEW.%1$I', c), ' OR ' ORDER BY ord) INTO v_when
      FROM unnest(v_cols) WITH ORDINALITY AS u(c, ord);
    EXECUTE format('DROP TRIGGER IF EXISTS audit_financial_update ON public.%I', t);
    EXECUTE format('CREATE TRIGGER audit_financial_update AFTER UPDATE OF %s ON public.%I '
                   'FOR EACH ROW WHEN (%s) EXECUTE FUNCTION public.audit_financial_changes()',
                   (SELECT string_agg(quote_ident(c), ', ' ORDER BY ord) FROM unnest(v_cols) WITH ORDINALITY AS u(c, ord)), t, v_when);
    EXECUTE format('ALTER TABLE public.%I ENABLE ALWAYS TRIGGER audit_financial_update', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['remittance_types', 'shipping_zones', 'exchange_rates'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_financial_delete ON public.%I', t);
    EXECUTE format('CREATE TRIGGER audit_financial_delete AFTER DELETE ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION public.audit_financial_changes()', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ALWAYS TRIGGER audit_financial_delete', t);
  END LOOP;
END $$;

ALTER TABLE public.financial_audit_log ENABLE ALWAYS TRIGGER financial_audit_log_immutable_row;
ALTER TABLE public.financial_audit_log ENABLE ALWAYS TRIGGER financial_audit_log_immutable_truncate;
