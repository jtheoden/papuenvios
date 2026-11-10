-- ============================================================================
-- Commission client acceptance, M1: remittance_commission_proposals.   PREPARED, NOT APPLIED
-- ============================================================================
-- WHY: when an admin RAISES the commission of a remittance the customer must be able to accept it (or cancel) before
--   paying. The proposal lives in its own table so that remittances gets no new column and the admin's internal reason
--   (remittance_commission_overrides, admin-only) is never reachable by the owner (wave 4 ND-5).
-- WHAT: append-mostly table written ONLY by SECURITY DEFINER RPCs (M3) and the status trigger (M2). Readable by the
--   remittance owner and by admins. No reason/message column by design. At most one 'pending' row per remittance.
--   Amounts to deliver are not stored: the UI derives them from the live remittance row.
-- Apply order: M1 (this file) -> M2 -> M3. Rollback order: M3 -> M2 -> M1.
-- ROLLBACK: supabase/rollbacks/20261028100100_commission_proposals_table_down.sql (DROP TABLE; export rows first).
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.remittance_commission_proposals (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  remittance_id       uuid          NOT NULL REFERENCES public.remittances(id) ON DELETE CASCADE,
  override_id         bigint        REFERENCES public.remittance_commission_overrides(id) ON DELETE SET NULL,
  direction           text          NOT NULL CHECK (direction IN ('increase', 'decrease')),
  baseline_commission numeric(10,2) NOT NULL CHECK (baseline_commission >= 0),
  new_commission      numeric(10,2) NOT NULL CHECK (new_commission >= 0),
  status              text          NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'accepted', 'superseded', 'reverted', 'cancelled', 'informed')),
  created_at          timestamptz   NOT NULL DEFAULT now(),
  created_by          uuid,
  responded_at        timestamptz,
  responded_by        uuid
);

CREATE UNIQUE INDEX IF NOT EXISTS remittance_commission_proposals_one_pending_idx
  ON public.remittance_commission_proposals (remittance_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS remittance_commission_proposals_remittance_idx
  ON public.remittance_commission_proposals (remittance_id, created_at DESC);

ALTER TABLE public.remittance_commission_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS remittance_commission_proposals_select_owner ON public.remittance_commission_proposals;
CREATE POLICY remittance_commission_proposals_select_owner ON public.remittance_commission_proposals
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.remittances r
                  WHERE r.id = remittance_id AND r.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS remittance_commission_proposals_select_admin ON public.remittance_commission_proposals;
CREATE POLICY remittance_commission_proposals_select_admin ON public.remittance_commission_proposals
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_user()));

-- Same blocked-user restriction as the other user-owned tables (20261019130000).
DROP POLICY IF EXISTS remittance_commission_proposals_block_disabled_user ON public.remittance_commission_proposals;
CREATE POLICY remittance_commission_proposals_block_disabled_user ON public.remittance_commission_proposals
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT NOT public.current_user_is_blocked()))
  WITH CHECK ((SELECT NOT public.current_user_is_blocked()));

-- Supabase default privileges grant ALL on new public tables to anon / authenticated / service_role: revoke explicitly.
REVOKE ALL ON public.remittance_commission_proposals FROM PUBLIC, anon, authenticated, service_role;
-- Column-level SELECT: created_by, responded_by and override_id (admin identity / link to the private reason row) are
-- NOT readable by authenticated. THE FRONT MUST NOT USE select('*') on this table (it would fail with 42501): list the
-- columns. Admins get the full rows through public.admin_get_commission_proposals (M3).
GRANT SELECT (id, remittance_id, direction, baseline_commission, new_commission, status, created_at, responded_at)
  ON public.remittance_commission_proposals TO authenticated;
GRANT SELECT ON public.remittance_commission_proposals TO service_role;

COMMIT;
