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
--   2. public.audit_financial_changes(): AFTER UPDATE (remittances, orders, remittance_types, shipping_zones) and
--      AFTER DELETE (remittance_types, shipping_zones) row trigger. It writes only the monitored columns whose value
--      IS DISTINCT FROM the old one (DELETE: every monitored column, new_value NULL). The column list lives ONLY in
--      this function (single source of truth); a new money column needs a new migration that extends it.
--        remittances       commission_percentage, commission_fixed, commission_total, exchange_rate, amount_sent,
--                          amount_to_deliver, discount_amount, delivery_cost, shipping_zone_id
--        orders            subtotal, discount_amount, shipping_cost, tax_amount, total_amount, shipping_zone_id,
--                          payment_amount, payment_usd_reference, payment_fx_rate
--        remittance_types  exchange_rate, commission_percentage, commission_fixed, min_amount, max_amount,
--                          is_active, currency_code, delivery_currency
--        shipping_zones    shipping_cost, transport_cost, free_shipping
--   3. Actor: changed_by = auth.uid(); changed_by_role = super_admin | admin | user | service_role | system
--      (no JWT subject: GUC role = service_role -> 'service_role', anything else, e.g. the SQL editor -> 'system').
--      via_function = nearest calling PL/pgSQL function taken from PG_CONTEXT (e.g. the remittance
--      re-pricing RPC), NULL for a direct UPDATE such as a PostgREST PATCH. Informational.
--   4. Immutability: BEFORE UPDATE/DELETE (row) and BEFORE TRUNCATE (statement) triggers raise for EVERYONE, postgres
--      included. Limit (documented): a superuser can still DROP TABLE or ALTER TABLE ... DISABLE TRIGGER.
--
-- DESIGN NOTES
--   * FAIL-CLOSED: if the audit INSERT fails, the money UPDATE fails. The trigger only works when a monitored column
--     really changed (rare: admin edits, the remittance re-pricing RPC, config changes); a money change
--     without a trace is worse than an error. The checkout INSERT never fires it (UPDATE/DELETE triggers only);
--     payment validation, cancellation, stock reservation and execute_platform_reset do not change monitored columns
--     (reset DELETEs orders/remittances, and these tables have no DELETE audit trigger), all covered by DB tests.
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
-- Preconditions: is_admin_user(), auth.uid(), the four tables. No data is modified. Idempotent (IF NOT EXISTS,
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
--   DROP FUNCTION IF EXISTS public.audit_financial_changes();
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
  changed_at      timestamptz NOT NULL DEFAULT now()
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
-- 2. Immutability (applies to every role, postgres included)
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
-- 3. The audit trigger function (fail-closed: no exception handler on purpose)
-- ----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_financial_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_cols     text[];
  v_col      text;
  v_old      jsonb := to_jsonb(OLD);
  v_new      jsonb;
  v_uid      uuid  := auth.uid();
  v_role     text;
  v_ctx      text;
  v_via      text;
  v_resolved boolean := false;
BEGIN
  v_cols := CASE TG_TABLE_NAME
    WHEN 'remittances' THEN ARRAY['commission_percentage', 'commission_fixed', 'commission_total', 'exchange_rate',
                                  'amount_sent', 'amount_to_deliver', 'discount_amount', 'delivery_cost', 'shipping_zone_id']
    WHEN 'orders' THEN ARRAY['subtotal', 'discount_amount', 'shipping_cost', 'tax_amount', 'total_amount',
                             'shipping_zone_id', 'payment_amount', 'payment_usd_reference', 'payment_fx_rate']
    WHEN 'remittance_types' THEN ARRAY['exchange_rate', 'commission_percentage', 'commission_fixed', 'min_amount',
                                       'max_amount', 'is_active', 'currency_code', 'delivery_currency']
    WHEN 'shipping_zones' THEN ARRAY['shipping_cost', 'transport_cost', 'free_shipping']
    ELSE ARRAY[]::text[]
  END;
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
      v_via := substring(v_ctx FROM E'\nPL/pgSQL function ([A-Za-z0-9_]+)\\(');
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
-- 4. Triggers
-- ----------------------------------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['remittances', 'orders', 'remittance_types', 'shipping_zones'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_financial_update ON public.%I', t);
    EXECUTE format('CREATE TRIGGER audit_financial_update AFTER UPDATE ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION public.audit_financial_changes()', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['remittance_types', 'shipping_zones'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_financial_delete ON public.%I', t);
    EXECUTE format('CREATE TRIGGER audit_financial_delete AFTER DELETE ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION public.audit_financial_changes()', t);
  END LOOP;
END $$;
