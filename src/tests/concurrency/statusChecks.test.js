/**
 * E1 (W5b): CHECK + NOT NULL on the state columns.
 * Migration under test: 20261024100000_status_check_constraints.sql
 * The suite does not list the new constraints in `needs`: a missing migration fails loudly (red phase).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { dbSuiteSkipReason, connectAdmin } from './db';
import { loadActors, createTracker, seedProduct, seedOrder, cleanup } from './fixtures';

const skipReason = await dbSuiteSkipReason({
  functions: ['expire_stale_order_reservations', 'reserve_order_inventory'],
  tables: ['orders', 'remittances', 'zelle_transaction_history', 'offers']
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

describeDb('status CHECK constraints', () => {
  let admin;
  let actors;
  const tracker = createTracker();
  const remittances = [];
  const types = [];

  const seedRemittance = async (status = 'payment_pending') => {
    const t = await admin.query(
      `INSERT INTO public.remittance_types (name, currency_code, delivery_currency, exchange_rate,
         commission_percentage, commission_fixed, min_amount, delivery_method)
       VALUES ($1,'USD','CUP',800,2.5,0,0.01,'transfer') RETURNING id`,
      [`sc-${randomUUID().slice(0, 8)}`]
    );
    types.push(t.rows[0].id);
    const id = randomUUID();
    await admin.query(
      `INSERT INTO public.remittances (id, user_id, remittance_type_id, amount_sent, exchange_rate,
         commission_percentage, commission_fixed, commission_total, amount_to_deliver, currency_sent,
         currency_delivered, recipient_name, recipient_phone, status)
       VALUES ($1,$2,$3,100,800,2.5,0,2.5,78000,'USD','CUP','R','+5355550100',$4)`,
      [id, actors.customerId, t.rows[0].id, status]
    );
    remittances.push(id);
    return id;
  };

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
  });
  afterEach(async () => {
    await cleanup(admin, tracker);
    if (remittances.length) await admin.query('DELETE FROM public.remittances WHERE id = ANY($1)', [remittances.splice(0)]);
    if (types.length) await admin.query('DELETE FROM public.remittance_types WHERE id = ANY($1)', [types.splice(0)]);
  });
  afterAll(async () => {
    await admin.end();
  });

  describe('orders', () => {
    it.each(['pending', 'processing', 'dispatched', 'delivered', 'completed', 'cancelled'])('accepts status %s', async (s) => {
      const id = await seedOrder(admin, actors, tracker, [], { status: s });
      expect((await admin.query('SELECT status FROM public.orders WHERE id=$1', [id])).rows[0].status).toBe(s);
    });
    it.each(['pending', 'proof_uploaded', 'validated', 'rejected'])('accepts payment_status %s', async (s) => {
      await seedOrder(admin, actors, tracker, [], { paymentStatus: s });
    });
    it('rejects an unknown status with 23514', async () => {
      const err = await failure(seedOrder(admin, actors, tracker, [], { status: 'shipped' }));
      expect(err.code).toBe('23514');
    });
    it('rejects an unknown payment_status with 23514', async () => {
      const err = await failure(seedOrder(admin, actors, tracker, [], { paymentStatus: 'paid' }));
      expect(err.code).toBe('23514');
    });
    it('rejects NULL status and NULL payment_status with 23502', async () => {
      const id = await seedOrder(admin, actors, tracker, []);
      expect((await failure(admin.query('UPDATE public.orders SET status = NULL WHERE id=$1', [id]))).code).toBe('23502');
      expect((await failure(admin.query('UPDATE public.orders SET payment_status = NULL WHERE id=$1', [id]))).code).toBe('23502');
    });
    it('the stock paths still work: no-stock reserve cancels, expiry runs', async () => {
      const { productId } = await seedProduct(admin, actors, tracker, { quantity: 0 });
      const id = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 1 }]);
      await admin.query('SELECT public.reserve_order_inventory($1)', [id]);
      const o = (await admin.query('SELECT status, payment_status FROM public.orders WHERE id=$1', [id])).rows[0];
      expect(o).toEqual({ status: 'cancelled', payment_status: 'rejected' });
      await admin.query('SELECT public.expire_stale_order_reservations()');
    });
  });

  describe('remittances', () => {
    it.each([
      'payment_pending', 'payment_proof_uploaded', 'payment_validated', 'payment_rejected',
      'processing', 'delivered', 'completed', 'cancelled'
    ])('accepts %s', async (s) => {
      await seedRemittance(s);
    });
    it('rejects an unknown status with 23514', async () => {
      expect((await failure(seedRemittance('shipped'))).code).toBe('23514');
    });
  });

  describe('zelle_transaction_history', () => {
    it('status is NOT NULL', async () => {
      const { rows } = await admin.query(
        `SELECT is_nullable FROM information_schema.columns WHERE table_name='zelle_transaction_history' AND column_name='status'`
      );
      expect(rows[0].is_nullable).toBe('NO');
    });
    it('has the CHECK constraint', async () => {
      const { rows } = await admin.query(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname='zelle_transaction_history_status_check'`
      );
      expect(rows[0]?.def).toMatch(/validated/);
    });
  });

  describe('offers.discount_type', () => {
    const insertOffer = (type) =>
      admin.query(
        `INSERT INTO public.offers (code, name_es, name_en, discount_type, discount_value, applies_to, start_date, end_date, is_active)
         VALUES ($1,'x','x',$2,10,'product', now(), now() + interval '1 day', false) RETURNING id`,
        [`SC${randomUUID().slice(0, 8)}`, type]
      );
    it.each(['percentage', 'fixed_amount'])('accepts %s', async (t) => {
      const { rows } = await insertOffer(t);
      await admin.query('DELETE FROM public.offers WHERE id=$1', [rows[0].id]);
    });
    it('rejects fixed with 23514', async () => {
      expect((await failure(insertOffer('fixed'))).code).toBe('23514');
    });
  });
});
