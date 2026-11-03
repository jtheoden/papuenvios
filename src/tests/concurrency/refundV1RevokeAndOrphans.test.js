/**
 * RB-02: refund R5 leftovers.
 * Migrations under test:
 *   20261103140000_revoke_admin_resolve_refund_v1.sql   v1 admin_resolve_refund loses EXECUTE for API roles (v2 is the only entry)
 *   20261103140100_admin_refund_proof_orphans.sql       read-only report of refund-proofs objects nobody references (super_admin)
 * Plus the DB contract of the purge flow (supabase/functions/purge-refund-proofs) run as service_role on synthetic refunds.
 * The suite does not list the new objects in `needs`: a missing migration fails loudly (red phase). Local scratch Postgres only.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dbSuiteSkipReason, connectAdmin, connectAs, connectAnon, endAll } from './db';
import { loadActors, createTracker, seedOrder, cleanup } from './fixtures';

const REVOKE_UP = 'supabase/migrations/20261103140000_revoke_admin_resolve_refund_v1.sql';
const REVOKE_DOWN = 'supabase/rollbacks/20261103140000_revoke_admin_resolve_refund_v1_down.sql';
const ORPHANS_UP = 'supabase/migrations/20261103140100_admin_refund_proof_orphans.sql';
const ORPHANS_DOWN = 'supabase/rollbacks/20261103140100_admin_refund_proof_orphans_down.sql';

const read = (p) => readFileSync(p, 'utf8');
const code = (p) => read(p).replace(/^\s*--.*$/gm, '');

describe('RB-02 migrations (static)', () => {
  it('the revoke migration only revokes v1 by its exact signature, with a lock_timeout and a transaction', () => {
    const sql = code(REVOKE_UP);
    expect(sql).toMatch(/BEGIN;/);
    expect(sql).toMatch(/SET LOCAL lock_timeout/);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.admin_resolve_refund\(uuid, text, text, timestamptz, text\)\s+FROM PUBLIC, anon, authenticated;/);
    expect(sql).toMatch(/COMMIT;/);
    expect(sql).not.toMatch(/\b(DROP|DELETE|TRUNCATE|UPDATE|INSERT|ALTER|CREATE)\b/i);
    expect(read(REVOKE_UP)).toMatch(/WHY[\s\S]*WHAT[\s\S]*ROLLBACK[\s\S]*DATA/);
  });

  it('the revoke rollback re-grants v1 to authenticated exactly as it was', () => {
    expect(code(REVOKE_DOWN)).toMatch(/GRANT EXECUTE ON FUNCTION public\.admin_resolve_refund\(uuid, text, text, timestamptz, text\)\s+TO authenticated;/);
  });

  it('the orphans migration creates one function, never writes, and its rollback drops it', () => {
    const sql = code(ORPHANS_UP);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.admin_refund_proof_orphans\(\)/);
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/SET search_path = public, pg_temp/);
    expect(sql).toMatch(/is_super_admin\(\)/);
    expect(sql).toMatch(/ERRCODE = '42501'/);
    expect(sql).not.toMatch(/\b(DELETE|TRUNCATE|UPDATE|INSERT|DROP|ALTER)\b/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.admin_refund_proof_orphans\(\) FROM PUBLIC, anon;/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.admin_refund_proof_orphans\(\) TO authenticated;/);
    expect(code(ORPHANS_DOWN)).toMatch(/DROP FUNCTION IF EXISTS public\.admin_refund_proof_orphans\(\);/);
  });
});

const skipReason = await dbSuiteSkipReason({
  functions: ['is_admin_user', 'is_super_admin', 'order_cancel', 'admin_resolve_refund', 'admin_resolve_refund_v2', '_refund_proofs_due'],
  tables: ['orders', 'user_profiles', 'refund_requests']
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

describeDb('RB-02 (local Postgres)', () => {
  let admin;
  let actors;
  const clients = [];
  const tracker = createTracker();
  const objects = [];
  const otherObjects = [];

  const as = async (userId, role) => {
    const c = await connectAs(userId, role);
    clients.push(c);
    return c;
  };
  const setRole = (id, role) => admin.query('UPDATE public.user_profiles SET role = $2 WHERE id = $1', [id, role]);
  const json = async (client, fn, args = []) => {
    const ph = args.map((_, i) => `$${i + 1}`).join(', ');
    return (await client.query(`SELECT public.${fn}(${ph}) AS r`, args)).rows[0].r;
  };
  const refundById = async (id) => (await admin.query('SELECT * FROM public.refund_requests WHERE id = $1', [id])).rows[0];
  const addObject = async (refundId, ext = 'png') => {
    const name = `refunds/${refundId}/${randomUUID()}.${ext}`;
    await admin.query(`INSERT INTO storage.objects (bucket_id, name) VALUES ('refund-proofs', $1)`, [name]);
    objects.push(name);
    return name;
  };
  const paidOrder = async () => {
    const id = await seedOrder(admin, actors, tracker, [], {
      userId: actors.customerId,
      status: 'pending',
      paymentStatus: 'proof_uploaded',
      stockManaged: false
    });
    const c = await as(actors.customerId);
    await c.query('SELECT * FROM public.order_cancel($1, $2)', [id, 'changed my mind']);
    return (await admin.query('SELECT * FROM public.refund_requests WHERE order_id = $1', [id])).rows[0];
  };
  const openHold = (id) =>
    admin.query(
      `UPDATE public.refund_requests SET cancelled_at = now() - interval '60 hours', eligible_at = now() - interval '12 hours',
              due_at = now() + interval '100 hours' WHERE id = $1`,
      [id]
    );
  const resolveV2 = (client, id, proofPath) =>
    json(client, 'admin_resolve_refund_v2', [id, 'refunded', 'ZEL-1', null, null, proofPath, 'a'.repeat(64), false]);
  const refundedWithProof = async () => {
    const refund = await paidOrder();
    await openHold(refund.id);
    const proof = await addObject(refund.id);
    const res = await resolveV2(await as(actors.adminId), refund.id, proof);
    expect(res.ok).toBe(true);
    return { id: refund.id, proof };
  };
  const withGuardOff = async (fn) => {
    await admin.query('ALTER TABLE public.refund_requests DISABLE TRIGGER trg_refund_requests_guard');
    try {
      return await fn();
    } finally {
      await admin.query('ALTER TABLE public.refund_requests ENABLE TRIGGER trg_refund_requests_guard');
    }
  };
  const expireAt = (id, sqlExpr) =>
    withGuardOff(() => admin.query(`UPDATE public.refund_requests SET proof_expires_at = ${sqlExpr} WHERE id = $1`, [id]));
  const bucketNames = async () =>
    (await admin.query(`SELECT name FROM storage.objects WHERE bucket_id = 'refund-proofs' ORDER BY name`)).rows.map((r) => r.name);

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
  });
  afterEach(async () => {
    await endAll(clients.splice(0));
    await setRole(actors.adminId, 'admin');
    await setRole(actors.customerId, 'user');
    await admin.query('ALTER TABLE public.refund_requests ENABLE TRIGGER trg_refund_requests_guard').catch(() => {});
    await admin.query(
      `DELETE FROM public.activity_logs WHERE entity_type = 'refund_request' AND entity_id IN
         (SELECT id FROM public.refund_requests WHERE order_id = ANY($1))`,
      [tracker.orders]
    );
    if (objects.length) {
      await admin.query(`DELETE FROM storage.objects WHERE bucket_id = 'refund-proofs' AND name = ANY($1)`, [objects.splice(0)]);
    }
    if (otherObjects.length) {
      await admin.query(`DELETE FROM storage.objects WHERE bucket_id = 'order-documents' AND name = ANY($1)`, [otherObjects.splice(0)]);
    }
    await cleanup(admin, tracker);
  });
  afterAll(async () => {
    await admin.end();
  });

  describe('v1 admin_resolve_refund is closed to API roles; v2 is the way in', () => {
    it('has no EXECUTE for authenticated, anon or PUBLIC (the 5-argument overload is the only v1)', async () => {
      const { rows } = await admin.query(
        `SELECT pg_get_function_identity_arguments(p.oid) AS args,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
                has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
                has_function_privilege('public', p.oid, 'EXECUTE') AS pub
           FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'admin_resolve_refund'`
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].args).toBe('p_refund_id uuid, p_action text, p_reference text, p_refunded_at timestamp with time zone, p_reason text');
      expect(rows[0]).toMatchObject({ auth: false, anon: false, pub: false });
    });

    it('an admin calling v1 gets "permission denied for function" (42501) and the refund stays pending', async () => {
      const refund = await paidOrder();
      await openHold(refund.id);
      const err = await failure(
        (await as(actors.adminId)).query(`SELECT * FROM public.admin_resolve_refund($1, $2, $3, NULL, NULL)`, [refund.id, 'refunded', 'ZEL-1'])
      );
      expect(err.code).toBe('42501');
      expect(err.message).toMatch(/permission denied for function admin_resolve_refund/);
      expect((await refundById(refund.id)).status).toBe('pending');
    });

    it('anon is refused too', async () => {
      const anon = await connectAnon();
      clients.push(anon);
      const err = await failure(anon.query(`SELECT * FROM public.admin_resolve_refund($1, 'not_applicable', NULL, NULL, 'x')`, [randomUUID()]));
      expect(err.code).toBe('42501');
      expect(err.message).toMatch(/permission denied for function admin_resolve_refund/);
    });

    it('v2 still resolves for an admin (not_applicable) and for a super_admin (refunded with proof)', async () => {
      const first = await paidOrder();
      const na = await json(await as(actors.adminId), 'admin_resolve_refund_v2', [first.id, 'not_applicable', null, null, 'duplicate request', null, null, false]);
      expect(na.ok).toBe(true);
      expect((await refundById(first.id)).status).toBe('not_applicable');

      await setRole(actors.adminId, 'super_admin');
      const second = await paidOrder();
      await openHold(second.id);
      const done = await resolveV2(await as(actors.adminId), second.id, await addObject(second.id));
      expect(done.ok).toBe(true);
      expect((await refundById(second.id)).status).toBe('refunded');
    });
  });

  describe('admin_refund_proof_orphans (read only, super_admin)', () => {
    it('lists exactly the unreferenced objects of the bucket: 2 referenced, 3 orphans -> the 3', async () => {
      const a = await refundedWithProof();
      const b = await refundedWithProof();
      const pending = await paidOrder();
      const orphans = [await addObject(pending.id), await addObject(pending.id, 'pdf'), await addObject(randomUUID(), 'jpg')];
      const elsewhere = `refunds/${pending.id}/${randomUUID()}.png`; // same shape, other bucket: must not be reported
      await admin.query(`INSERT INTO storage.objects (bucket_id, name) VALUES ('order-documents', $1)`, [elsewhere]);
      otherObjects.push(elsewhere);
      await setRole(actors.adminId, 'super_admin');
      const rows = (await (await as(actors.adminId)).query('SELECT * FROM public.admin_refund_proof_orphans()')).rows;
      expect(rows.map((r) => r.object_name).sort()).toEqual([...orphans].sort());
      expect(rows.map((r) => r.object_name)).not.toContain(a.proof);
      expect(rows.map((r) => r.object_name)).not.toContain(b.proof);
      expect(rows[0].created_at).toBeInstanceOf(Date);
      expect(Object.keys(rows[0]).sort()).toEqual(['created_at', 'object_name', 'size_bytes']);
    });

    it('is a pure SELECT: the bucket is byte-for-byte the same afterwards and the function is STABLE', async () => {
      const refund = await paidOrder();
      await addObject(refund.id);
      await setRole(actors.adminId, 'super_admin');
      const before = await bucketNames();
      await (await as(actors.adminId)).query('SELECT * FROM public.admin_refund_proof_orphans()');
      expect(await bucketNames()).toEqual(before);
      const { rows } = await admin.query(
        `SELECT provolatile, prosecdef, proconfig FROM pg_proc WHERE proname = 'admin_refund_proof_orphans' AND pronamespace = 'public'::regnamespace`
      );
      expect(rows[0].provolatile).toBe('s');
      expect(rows[0].prosecdef).toBe(true);
      expect(rows[0].proconfig.join(',')).toContain('search_path=public, pg_temp');
    });

    it('a plain admin, a customer and a disabled super_admin get 42501; anon/PUBLIC cannot EXECUTE', async () => {
      const call = (c) => c.query('SELECT * FROM public.admin_refund_proof_orphans()');
      const plainAdmin = await failure(call(await as(actors.adminId)));
      expect(plainAdmin.code).toBe('42501');
      expect(plainAdmin.message).toMatch(/insufficient_privilege/);
      expect((await failure(call(await as(actors.customerId)))).code).toBe('42501');

      await setRole(actors.adminId, 'super_admin');
      await admin.query('UPDATE public.user_profiles SET is_enabled = false WHERE id = $1', [actors.adminId]);
      try {
        expect((await failure(call(await as(actors.adminId)))).code).toBe('42501');
      } finally {
        await admin.query('UPDATE public.user_profiles SET is_enabled = true WHERE id = $1', [actors.adminId]);
      }

      const anon = await connectAnon();
      clients.push(anon);
      const err = await failure(call(anon));
      expect(err.code).toBe('42501');
      expect(err.message).toMatch(/permission denied for function admin_refund_proof_orphans/);
      const { rows } = await admin.query(
        `SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon, has_function_privilege('public', p.oid, 'EXECUTE') AS pub,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
           FROM pg_proc p WHERE p.proname = 'admin_refund_proof_orphans' AND p.pronamespace = 'public'::regnamespace`
      );
      expect(rows).toEqual([{ anon: false, pub: false, auth: true }]);
    });
  });

  describe('purge flow, database contract (what purge-refund-proofs asks the DB, as service_role)', () => {
    const snapshot = async (id) =>
      (await admin.query('SELECT md5(to_jsonb(r)::text) AS h FROM public.refund_requests r WHERE id = $1', [id])).rows[0].h;

    it('selects only expired, undisputed proofs, marks them purged, and leaves every other row and every blob untouched', async () => {
      const expired = await refundedWithProof();
      const fresh = await refundedWithProof();
      const disputed = await refundedWithProof();
      const noProof = await paidOrder();
      await json(await as(actors.adminId), 'admin_resolve_refund_v2', [noProof.id, 'not_applicable', null, null, 'duplicate request', null, null, false]);
      await expireAt(expired.id, `now() - interval '1 second'`);
      await expireAt(fresh.id, `now() + interval '1 day'`);
      await expireAt(disputed.id, `now() - interval '1 day'`);
      await json(await as(actors.adminId), 'admin_set_refund_dispute', [disputed.id, true]);

      const mine = new Set([expired.id, fresh.id, disputed.id, noProof.id]);
      const before = { fresh: await snapshot(fresh.id), disputed: await snapshot(disputed.id), noProof: await snapshot(noProof.id) };
      const blobsBefore = await bucketNames();

      const svc = await as(actors.adminId, 'service_role');
      const due = (await svc.query('SELECT refund_id, proof_path FROM public._refund_proofs_due(100)')).rows.filter((r) => mine.has(r.refund_id));
      expect(due).toEqual([{ refund_id: expired.id, proof_path: expired.proof }]);

      for (const item of due) {
        expect((await svc.query('SELECT public._refund_dispute_open($1) AS d', [item.refund_id])).rows[0].d).toBe(false);
        expect((await svc.query('SELECT public._mark_refund_proof_purged($1, $2) AS ok', [item.refund_id, actors.adminId])).rows[0].ok).toBe(true);
      }
      // A direct mark on rows that are not due changes nothing (the function re-checks under a row lock).
      for (const row of [fresh, disputed, noProof]) {
        expect((await svc.query('SELECT public._mark_refund_proof_purged($1, NULL) AS ok', [row.id])).rows[0].ok).toBe(false);
      }

      expect((await refundById(expired.id)).proof_purged_at).toBeInstanceOf(Date);
      expect(await snapshot(fresh.id)).toBe(before.fresh);
      expect(await snapshot(disputed.id)).toBe(before.disputed);
      expect(await snapshot(noProof.id)).toBe(before.noProof);
      expect(await bucketNames()).toEqual(blobsBefore); // the DB never deletes blobs: only the Storage API does
      expect((await svc.query('SELECT refund_id FROM public._refund_proofs_due(100)')).rows.map((r) => r.refund_id)).not.toContain(expired.id);
    });
  });
});
