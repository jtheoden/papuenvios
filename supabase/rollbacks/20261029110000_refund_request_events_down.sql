-- ROLLBACK of 20261029110000_refund_request_events.sql. DESTRUCTIVE for the audit history: drops refund_request_events.
-- Export first:  \copy (SELECT * FROM public.refund_request_events) TO 'refund_request_events_backup.csv' CSV HEADER
-- Roll back 20261029110500..110100 first (they depend on the events and on the proof columns).
-- Dropping the triggers is also the emergency switch: refund_requests and the cancellations keep working without them.
-- Orders, remittances and their histories are never touched. The proof columns are dropped only when every proof is empty.
BEGIN;

SET LOCAL lock_timeout = '5s';

-- The history is evidence: refuse to drop it silently. Export it, then confirm in the same session:
--   SET app.confirm_refund_rollback = 'yes';
DO $$
BEGIN
  IF to_regclass('public.refund_request_events') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.refund_request_events)
     AND COALESCE(current_setting('app.confirm_refund_rollback', true), '') <> 'yes' THEN
    RAISE EXCEPTION 'refund_request_events has rows: export them and SET app.confirm_refund_rollback = ''yes'' to confirm this rollback';
  END IF;
END
$$;

DROP TRIGGER IF EXISTS trg_refund_requests_guard ON public.refund_requests;
DROP TRIGGER IF EXISTS trg_refund_requests_audit ON public.refund_requests;
DROP FUNCTION IF EXISTS public.refund_requests_guard();
DROP FUNCTION IF EXISTS public.refund_requests_audit();
DROP FUNCTION IF EXISTS public._refund_event_self_block(public.refund_requests, uuid);
DROP FUNCTION IF EXISTS public.refund_proof_required();
DROP FUNCTION IF EXISTS public._refund_event(public.refund_requests, text, text, text, text, boolean, boolean, uuid, uuid);

DROP TABLE IF EXISTS public.refund_request_events;
DROP FUNCTION IF EXISTS public.refund_request_events_block_mutation();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.refund_requests WHERE proof_path IS NOT NULL OR self_resolved) THEN
    RAISE NOTICE 'refund_requests proof/self_resolved columns kept: rows already use them (export before dropping)';
  ELSE
    ALTER TABLE public.refund_requests DROP CONSTRAINT IF EXISTS refund_requests_proof_path_format;
    ALTER TABLE public.refund_requests DROP CONSTRAINT IF EXISTS refund_requests_proof_sha256_format;
    ALTER TABLE public.refund_requests
      DROP COLUMN IF EXISTS proof_path, DROP COLUMN IF EXISTS proof_sha256, DROP COLUMN IF EXISTS proof_expires_at,
      DROP COLUMN IF EXISTS proof_purged_at, DROP COLUMN IF EXISTS self_resolved;
  END IF;
END
$$;

COMMIT;
