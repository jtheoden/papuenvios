/**
 * Customer acceptance of an admin commission RAISE (plan_commission-client-acceptance.md, M1..M3).
 *
 *   M1 20261028100100_commission_proposals_table.sql     remittance_commission_proposals (+RLS/GRANTs, no reason column)
 *   M2 20261028100200_commission_acceptance_guard.sql    trigger: no payment_proof_uploaded with a pending raise; cancel closes it
 *   M3 20261028100300_commission_acceptance_rpcs.sql     admin_set_remittance_commission (+proposals/alerts), remittance_accept_commission
 *
 * The suite does not list the new objects in `needs`: a missing migration fails loudly (red phase).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dbSuiteSkipReason, connectAdmin, connectAs, connectAnon, endAll, fireTogether } from './db';
import { loadActors } from './fixtures';

const M1 = 'supabase/migrations/20261028100100_commission_proposals_table.sql';
const M2 = 'supabase/migrations/20261028100200_commission_acceptance_guard.sql';
const M3 = 'supabase/migrations/20261028100300_commission_acceptance_rpcs.sql';
const REASON = 'MARKER-internal-reason-7f3a';
const SET = 'SELECT * FROM public.admin_set_remittance_commission($1::uuid, $2::numeric, $3::text)';
const ACCEPT = 'SELECT * FROM public.remittance_accept_commission($1::uuid, $2::uuid)';
const SUBMIT = `SELECT * FROM public.remittance_submit_proof($1::uuid, 'u/proof.png', 'ref-1')`;
const T = 'public.remittance_commission_proposals';
// Column-level SELECT for authenticated (the front must NEVER select('*') here: created_by / responded_by / override_id are service_role only).
const OWNER_COLS = 'id, remittance_id, direction, baseline_commission, new_commission, status, created_at, responded_at';

const skipReason = await dbSuiteSkipReason({
  functions: ['is_admin_user', 'current_user_is_blocked', 'admin_set_remittance_commission', 'remittance_submit_proof'],
  tables: ['remittances', 'remittance_types', 'user_alerts', 'remittance_commission_overrides']
});
const describeDb = skipReason ? describe.skip : describe;

const failure = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the statement to fail, but it succeeded');
};

describeDb('remittance commission client acceptance', () => {
  let admin;
  let actors;
  const clients = [];
  const remittances = [];
  const remittanceTypes = [];

  const as = async (userId) => {
    const c = await connectAs(userId);
    clients.push(c);
    return c;
  };

  const seedType = async () => {
    const { rows } = await admin.query(
      `INSERT INTO public.remittance_types (name, currency_code, delivery_currency, exchange_rate,
                                            commission_percentage, commission_fixed, min_amount, delivery_method)
       VALUES ($1, 'USD', 'CUP', 800, 2.5, 0, 0.01, 'transfer') RETURNING id`,
      [`ca-${randomUUID().slice(0, 8)}`]
    );
    remittanceTypes.push(rows[0].id);
    return rows[0].id;
  };

  /** 100 USD at 800, commission 2.50 => delivers 78000. */
  const seedRemittance = async ({ status = 'payment_pending' } = {}) => {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO public.remittances (id, user_id, remittance_type_id, amount_sent, exchange_rate,
         commission_percentage, commission_fixed, commission_total, amount_to_deliver, currency_sent,
         currency_delivered, recipient_name, recipient_phone, status)
       VALUES ($1,$2,$3,100,800,2.5,0,2.5,78000,'USD','CUP','Rcpt','+5355550100',$4)`,
      [id, actors.customerId, await seedType(), status]
    );
    remittances.push(id);
    return id;
  };

  const proposals = async (rid) =>
    (await admin.query(`SELECT * FROM ${T} WHERE remittance_id = $1 ORDER BY created_at, id`, [rid])).rows;
  const pending = async (rid) => (await proposals(rid)).filter((p) => p.status === 'pending');
  const alerts = async (rid) =>
    (await admin.query(
      `SELECT * FROM public.user_alerts WHERE metadata->>'remittanceId' = $1 ORDER BY created_at, id`, [rid])).rows;
  const status = async (rid) =>
    (await admin.query('SELECT status FROM public.remittances WHERE id = $1', [rid])).rows[0].status;

  /** Admin raises/lowers through the real RPC. */
  const adminSet = async (rid, value) => {
    const c = await as(actors.adminId);
    return (await c.query(SET, [rid, value, REASON])).rows[0];
  };

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
  });

  // Always restores the actors (tests demote the admin / disable the customer), even when a test or the cleanup fails.
  const restoreActors = async () => {
    await admin.query(`UPDATE public.user_profiles SET role = 'admin', is_enabled = true WHERE id = $1`, [actors.adminId]);
    await admin.query(`UPDATE public.user_profiles SET is_enabled = true WHERE id = $1`, [actors.customerId]);
  };

  afterEach(async () => {
    try {
      await endAll(clients.splice(0));
    } finally {
      await restoreActors();
    }
    if (remittances.length) {
      await admin.query(`DELETE FROM public.user_alerts WHERE metadata->>'remittanceId' = ANY($1::text[])`, [remittances]);
      await admin.query('DELETE FROM public.remittances WHERE id = ANY($1)', [remittances.splice(0)]); // cascades
    }
    if (remittanceTypes.length) await admin.query('DELETE FROM public.remittance_types WHERE id = ANY($1)', [remittanceTypes.splice(0)]);
  });

  afterAll(async () => {
    try {
      await restoreActors();
    } finally {
      await admin.end();
    }
  });

  describe('migration hygiene', () => {
    it.each([M1, M2, M3])('%s: header with rollback, transaction, lock_timeout', (file) => {
      const sql = readFileSync(file, 'utf8');
      expect(sql.split('\n').slice(0, 40).join('\n')).toMatch(/ROLLBACK/);
      expect(sql).toMatch(/^BEGIN;/m);
      expect(sql).toMatch(/SET LOCAL lock_timeout/);
      expect(sql).toMatch(/^COMMIT;/m);
    });

    it('SECURITY DEFINER functions pin the search_path; rollbacks exist', () => {
      for (const file of [M2, M3]) expect(readFileSync(file, 'utf8')).toMatch(/SET search_path = public, pg_temp/);
      for (const name of ['commission_proposals_table', 'commission_acceptance_guard', 'commission_acceptance_rpcs']) {
        const stamp = { commission_proposals_table: '100100', commission_acceptance_guard: '100200', commission_acceptance_rpcs: '100300' }[name];
        expect(() => readFileSync(`supabase/rollbacks/20261028${stamp}_${name}_down.sql`, 'utf8')).not.toThrow();
      }
    });

    it('rollbacks document the order M3 -> M2 -> M1; migrations document M1 first; M3/M2 downs clean pending data', () => {
      const down = (n) => readFileSync(`supabase/rollbacks/${n}_down.sql`, 'utf8');
      const d3 = down('20261028100300_commission_acceptance_rpcs');
      const d2 = down('20261028100200_commission_acceptance_guard');
      const d1 = down('20261028100100_commission_proposals_table');
      for (const d of [d1, d2, d3]) expect(d.split('\n').slice(0, 12).join('\n')).toMatch(/M3 -> M2 -> M1/);
      expect(d3).toMatch(/status = 'reverted'/);
      expect(d3).toMatch(/commission_change_pending/);
      expect(d2).toMatch(/commission_change_pending/);
      for (const m of [M2, M3]) expect(readFileSync(m, 'utf8').split('\n').slice(0, 30).join('\n')).toMatch(/Apply order: M1/);
      expect(readFileSync(M1, 'utf8')).toMatch(/select\('\*'\)/);
    });

    it('M3 keeps the whole M0 body (freeze gate, validations, history) and does not touch _remittance_transition', () => {
      const sql = readFileSync(M3, 'utf8');
      expect(sql).toMatch(/NOT IN \('payment_pending', 'payment_rejected'\)/);
      expect(sql).toMatch(/invalid_reason/);
      expect(sql).toMatch(/INSERT INTO public\.remittance_commission_overrides/);
      expect(sql).not.toMatch(/FUNCTION public\._remittance_transition/);
    });
  });

  describe('M1: table, RLS and grants', () => {
    it('has no reason / message column and only one pending per remittance', async () => {
      const cols = (await admin.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='remittance_commission_proposals'`
      )).rows.map((r) => r.column_name);
      expect(cols).toEqual(expect.arrayContaining(['id', 'remittance_id', 'override_id', 'direction', 'baseline_commission', 'new_commission', 'status']));
      expect(cols.filter((c) => /reason|message|note/.test(c))).toEqual([]);
      const rid = await seedRemittance();
      const ins = `INSERT INTO ${T} (remittance_id, direction, baseline_commission, new_commission, status, created_by)
                   VALUES ($1,'increase',2.5,6,'pending',$2)`;
      await admin.query(ins, [rid, actors.adminId]);
      expect((await failure(admin.query(ins, [rid, actors.adminId]))).code).toBe('23505');
    });

    it('the owner reads only own proposals, the admin reads all, nobody writes directly, anon reads nothing', async () => {
      const rid = await seedRemittance();
      await adminSet(rid, 6);
      const owner = await as(actors.customerId);
      expect((await owner.query(`SELECT id FROM ${T}`)).rows.length).toBeGreaterThanOrEqual(1);
      const adm = await as(actors.adminId);
      expect((await adm.query(`SELECT id FROM ${T} WHERE remittance_id = $1`, [rid])).rows).toHaveLength(1);
      // another end user sees nothing: the disabled-owner path is covered below, here reuse the admin as a non-owner customer
      await admin.query(`UPDATE public.user_profiles SET role = 'user' WHERE id = $1`, [actors.adminId]); // restored by afterEach
      const stranger = await as(actors.adminId);
      expect((await stranger.query(`SELECT id FROM ${T} WHERE remittance_id = $1`, [rid])).rows).toHaveLength(0);

      for (const sql of [
        `INSERT INTO ${T} (remittance_id, direction, baseline_commission, new_commission, status) VALUES ('${rid}','increase',1,2,'pending')`,
        `UPDATE ${T} SET status = 'accepted'`,
        `DELETE FROM ${T}`
      ]) {
        expect((await failure(owner.query(sql))).code).toBe('42501');
        expect((await failure(adm.query(sql))).code).toBe('42501');
      }
      const anon = await connectAnon();
      clients.push(anon);
      expect((await failure(anon.query(`SELECT id FROM ${T}`))).code).toBe('42501');
    });

    it('authenticated can SELECT only the customer-facing columns; created_by / responded_by / override_id / * are 42501', async () => {
      const rid = await seedRemittance();
      await adminSet(rid, 6);
      for (const who of [actors.customerId, actors.adminId]) {
        const c = await as(who);
        expect((await c.query(`SELECT ${OWNER_COLS} FROM ${T} WHERE remittance_id = $1`, [rid])).rows).toHaveLength(1);
        for (const col of ['created_by', 'responded_by', 'override_id', '*']) {
          expect((await failure(c.query(`SELECT ${col} FROM ${T} WHERE remittance_id = $1`, [rid]))).code).toBe('42501');
        }
      }
    });

    it('admin_get_commission_proposals returns the full rows (incl. created_by) to admins only', async () => {
      const rid = await seedRemittance();
      await adminSet(rid, 6);
      const adm = await as(actors.adminId);
      const { rows } = await adm.query('SELECT * FROM public.admin_get_commission_proposals($1::uuid)', [rid]);
      expect(rows).toHaveLength(1);
      expect(rows[0].created_by).toBe(actors.adminId);
      expect(rows[0].override_id).not.toBeNull();
      const owner = await as(actors.customerId);
      expect((await failure(owner.query('SELECT * FROM public.admin_get_commission_proposals($1::uuid)', [rid]))).code).toBe('42501');
      const anon = await connectAnon();
      clients.push(anon);
      expect((await failure(anon.query('SELECT * FROM public.admin_get_commission_proposals($1::uuid)', [rid]))).code).toBe('42501');
    });

    it('deleting the remittance (platform reset path) removes its proposals', async () => {
      const rid = await seedRemittance();
      await adminSet(rid, 6);
      await admin.query('DELETE FROM public.user_alerts WHERE metadata->>\'remittanceId\' = $1', [rid]);
      await admin.query('DELETE FROM public.remittances WHERE id = $1', [rid]);
      expect(await proposals(rid)).toEqual([]);
    });
  });

  describe('admin_set_remittance_commission creates / closes proposals', () => {
    it('a raise on payment_pending creates a pending proposal over the standard base and an alert', async () => {
      const rid = await seedRemittance();
      const row = await adminSet(rid, 6);
      expect(Number(row.commission_total)).toBe(6); // contract: still returns the remittances row
      expect(Number(row.amount_to_deliver)).toBe(75200);
      const [p] = await proposals(rid);
      expect(p).toMatchObject({ direction: 'increase', status: 'pending', created_by: actors.adminId });
      expect(Number(p.baseline_commission)).toBe(2.5);
      expect(Number(p.new_commission)).toBe(6);
      expect(p.override_id).not.toBeNull();
      const [alert] = await alerts(rid);
      expect(alert).toMatchObject({ user_id: actors.customerId, alert_type: 'commission_change_pending', action_required: true, is_dismissed: false });
      expect(alert.metadata).toMatchObject({ remittanceId: rid, proposalId: p.id });
    });

    it('alert texts address the customer as "usted" (no informal tuteo) and never carry the reason', async () => {
      const rid = await seedRemittance();
      await adminSet(rid, 6);
      await adminSet(rid, 1);
      await adminSet(rid, 3);
      await adminSet(rid, 1);
      const texts = (await alerts(rid)).map((a) => `${a.title} ${a.message}`).join(' ');
      expect(texts.length).toBeGreaterThan(0);
      expect(texts).not.toMatch(/\b(tu|tus|tú|tienes|pagas|acepta|puedes)\b/i);
      expect(texts).toMatch(/usted|su remesa/i);
      expect(texts).not.toContain('MARKER');
    });

    it('a raise on payment_rejected also creates a pending proposal', async () => {
      const rid = await seedRemittance({ status: 'payment_rejected' });
      await adminSet(rid, 4);
      expect((await pending(rid))).toHaveLength(1);
    });

    it('a decrease only informs: informed row, info alert, nothing blocks the payment', async () => {
      const rid = await seedRemittance();
      await adminSet(rid, 1);
      const [p] = await proposals(rid);
      expect(p).toMatchObject({ direction: 'decrease', status: 'informed' });
      expect(Number(p.baseline_commission)).toBe(2.5);
      expect(Number(p.new_commission)).toBe(1);
      expect((await alerts(rid))[0]).toMatchObject({ alert_type: 'commission_lowered', action_required: false });
      const owner = await as(actors.customerId);
      expect((await owner.query(SUBMIT, [rid])).rows[0].status).toBe('payment_proof_uploaded');
    });

    it('setting the commission to the same value creates nothing', async () => {
      const rid = await seedRemittance();
      await adminSet(rid, 2.5);
      expect(await proposals(rid)).toEqual([]);
      expect(await alerts(rid)).toEqual([]);
    });

    it('a second raise supersedes the first and keeps the SAME base; one pending, one live alert', async () => {
      const rid = await seedRemittance();
      await adminSet(rid, 6);
      await adminSet(rid, 8);
      const rows = await proposals(rid);
      expect(rows.map((p) => p.status)).toEqual(['superseded', 'pending']);
      expect(Number(rows[1].baseline_commission)).toBe(2.5);
      expect(Number(rows[1].new_commission)).toBe(8);
      const live = (await alerts(rid)).filter((a) => !a.is_dismissed && a.alert_type === 'commission_change_pending');
      expect(live).toHaveLength(1);
      expect(live[0].metadata.proposalId).toBe(rows[1].id);
    });

    it('re-adjusting a pending raise back to the base closes it as reverted, no new row, alert dismissed + info', async () => {
      const rid = await seedRemittance();
      await adminSet(rid, 6);
      await adminSet(rid, 2.5);
      const rows = await proposals(rid);
      expect(rows.map((p) => p.status)).toEqual(['reverted']);
      expect((await alerts(rid)).filter((a) => !a.is_dismissed).map((a) => a.alert_type)).toEqual(['commission_change_reverted']);
      const owner = await as(actors.customerId);
      expect((await owner.query(SUBMIT, [rid])).rows[0].status).toBe('payment_proof_uploaded');
    });

    it('re-adjusting a pending raise BELOW the base reverts it and informs the decrease against that base', async () => {
      const rid = await seedRemittance();
      await adminSet(rid, 6);
      await adminSet(rid, 1);
      const rows = await proposals(rid);
      expect(rows.map((p) => p.status)).toEqual(['reverted', 'informed']);
      expect(Number(rows[1].baseline_commission)).toBe(2.5);
    });

    it('consecutive adjustments compare against the last commission seen/accepted', async () => {
      const rid = await seedRemittance();
      await adminSet(rid, 6);
      const [first] = await pending(rid);
      const owner = await as(actors.customerId);
      await owner.query(ACCEPT, [rid, first.id]);
      await adminSet(rid, 8); // base is now the ACCEPTED 6, not the standard 2.5
      const second = (await pending(rid))[0];
      expect(Number(second.baseline_commission)).toBe(6);
      await adminSet(rid, 5); // below the accepted base 6: reverts + informs
      await adminSet(rid, 7); // base is the informed 5
      const third = (await pending(rid))[0];
      expect(Number(third.baseline_commission)).toBe(5);
    });

    it('the freeze gate still holds: proof_uploaded is refused and creates no proposal', async () => {
      const rid = await seedRemittance({ status: 'payment_proof_uploaded' });
      const c = await as(actors.adminId);
      expect((await failure(c.query(SET, [rid, 6, REASON]))).code).toBe('22023');
      expect(await proposals(rid)).toEqual([]);
    });

    it('a non-admin cannot call it and creates nothing', async () => {
      const rid = await seedRemittance();
      const c = await as(actors.customerId);
      expect((await failure(c.query(SET, [rid, 6, REASON]))).code).toBe('42501');
      expect(await proposals(rid)).toEqual([]);
    });
  });

  describe('M2: guard on status', () => {
    it('submit_proof is refused with a pending raise (22023 commission_pending_acceptance) and nothing changes', async () => {
      const rid = await seedRemittance();
      await adminSet(rid, 6);
      const owner = await as(actors.customerId);
      const err = await failure(owner.query(SUBMIT, [rid]));
      expect(err.code).toBe('22023');
      expect(err.message).toMatch(/commission_pending_acceptance/);
      expect(await status(rid)).toBe('payment_pending');
      expect((await pending(rid))).toHaveLength(1);
    });

    it('also blocks a direct status update to payment_proof_uploaded, whatever the role', async () => {
      const rid = await seedRemittance();
      await adminSet(rid, 6);
      const err = await failure(admin.query(`UPDATE public.remittances SET status = 'payment_proof_uploaded' WHERE id = $1`, [rid]));
      expect(err.message).toMatch(/commission_pending_acceptance/);
    });

    it('cancelling closes the pending proposal as cancelled and dismisses its alert', async () => {
      const rid = await seedRemittance();
      await adminSet(rid, 6);
      const owner = await as(actors.customerId);
      expect((await owner.query('SELECT * FROM public.remittance_cancel($1::uuid, $2::text)', [rid, 'commission_declined'])).rows[0].status).toBe('cancelled');
      expect((await proposals(rid)).map((p) => p.status)).toEqual(['cancelled']);
      expect((await alerts(rid)).every((a) => a.is_dismissed)).toBe(true);
    });

    it('cancelling leaves an informed proposal untouched', async () => {
      const rid = await seedRemittance();
      await adminSet(rid, 1);
      const owner = await as(actors.customerId);
      await owner.query('SELECT * FROM public.remittance_cancel($1::uuid, NULL)', [rid]);
      expect((await proposals(rid)).map((p) => p.status)).toEqual(['informed']);
    });
  });

  describe('remittance_accept_commission', () => {
    it('the owner accepts the current proposal: accepted, responded_*, alert dismissed, then the proof can be uploaded', async () => {
      const rid = await seedRemittance();
      await adminSet(rid, 6);
      const [p] = await pending(rid);
      const owner = await as(actors.customerId);
      const { rows } = await owner.query(ACCEPT, [rid, p.id]);
      expect(rows[0]).toMatchObject({ id: p.id, status: 'accepted' });
      expect((await proposals(rid))[0].responded_by).toBe(actors.customerId); // stored, just not returned to the owner
      expect(rows[0].responded_at).not.toBeNull();
      expect([rows[0].created_by, rows[0].override_id, rows[0].responded_by]).toEqual([null, null, null]); // admin-side columns are not returned to the owner
      const live = (await alerts(rid)).filter((a) => !a.is_dismissed);
      expect(live).toEqual([]);
      expect(Number((await admin.query('SELECT commission_total FROM public.remittances WHERE id = $1', [rid])).rows[0].commission_total)).toBe(6);
      expect((await owner.query(SUBMIT, [rid])).rows[0].status).toBe('payment_proof_uploaded');
    });

    it('payment_rejected full flow: submit blocked, accept, submit OK', async () => {
      const rid = await seedRemittance({ status: 'payment_rejected' });
      await adminSet(rid, 6);
      const [p] = await pending(rid);
      const owner = await as(actors.customerId);
      expect((await failure(owner.query(SUBMIT, [rid]))).message).toMatch(/commission_pending_acceptance/);
      expect((await owner.query(ACCEPT, [rid, p.id])).rows[0].status).toBe('accepted');
      expect((await owner.query(SUBMIT, [rid])).rows[0].status).toBe('payment_proof_uploaded');
    });

    it('accepting after the remittance was cancelled fails (invalid_transition) and the proposal stays cancelled', async () => {
      const rid = await seedRemittance();
      await adminSet(rid, 6);
      const [p] = await pending(rid);
      const owner = await as(actors.customerId);
      await owner.query('SELECT * FROM public.remittance_cancel($1::uuid, NULL)', [rid]);
      const err = await failure(owner.query(ACCEPT, [rid, p.id]));
      expect(err.code).toBe('22023');
      expect(err.message).toMatch(/invalid_transition/);
      expect((await proposals(rid)).map((x) => x.status)).toEqual(['cancelled']);
    });

    it('several consecutive re-adjustments leave one live pending and one live pending alert', async () => {
      const rid = await seedRemittance();
      for (const v of [6, 7, 8, 9]) await adminSet(rid, v);
      expect((await proposals(rid)).map((x) => x.status)).toEqual(['superseded', 'superseded', 'superseded', 'pending']);
      const live = (await alerts(rid)).filter((a) => !a.is_dismissed && a.action_required);
      expect(live).toHaveLength(1);
      expect(live[0].metadata.proposalId).toBe((await pending(rid))[0].id);
    });

    it('accepting the same proposal twice is idempotent', async () => {
      const rid = await seedRemittance();
      await adminSet(rid, 6);
      const [p] = await pending(rid);
      const owner = await as(actors.customerId);
      await owner.query(ACCEPT, [rid, p.id]);
      expect((await owner.query(ACCEPT, [rid, p.id])).rows[0].status).toBe('accepted');
    });

    it('a replaced proposal id fails with proposal_not_open (DETAIL = superseded); the new one works', async () => {
      const rid = await seedRemittance();
      await adminSet(rid, 6);
      const [old] = await pending(rid);
      await adminSet(rid, 8);
      const [current] = await pending(rid);
      const owner = await as(actors.customerId);
      const err = await failure(owner.query(ACCEPT, [rid, old.id]));
      expect(err.code).toBe('22023');
      expect(err.message).toMatch(/proposal_not_open/);
      expect(err.detail).toBe('superseded');
      expect((await owner.query(ACCEPT, [rid, current.id])).rows[0].status).toBe('accepted');
    });

    it('a reverted / informed / cancelled proposal is not open', async () => {
      const rid = await seedRemittance();
      await adminSet(rid, 6);
      const [p] = await pending(rid);
      await adminSet(rid, 2.5);
      const owner = await as(actors.customerId);
      expect((await failure(owner.query(ACCEPT, [rid, p.id]))).detail).toBe('reverted');
      await adminSet(rid, 1);
      const informed = (await proposals(rid)).find((x) => x.status === 'informed');
      expect((await failure(owner.query(ACCEPT, [rid, informed.id]))).detail).toBe('informed');
    });

    it('unknown proposal id (or one of another remittance) => P0002', async () => {
      const rid = await seedRemittance();
      const other = await seedRemittance();
      await adminSet(other, 6);
      const [foreign] = await pending(other);
      const owner = await as(actors.customerId);
      expect((await failure(owner.query(ACCEPT, [rid, randomUUID()]))).code).toBe('P0002');
      expect((await failure(owner.query(ACCEPT, [rid, foreign.id]))).code).toBe('P0002');
    });

    it('only the owner: admin, disabled owner, anon and unknown remittance all get 42501', async () => {
      const rid = await seedRemittance();
      await adminSet(rid, 6);
      const [p] = await pending(rid);
      const adm = await as(actors.adminId);
      expect((await failure(adm.query(ACCEPT, [rid, p.id]))).code).toBe('42501');
      const anon = await connectAnon();
      clients.push(anon);
      expect((await failure(anon.query(ACCEPT, [rid, p.id]))).code).toBe('42501');
      const owner = await as(actors.customerId);
      expect((await failure(owner.query(ACCEPT, [randomUUID(), p.id]))).code).toBe('42501');
      await admin.query(`UPDATE public.user_profiles SET is_enabled = false WHERE id = $1`, [actors.customerId]);
      const disabled = await as(actors.customerId);
      expect((await failure(disabled.query(ACCEPT, [rid, p.id]))).code).toBe('42501');
      expect((await pending(rid))).toHaveLength(1);
    });

    it('outside payment_pending / payment_rejected => 22023 invalid_transition', async () => {
      const rid = await seedRemittance();
      await adminSet(rid, 6);
      const [p] = await pending(rid);
      const owner = await as(actors.customerId);
      await owner.query(ACCEPT, [rid, p.id]);
      await owner.query(SUBMIT, [rid]);
      const err = await failure(owner.query(ACCEPT, [rid, p.id]));
      expect(err.code).toBe('22023');
      expect(err.message).toMatch(/invalid_transition/);
    });

    it('a proposal that no longer matches the live commission is proposal_stale', async () => {
      const rid = await seedRemittance();
      await adminSet(rid, 6);
      const [p] = await pending(rid);
      await admin.query('UPDATE public.remittances SET commission_total = 7 WHERE id = $1', [rid]);
      const owner = await as(actors.customerId);
      const err = await failure(owner.query(ACCEPT, [rid, p.id]));
      expect(err.code).toBe('22023');
      expect(err.message).toMatch(/proposal_stale/);
      expect((await pending(rid))).toHaveLength(1);
    });
  });

  describe('ND-5: the admin reason never reaches the customer', () => {
    it('proposals, alerts and the accept result readable by the owner do not contain the reason', async () => {
      const rid = await seedRemittance();
      await adminSet(rid, 6);
      const owner = await as(actors.customerId);
      const seen = [
        (await owner.query(`SELECT ${OWNER_COLS} FROM ${T} WHERE remittance_id = $1`, [rid])).rows,
        (await owner.query(`SELECT * FROM public.user_alerts WHERE metadata->>'remittanceId' = $1`, [rid])).rows,
        (await owner.query('SELECT * FROM public.remittances WHERE id = $1', [rid])).rows
      ];
      const [p] = await pending(rid);
      seen.push((await owner.query(ACCEPT, [rid, p.id])).rows);
      expect(JSON.stringify(seen)).not.toContain('MARKER');
      expect((await owner.query('SELECT * FROM public.remittance_commission_overrides')).rows).toEqual([]); // RLS: admin only
    });
  });

  describe('concurrency (real connections, FOR UPDATE on the remittance)', () => {
    it('accept vs admin re-adjust: either the acceptance wins and the new raise is pending over the accepted base, or the old proposal is superseded', async () => {
      for (let i = 0; i < 4; i += 1) {
        const rid = await seedRemittance();
        await adminSet(rid, 6);
        const [a] = await pending(rid);
        const owner = await as(actors.customerId);
        const adm = await as(actors.adminId);
        const [acc, set] = await fireTogether([
          { client: owner, sql: 'public.remittance_accept_commission($1::uuid, $2::uuid)', params: [rid, a.id] },
          { client: adm, sql: 'public.admin_set_remittance_commission($1::uuid, $2::numeric, $3::text)', params: [rid, 8, REASON] }
        ]);
        expect(set.error).toBeUndefined();
        const rows = await proposals(rid);
        expect(rows.filter((p) => p.status === 'pending')).toHaveLength(1);
        const live = rows.find((p) => p.status === 'pending');
        expect(Number(live.new_commission)).toBe(8);
        if (acc.error) {
          expect(acc.error.message).toMatch(/proposal_not_open|proposal_stale/);
          expect(rows.find((p) => p.id === a.id).status).toBe('superseded');
          expect(Number(live.baseline_commission)).toBe(2.5);
        } else {
          expect(rows.find((p) => p.id === a.id).status).toBe('accepted');
          expect(Number(live.baseline_commission)).toBe(6);
        }
      }
    });

    it('submit_proof vs admin raise: never payment_proof_uploaded together with a pending raise', async () => {
      for (let i = 0; i < 4; i += 1) {
        const rid = await seedRemittance();
        const owner = await as(actors.customerId);
        const adm = await as(actors.adminId);
        const [sub, set] = await fireTogether([
          { client: owner, sql: `public.remittance_submit_proof($1::uuid, 'u/p.png', 'ref')`, params: [rid] },
          { client: adm, sql: 'public.admin_set_remittance_commission($1::uuid, $2::numeric, $3::text)', params: [rid, 6, REASON] }
        ]);
        const st = await status(rid);
        const open = await pending(rid);
        expect(st === 'payment_proof_uploaded' && open.length > 0).toBe(false);
        if (st === 'payment_proof_uploaded') {
          expect(set.error?.message).toMatch(/invalid_status/);
          expect(sub.error).toBeUndefined();
        } else {
          expect(sub.error?.message).toMatch(/commission_pending_acceptance/);
          expect(open).toHaveLength(1);
        }
      }
    });

    it('cancel vs accept: the proposal ends accepted or cancelled, never pending on a cancelled remittance', async () => {
      for (let i = 0; i < 4; i += 1) {
        const rid = await seedRemittance();
        await adminSet(rid, 6);
        const [a] = await pending(rid);
        const owner = await as(actors.customerId);
        const owner2 = await as(actors.customerId);
        await fireTogether([
          { client: owner, sql: 'public.remittance_accept_commission($1::uuid, $2::uuid)', params: [rid, a.id] },
          { client: owner2, sql: `public.remittance_cancel($1::uuid, 'commission_declined')`, params: [rid] }
        ]);
        expect(await pending(rid)).toEqual([]);
        if ((await status(rid)) === 'cancelled') expect(['cancelled', 'accepted']).toContain((await proposals(rid))[0].status);
      }
    });

    it('two admins raising at once leave exactly one pending proposal', async () => {
      const rid = await seedRemittance();
      const a1 = await as(actors.adminId);
      const a2 = await as(actors.adminId);
      const res = await fireTogether([
        { client: a1, sql: 'public.admin_set_remittance_commission($1::uuid, $2::numeric, $3::text)', params: [rid, 6, REASON] },
        { client: a2, sql: 'public.admin_set_remittance_commission($1::uuid, $2::numeric, $3::text)', params: [rid, 7, REASON] }
      ]);
      expect(res.every((r) => !r.error)).toBe(true);
      expect((await proposals(rid)).map((p) => p.status).sort()).toEqual(['pending', 'superseded']);
      expect((await alerts(rid)).filter((a) => !a.is_dismissed)).toHaveLength(1);
    });
  });
});
