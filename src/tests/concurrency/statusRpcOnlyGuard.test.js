/**
 * E8 (W5b): status columns change only through the transition RPCs.
 * Migration under test: 20261024120000_status_rpc_only_guard.sql (apply LAST in production, after the E6/E7 front).
 *   guard_status_via_rpc: BEFORE UPDATE trigger on orders (status, payment_status) and remittances (status)
 *   refusing 42501 'status_rpc_only' for the authenticated / anon roles; definer RPCs, service_role and postgres pass.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { dbSuiteSkipReason, connectAdmin, connectAs, endAll } from './db';
import { loadActors, createTracker, seedOrder, seedProduct, cleanup } from './fixtures';

const skipReason = await dbSuiteSkipReason({
  functions: ['is_admin_user', 'order_cancel', 'order_validate_payment', 'remittance_validate_payment'],
  tables: ['orders', 'remittances', 'user_profiles']
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

describeDb('status columns are RPC-only', () => {
  let admin;
  let actors;
  let typeId;
  const tracker = createTracker();
  const remittances = [];
  const clients = [];

  const as = async (userId) => {
    const c = await connectAs(userId);
    clients.push(c);
    return c;
  };
  const orderRow = async (id) => (await admin.query('SELECT status, payment_status, admin_notes FROM public.orders WHERE id = $1', [id])).rows[0];
  const remRow = async (id) => (await admin.query('SELECT status, delivery_proof_url FROM public.remittances WHERE id = $1', [id])).rows[0];
  const seedRemittance = async (status) => {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO public.remittances (id, user_id, remittance_type_id, amount_sent, exchange_rate,
         commission_percentage, commission_fixed, commission_total, amount_to_deliver, currency_sent,
         currency_delivered, recipient_name, recipient_phone, status)
       VALUES ($1,$2,$3,100,800,2.5,0,2.5,78000,'USD','CUP','Rcpt','+5355550100',$4)`,
      [id, actors.customerId, typeId, status]
    );
    remittances.push(id);
    return id;
  };

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
    const t = await admin.query(
      `INSERT INTO public.remittance_types (name, currency_code, delivery_currency, exchange_rate,
         commission_percentage, commission_fixed, min_amount, delivery_method)
       VALUES ($1,'USD','CUP',800,2.5,0,0.01,'transfer') RETURNING id`,
      [`rt-${randomUUID().slice(0, 8)}`]
    );
    typeId = t.rows[0].id;
  });
  afterEach(async () => {
    await endAll(clients.splice(0));
    await admin.query(`UPDATE public.user_profiles SET role = 'admin' WHERE id = $1`, [actors.adminId]);
    await cleanup(admin, tracker);
    if (remittances.length) {
      await admin.query('DELETE FROM public.remittance_status_history WHERE remittance_id = ANY($1)', [remittances]);
      await admin.query('DELETE FROM public.remittances WHERE id = ANY($1)', [remittances.splice(0)]);
    }
  });
  afterAll(async () => {
    await admin.query('DELETE FROM public.remittance_types WHERE id = $1', [typeId]);
    await admin.end();
  });

  describe('a direct PATCH on a status column is refused', () => {
    it.each([
      ['owner', () => actors.customerId],
      ['admin', () => actors.adminId]
    ])('orders.status as %s', async (_label, who) => {
      const id = await seedOrder(admin, actors, tracker, [], { stockManaged: false });
      const c = await as(who());
      const err = await failure(c.query(`UPDATE public.orders SET status = 'cancelled' WHERE id = $1`, [id]));
      expect(err.code).toBe('42501');
      expect(err.message).toMatch(/status_rpc_only/);
      expect((await orderRow(id)).status).toBe('pending');
    });

    it('orders.payment_status as admin', async () => {
      const id = await seedOrder(admin, actors, tracker, [], { stockManaged: false, paymentStatus: 'proof_uploaded' });
      const c = await as(actors.adminId);
      const err = await failure(c.query(`UPDATE public.orders SET payment_status = 'validated' WHERE id = $1`, [id]));
      expect(err.code).toBe('42501');
      expect((await orderRow(id)).payment_status).toBe('proof_uploaded');
    });

    it('orders.status as super_admin', async () => {
      await admin.query(`UPDATE public.user_profiles SET role = 'super_admin' WHERE id = $1`, [actors.adminId]);
      const id = await seedOrder(admin, actors, tracker, [], { stockManaged: false });
      const c = await as(actors.adminId);
      const err = await failure(c.query(`UPDATE public.orders SET status = 'cancelled' WHERE id = $1`, [id]));
      expect(err.code).toBe('42501');
    });

    it.each([
      ['owner', () => actors.customerId],
      ['admin', () => actors.adminId]
    ])('remittances.status as %s', async (_label, who) => {
      const id = await seedRemittance('payment_pending');
      const c = await as(who());
      const err = await failure(c.query(`UPDATE public.remittances SET status = 'cancelled' WHERE id = $1`, [id]));
      expect(err.code).toBe('42501');
      expect(err.message).toMatch(/status_rpc_only/);
      expect((await remRow(id)).status).toBe('payment_pending');
    });
  });

  describe('realistic bypass: a SECURITY INVOKER function that writes the status', () => {
    beforeAll(async () => {
      await admin.query(`
        CREATE OR REPLACE FUNCTION public.__test_invoker_set_status(p_order uuid, p_rem uuid) RETURNS void
        LANGUAGE plpgsql SECURITY INVOKER AS $fn$
        BEGIN
          IF p_order IS NOT NULL THEN UPDATE public.orders SET status = 'cancelled' WHERE id = p_order; END IF;
          IF p_rem IS NOT NULL THEN UPDATE public.remittances SET status = 'cancelled' WHERE id = p_rem; END IF;
        END $fn$`);
      await admin.query('GRANT EXECUTE ON FUNCTION public.__test_invoker_set_status(uuid, uuid) TO authenticated');
    });
    afterAll(async () => {
      await admin.query('DROP FUNCTION IF EXISTS public.__test_invoker_set_status(uuid, uuid)');
    });

    it.each([
      ['owner', () => actors.customerId],
      ['admin', () => actors.adminId]
    ])('an invoker function called as %s is refused for orders and for remittances', async (_label, who) => {
      const oid = await seedOrder(admin, actors, tracker, [], { stockManaged: false });
      const rid = await seedRemittance('payment_pending');
      const c = await as(who());
      const orderErr = await failure(c.query('SELECT public.__test_invoker_set_status($1, NULL)', [oid]));
      const remErr = await failure(c.query('SELECT public.__test_invoker_set_status(NULL, $1)', [rid]));
      expect([orderErr.code, remErr.code]).toEqual(['42501', '42501']);
      expect(orderErr.message).toMatch(/status_rpc_only/);
      expect((await orderRow(oid)).status).toBe('pending');
      expect((await remRow(rid)).status).toBe('payment_pending');
    });
  });

  describe('everything else keeps working', () => {
    it('the transition RPCs (definer) still change the status for owner and admin', async () => {
      const mine = await seedOrder(admin, actors, tracker, [], { stockManaged: false });
      const owner = await as(actors.customerId);
      const cancelled = await owner.query('SELECT * FROM public.order_cancel($1, $2)', [mine, 'changed my mind']);
      expect(cancelled.rows[0].status).toBe('cancelled');

      const paid = await seedOrder(admin, actors, tracker, [], { stockManaged: false, paymentStatus: 'proof_uploaded' });
      const adm = await as(actors.adminId);
      const validated = await adm.query('SELECT * FROM public.order_validate_payment($1)', [paid]);
      expect(validated.rows[0].payment_status).toBe('validated');

      const rem = await seedRemittance('payment_proof_uploaded');
      const r = await adm.query('SELECT * FROM public.remittance_validate_payment($1)', [rem]);
      expect(r.rows[0].status).toBe('payment_validated');
    });

    it('non-status columns are still writable by their owners (admin_notes, delivery_proof_url)', async () => {
      const id = await seedOrder(admin, actors, tracker, [], { stockManaged: false });
      const rem = await seedRemittance('processing');
      const adm = await as(actors.adminId);
      await adm.query(`UPDATE public.orders SET admin_notes = 'called the customer' WHERE id = $1`, [id]);
      await adm.query(`UPDATE public.remittances SET delivery_proof_url = 'admin/delivery/x.png' WHERE id = $1`, [rem]);
      expect((await orderRow(id)).admin_notes).toBe('called the customer');
      expect((await remRow(rem)).delivery_proof_url).toBe('admin/delivery/x.png');
    });

    it('an UPDATE that names the column without changing it is not blocked by this guard', async () => {
      const id = await seedOrder(admin, actors, tracker, [], { stockManaged: false });
      const adm = await as(actors.adminId);
      await adm.query(`UPDATE public.orders SET status = status, admin_notes = 'same status' WHERE id = $1`, [id]);
      expect((await orderRow(id)).admin_notes).toBe('same status');
    });

    it('postgres / service-side writers (cron, edge functions) are unaffected', async () => {
      const id = await seedOrder(admin, actors, tracker, [], { stockManaged: false });
      const rem = await seedRemittance('payment_pending');
      await admin.query(`UPDATE public.orders SET status = 'cancelled' WHERE id = $1`, [id]);
      await admin.query(`UPDATE public.remittances SET status = 'cancelled' WHERE id = $1`, [rem]);
      expect((await orderRow(id)).status).toBe('cancelled');
      expect((await remRow(rem)).status).toBe('cancelled');
    });

    it('the stale-reservation expiry job (definer) still cancels an old unpaid order when an admin runs it', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 10 });
      const id = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 1 }]);
      const owner = await as(actors.customerId);
      await owner.query('SELECT public.reserve_order_inventory($1)', [id]);
      await admin.query(`UPDATE public.orders SET stock_reserved_at = now() - interval '100 hours' WHERE id = $1`, [id]);
      const adm = await as(actors.adminId);
      await adm.query('SELECT public.expire_stale_order_reservations()');
      expect((await orderRow(id)).status).toBe('cancelled');
    });
  });

  describe('privileges', () => {
    it('the guard function is not callable by anon or authenticated', async () => {
      const { rows } = await admin.query(
        `SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
           FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'guard_status_via_rpc'`
      );
      expect(rows[0]).toEqual({ anon: false, auth: false });
    });
  });
});
