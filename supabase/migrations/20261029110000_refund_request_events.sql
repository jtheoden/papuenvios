-- ============================================================================
-- Refund audit trail (R5a 1/3): append-only events.   PREPARED, NOT APPLIED
-- ============================================================================
-- WHY: the refund stage must be auditable (who, when) across the whole life of an order/remittance. refund_requests holds the
--   CURRENT state; this table keeps the history, so a reopen or a second cancellation never rewrites what happened before.
--
-- WHAT (all additive; nothing existing is replaced, altered or backfilled):
--   * public.refund_request_events: append-only (BEFORE UPDATE/DELETE/TRUNCATE raise 42501, like financial_audit_log), RLS on,
--     SELECT for admins only, no write grant to any API role. NO foreign keys on purpose: execute_platform_reset deletes
--     orders/remittances (cascading to refund_requests); a FK with an immutability trigger would break the reset, and the reset
--     keeps audit tables (financial_audit_log, activity_logs). No PII: ids, amounts and flags only; the free-text reason, the Zelle
--     reference and the proof path stay in refund_requests.
--   * five nullable/defaulted columns on the NEW table refund_requests (proof_*, self_resolved), used by R5b.
--   * trigger refund_requests_audit (AFTER INSERT OR UPDATE): derives the event from OLD/NEW, so the R4 cancel/reopen triggers and
--     the resolve RPCs need no change. FAIL-OPEN: any error becomes a WARNING plus a best-effort activity_logs row
--     (refund_event_failed, SQLSTATE only); it can never abort a legitimate cancellation. The gap shows in admin_refund_trace.
--   * trigger refund_requests_guard (BEFORE UPDATE), the single place where the rules hold whatever function resolves the row
--     (v1 admin_resolve_refund included, so v1 does not need to be revoked):
--       - resolved rows are immutable (so the proof columns, set in the same UPDATE that resolves, can never change; the only
--         later change is proof_purged_at NULL -> now(), and only for an expired proof);
--       - pending -> refunded requires proof_path while refund_proof_required() is true;
--       - resolved_by <> the customer of the refund unless self_resolved (separation of duties). The only exception is a real
--         reopen: reason 'reopened' AND the operation is no longer cancelled (a faked 'reopened' reason does not pass).
--   * refund_proof_required() is created HERE (the guard calls it); it returns true.
--   * The table is born EMPTY: no event is invented for refunds that existed before this migration.
-- Actor = auth.uid(), or app.refund_actor (transaction-local, set by the service-role purge helper), else 'system'.
-- Clock = now() of the transaction, so the event shares its timestamp with the refund row and with *_status_history.
-- Requires 20261029100000..100400 (refund_requests). ROLLBACK: supabase/rollbacks/20261029110000_refund_request_events_down.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.refund_requests
  ADD COLUMN IF NOT EXISTS proof_path       text,
  ADD COLUMN IF NOT EXISTS proof_sha256     text,
  ADD COLUMN IF NOT EXISTS proof_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS proof_purged_at  timestamptz,
  ADD COLUMN IF NOT EXISTS self_resolved    boolean NOT NULL DEFAULT false;

ALTER TABLE public.refund_requests DROP CONSTRAINT IF EXISTS refund_requests_proof_path_format;
ALTER TABLE public.refund_requests ADD CONSTRAINT refund_requests_proof_path_format
  CHECK (proof_path IS NULL
         OR proof_path ~ '^refunds/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|pdf)$');
ALTER TABLE public.refund_requests DROP CONSTRAINT IF EXISTS refund_requests_proof_sha256_format;
ALTER TABLE public.refund_requests ADD CONSTRAINT refund_requests_proof_sha256_format
  CHECK (proof_sha256 IS NULL OR proof_sha256 ~ '^[0-9a-f]{64}$');

CREATE TABLE IF NOT EXISTS public.refund_request_events (
  id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  refund_id       uuid        NOT NULL,
  operation_type  text        NOT NULL CHECK (operation_type IN ('order', 'remittance')),
  order_id        uuid,
  remittance_id   uuid,
  event_type      text        NOT NULL CHECK (event_type IN (
                    'created', 'closed_refunded', 'closed_not_applicable', 'closed_by_reopen', 'proof_attached',
                    'proof_expired', 'dispute_opened', 'dispute_closed', 'self_resolution_blocked')),
  from_status     text,
  to_status       text,
  actor_id        uuid,
  actor_role      text        NOT NULL CHECK (actor_role IN ('customer', 'admin', 'super_admin', 'system')),
  owner_is_actor  boolean     NOT NULL DEFAULT false,
  amount          numeric(10,2),
  currency        text,
  reason_code     text        CHECK (reason_code IS NULL OR reason_code IN ('reopened', 'admin_text', 'self_resolved')),
  has_reference   boolean,
  has_proof       boolean,
  proof_object_id uuid,
  txid            bigint      NOT NULL DEFAULT txid_current(),
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT refund_request_events_one_operation CHECK ((order_id IS NULL) <> (remittance_id IS NULL))
);

COMMENT ON TABLE public.refund_request_events IS
  'Append-only history of refund requests (who, when). No PII, no foreign keys (survives the platform reset). Written only by '
  'refund_requests_audit and the refund RPCs through _refund_event.';

CREATE INDEX IF NOT EXISTS refund_request_events_order_idx
  ON public.refund_request_events (order_id, occurred_at, id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS refund_request_events_remittance_idx
  ON public.refund_request_events (remittance_id, occurred_at, id) WHERE remittance_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS refund_request_events_refund_idx ON public.refund_request_events (refund_id, id);

ALTER TABLE public.refund_request_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.refund_request_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.refund_request_events TO authenticated;

DROP POLICY IF EXISTS refund_request_events_admin_select ON public.refund_request_events;
CREATE POLICY refund_request_events_admin_select ON public.refund_request_events
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_user()));

-- ---------------------------------------------------------------------------------------------------------------
-- Immutability (DML only; a superuser can still DROP the table, same limit as financial_audit_log)
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refund_request_events_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION 'refund_request_events_is_append_only' USING ERRCODE = '42501';
END;
$function$;
REVOKE ALL ON FUNCTION public.refund_request_events_block_mutation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS refund_request_events_immutable_row ON public.refund_request_events;
CREATE TRIGGER refund_request_events_immutable_row
  BEFORE UPDATE OR DELETE ON public.refund_request_events
  FOR EACH ROW EXECUTE FUNCTION public.refund_request_events_block_mutation();

DROP TRIGGER IF EXISTS refund_request_events_immutable_truncate ON public.refund_request_events;
CREATE TRIGGER refund_request_events_immutable_truncate
  BEFORE TRUNCATE ON public.refund_request_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.refund_request_events_block_mutation();

-- ---------------------------------------------------------------------------------------------------------------
-- Single writer. Internal: no API role may call it.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._refund_event(
  p_refund          public.refund_requests,
  p_type            text,
  p_from_status     text,
  p_to_status       text,
  p_reason_code     text,
  p_has_reference   boolean,
  p_has_proof       boolean,
  p_proof_object_id uuid,
  p_actor           uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_role text;
BEGIN
  SELECT CASE up.role WHEN 'super_admin' THEN 'super_admin' WHEN 'admin' THEN 'admin' ELSE 'customer' END
    INTO v_role
    FROM public.user_profiles up WHERE up.id = p_actor;
  IF p_actor IS NULL THEN
    v_role := 'system';
  END IF;

  INSERT INTO public.refund_request_events (
    refund_id, operation_type, order_id, remittance_id, event_type, from_status, to_status, actor_id, actor_role,
    owner_is_actor, amount, currency, reason_code, has_reference, has_proof, proof_object_id)
  VALUES (
    p_refund.id, p_refund.operation_type, p_refund.order_id, p_refund.remittance_id, p_type, p_from_status, p_to_status,
    p_actor, COALESCE(v_role, 'customer'), p_actor IS NOT NULL AND p_actor = p_refund.user_id, p_refund.amount,
    p_refund.currency, p_reason_code, p_has_reference, p_has_proof, p_proof_object_id);
END;
$function$;
REVOKE ALL ON FUNCTION public._refund_event(public.refund_requests, text, text, text, text, boolean, boolean, uuid, uuid)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Audit trigger (fail-open)
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refund_requests_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor  uuid;
  v_object uuid;
BEGIN
  BEGIN
    v_actor := COALESCE(auth.uid(), NULLIF(current_setting('app.refund_actor', true), '')::uuid);
    IF TG_OP = 'INSERT' THEN
      PERFORM public._refund_event(NEW, 'created', NULL, NEW.status, NULL, false, false, NULL, v_actor);
    ELSE
      IF OLD.status = 'pending' AND NEW.status = 'refunded' THEN
        PERFORM public._refund_event(NEW, 'closed_refunded', OLD.status, NEW.status,
                                     CASE WHEN NEW.self_resolved THEN 'self_resolved' END,
                                     NEW.refund_reference IS NOT NULL, NEW.proof_path IS NOT NULL, NULL, v_actor);
      ELSIF OLD.status = 'pending' AND NEW.status = 'not_applicable' THEN
        PERFORM public._refund_event(NEW,
                                     CASE WHEN NEW.resolution_reason = 'reopened' THEN 'closed_by_reopen' ELSE 'closed_not_applicable' END,
                                     OLD.status, NEW.status,
                                     CASE WHEN NEW.resolution_reason = 'reopened' THEN 'reopened'
                                          WHEN NEW.self_resolved THEN 'self_resolved'
                                          ELSE 'admin_text' END,
                                     false, NEW.proof_path IS NOT NULL, NULL, v_actor);
      END IF;
      IF OLD.proof_path IS NULL AND NEW.proof_path IS NOT NULL THEN
        v_object := substring(NEW.proof_path from '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.[a-z]+$')::uuid;
        PERFORM public._refund_event(NEW, 'proof_attached', NEW.status, NEW.status, NULL, false, true, v_object, v_actor);
      END IF;
      IF OLD.proof_purged_at IS NULL AND NEW.proof_purged_at IS NOT NULL THEN
        PERFORM public._refund_event(NEW, 'proof_expired', NEW.status, NEW.status, NULL, false, false, NULL, v_actor);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'refund_requests_audit: event not recorded for refund % (%)', NEW.id, SQLSTATE;
    BEGIN
      INSERT INTO public.activity_logs (action, entity_type, entity_id, performed_by, description, metadata)
      VALUES ('refund_event_failed', 'refund_request', NEW.id, auth.uid()::text,
              'Refund audit event could not be recorded; the refund itself was not affected',
              jsonb_build_object('sqlstate', SQLSTATE, 'operation', TG_OP, 'status', NEW.status));
    EXCEPTION WHEN OTHERS THEN
      NULL; -- logging must not block the operation either
    END;
  END;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.refund_requests_audit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_refund_requests_audit ON public.refund_requests;
CREATE TRIGGER trg_refund_requests_audit
  AFTER INSERT OR UPDATE ON public.refund_requests
  FOR EACH ROW EXECUTE FUNCTION public.refund_requests_audit();

-- ---------------------------------------------------------------------------------------------------------------
-- Policy constant and self-block helper
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refund_proof_required()
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $function$ SELECT true $function$;
REVOKE ALL ON FUNCTION public.refund_proof_required() FROM PUBLIC, anon;

-- At most one self_resolution_blocked event per refund and actor per hour (a loop of attempts must not flood the table).
CREATE OR REPLACE FUNCTION public._refund_event_self_block(p_refund public.refund_requests, p_actor uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.refund_request_events e
                  WHERE e.refund_id = p_refund.id AND e.event_type = 'self_resolution_blocked'
                    AND e.actor_id IS NOT DISTINCT FROM p_actor AND e.occurred_at > now() - interval '1 hour') THEN
    PERFORM public._refund_event(p_refund, 'self_resolution_blocked', p_refund.status, p_refund.status, NULL, false, false, NULL, p_actor);
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public._refund_event_self_block(public.refund_requests, uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Guard: resolved rows are immutable; resolving needs a proof and a resolver who is not the customer
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refund_requests_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_real_reopen boolean;
BEGIN
  IF OLD.status <> 'pending' THEN
    -- operation_type is a STORED generated column: it is not computed yet in a BEFORE trigger, so it is left out of the comparison.
    IF (to_jsonb(NEW) - 'proof_purged_at' - 'operation_type') IS DISTINCT FROM (to_jsonb(OLD) - 'proof_purged_at' - 'operation_type') THEN
      RAISE EXCEPTION 'refund_terminal_row_immutable' USING ERRCODE = '42501';
    END IF;
    IF NEW.proof_purged_at IS DISTINCT FROM OLD.proof_purged_at
       AND NOT (OLD.proof_purged_at IS NULL AND OLD.proof_path IS NOT NULL AND OLD.proof_expires_at <= now()) THEN
      RAISE EXCEPTION 'refund_proof_not_expired' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.proof_purged_at IS NOT NULL THEN
    RAISE EXCEPTION 'refund_proof_not_expired' USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'refunded' AND NEW.proof_path IS NULL AND public.refund_proof_required() THEN
    RAISE EXCEPTION 'refund_proof_required' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IN ('refunded', 'not_applicable') AND NEW.resolved_by IS NOT NULL AND NEW.resolved_by = NEW.user_id
     AND NOT NEW.self_resolved THEN
    v_real_reopen := NEW.resolution_reason = 'reopened'
      AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = NEW.order_id AND o.status = 'cancelled')
      AND NOT EXISTS (SELECT 1 FROM public.remittances r WHERE r.id = NEW.remittance_id AND r.status = 'cancelled');
    IF NOT v_real_reopen THEN
      RAISE EXCEPTION 'refund_self_resolution_not_allowed' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.refund_requests_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_refund_requests_guard ON public.refund_requests;
CREATE TRIGGER trg_refund_requests_guard
  BEFORE UPDATE ON public.refund_requests
  FOR EACH ROW EXECUTE FUNCTION public.refund_requests_guard();

COMMIT;
