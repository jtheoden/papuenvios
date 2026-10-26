/**
 * Money columns of orders can only change through SECURITY DEFINER RPCs, never through a direct PATCH.
 *
 * Migration under test: 20261102100000_orders_money_columns_guard.sql
 *   trigger guard_orders_money_columns (BEFORE UPDATE, SECURITY INVOKER): rejects with 42501 /
 *   order_money_columns_rpc_only when current_user is authenticated/anon and a column of
 *   financial_audit_columns('orders') changes. SECURITY DEFINER RPCs run as the function owner, so they pass.
 *
 * Mirrors remittanceMoneyColumnsGuard.test.js. The suite does not list the new objects in `needs`: a missing
 * migration fails loudly (red phase).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dbSuiteSkipReason, connectAdmin, connectAs, endAll } from './db';
import { loadActors, createTracker, seedOrder, cleanup } from './fixtures';

const MIGRATION = 'supabase/migrations/20261102100000_orders_money_columns_guard.sql';
const ROLLBACK = 'supabase/rollbacks/20261102100000_orders_money_columns_guard_down.sql';

const skipReason = await dbSuiteSkipReason({
  functions: ['is_admin_user', 'is_super_admin', 'financial_audit_columns', 'order_validate_payment', 'order_cancel'],
  tables: ['orders', 'financial_audit_log', 'user_profiles', 'currencies', 'shipping_zones']
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

// Live functions the migration must not redefine (md5 pins live in the pre-apply checklist, not in the suite).
const UNTOUCHED_FUNCTIONS = [
  '_order_transition', '_remittance_transition', 'audit_financial_changes', 'financial_audit_columns',
  'guard_bizum_quote_immutable', 'guard_orders_owner_update', 'guard_remittance_money_columns',
  'guard_status_via_rpc', 'order_cancel', 'order_validate_payment', 'reserve_order_inventory'
];

describeDb('guard_orders_money_columns', () => {
  let admin;
  let actors;
  let altCurrencyId;
  let zoneId;
  const tracker = createTracker();
  const clients = [];

  const as = async (userId) => {
    const c = await connectAs(userId);
    clients.push(c);
    return c;
  };

  const read = async (id) => (await admin.query('SELECT * FROM public.orders WHERE id = $1', [id])).rows[0];
  const seed = (extra = {}) => seedOrder(admin, actors, tracker, [], { stockManaged: false, ...extra });
  const moneyChecksum = async (ids) =>
    (await admin.query(
      `SELECT count(*)::int AS n,
              md5(string_agg(concat_ws('|', id, subtotal, discount_amount, shipping_cost, tax_amount, total_amount,
                                       shipping_zone_id, payment_amount, payment_usd_reference, payment_fx_rate,
                                       currency_id, payment_currency), ',' ORDER BY id)) AS md5
         FROM public.orders WHERE id = ANY($1)`, [ids])).rows[0];

  // One direct PATCH per column of financial_audit_columns('orders'); the list is asserted against the live one.
  const MONEY_PATCHES = () => ({
    subtotal: ['subtotal = 1', []],
    discount_amount: ['discount_amount = 5', []],
    shipping_cost: ['shipping_cost = 9', []],
    tax_amount: ['tax_amount = 3', []],
    total_amount: ['total_amount = 0.01', []],
    shipping_zone_id: ['shipping_zone_id = $2', [zoneId]],
    payment_amount: ['payment_amount = 1', []],
    payment_usd_reference: ['payment_usd_reference = 1', []],
    payment_fx_rate: ['payment_fx_rate = 2', []],
    currency_id: ['currency_id = $2', [altCurrencyId]],
    payment_currency: ['payment_currency = \'EUR\'', []]
  });

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
    const cur = await admin.query('SELECT id FROM public.currencies WHERE id <> $1 LIMIT 1', [actors.currencyId]);
    altCurrencyId = cur.rows[0]?.id;
    if (!altCurrencyId) throw new Error('scratch DB needs two currencies');
    zoneId = (await admin.query(
      `INSERT INTO public.shipping_zones (province_name, shipping_cost) VALUES ('OMG-zone', 5) RETURNING id`)).rows[0].id;
    await admin.query(`
      CREATE OR REPLACE FUNCTION public.__test_order_money_rpc(p_id uuid, p_total numeric)
      RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
      BEGIN UPDATE public.orders SET total_amount = p_total, subtotal = p_total WHERE id = p_id; END $f$`);
    await admin.query('GRANT EXECUTE ON FUNCTION public.__test_order_money_rpc(uuid, numeric) TO authenticated');
  });

  afterEach(async () => {
    await endAll(clients.splice(0));
    await admin.query(`UPDATE public.user_profiles SET role = 'admin', is_enabled = true WHERE id = $1`, [actors.adminId]);
    await cleanup(admin, tracker);
  });

  afterAll(async () => {
    await admin.query('DROP FUNCTION IF EXISTS public.__test_order_money_rpc(uuid, numeric)');
    await admin.query('DELETE FROM public.shipping_zones WHERE id = $1', [zoneId]);
    await admin.end();
  });

  it('the patch table covers exactly the live financial_audit_columns(orders) list', async () => {
    const { rows } = await admin.query(`SELECT unnest(public.financial_audit_columns('orders')) AS c`);
    expect(Object.keys(MONEY_PATCHES()).sort()).toEqual(rows.map((r) => r.c).sort());
  });

  describe('direct PATCH as authenticated', () => {
    const cols = Object.keys(MONEY_PATCHES());

    describe.each([['admin', 'adminId'], ['super_admin', 'adminId'], ['owner', 'customerId']])('%s', (label, actor) => {
      it.each(cols)('cannot change %s', async (col) => {
        if (label === 'super_admin') await admin.query(`UPDATE public.user_profiles SET role = 'super_admin' WHERE id = $1`, [actors.adminId]);
        const id = await seed();
        const [set, params] = MONEY_PATCHES()[col];
        const c = await as(actors[actor]);
        const err = await failure(c.query(`UPDATE public.orders SET ${set} WHERE id = $1`, [id, ...params]));
        expect(err.code).toBe('42501');
        // the owner is stopped by whichever guard fires first; for admins it must be the new one
        expect(err.message).toMatch(label === 'owner' ? /order_money_columns_rpc_only|orders_owner_update_forbidden/ : /order_money_columns_rpc_only/);
      });
    });

    it('leaves the row untouched after a rejected PATCH (checksum before == after)', async () => {
      const id = await seed();
      const before = await moneyChecksum([id]);
      const c = await as(actors.adminId);
      await failure(c.query('UPDATE public.orders SET total_amount = 0.01, admin_notes = $2 WHERE id = $1', [id, 'x']));
      expect(await moneyChecksum([id])).toEqual(before);
      expect((await read(id)).admin_notes).toBeNull();
    });

    it('a no-op write of the same money value is allowed (value unchanged)', async () => {
      const id = await seed();
      const c = await as(actors.adminId);
      const { total_amount: same } = await read(id);
      await c.query('UPDATE public.orders SET total_amount = $3, admin_notes = $2 WHERE id = $1', [id, 'same money', same]);
      expect((await read(id)).admin_notes).toBe('same money');
    });
  });

  describe('flows that must keep working', () => {
    it('an admin can still PATCH non-money columns', async () => {
      const id = await seed();
      const c = await as(actors.adminId);
      await c.query(`UPDATE public.orders SET admin_notes = 'n', tracking_number = 'T-1', delivery_notes = 'd' WHERE id = $1`, [id]);
      expect(await read(id)).toMatchObject({ admin_notes: 'n', tracking_number: 'T-1', delivery_notes: 'd' });
    });

    it('a legitimate SECURITY DEFINER RPC can change a money column, and the audit log names it', async () => {
      const id = await seed();
      const c = await as(actors.adminId);
      await c.query('SELECT public.__test_order_money_rpc($1, 12.5)', [id]);
      expect(Number((await read(id)).total_amount)).toBe(12.5);
      const { rows } = await admin.query(
        `SELECT via_function, changed_by_role FROM public.financial_audit_log
          WHERE table_name = 'orders' AND row_id = $1 AND column_name = 'total_amount'`, [id]);
      expect(rows).toEqual([{ via_function: '__test_order_money_rpc', changed_by_role: 'admin' }]);
    });

    it('the real transition RPCs keep working and never alter money (validate, then cancel)', async () => {
      const id = await seed({ paymentStatus: 'proof_uploaded' });
      const before = await moneyChecksum([id]);
      const c = await as(actors.adminId);
      await c.query('SELECT public.order_validate_payment($1)', [id]);
      expect(await read(id)).toMatchObject({ status: 'processing', payment_status: 'validated' });
      await c.query('SELECT public.order_cancel($1, $2)', [id, 'out of stock at the supplier']);
      expect((await read(id)).status).toBe('cancelled');
      expect(await moneyChecksum([id])).toEqual(before);
    });

    it('the owner can still cancel through the RPC', async () => {
      const id = await seed();
      const c = await as(actors.customerId);
      await c.query('SELECT public.order_cancel($1, $2)', [id, 'changed my mind']);
      expect((await read(id)).status).toBe('cancelled');
    });

    it('postgres / uid NULL maintenance can still change money columns (service_role has no table privileges on orders)', async () => {
      const id = await seed();
      await admin.query('UPDATE public.orders SET total_amount = 11, subtotal = 11 WHERE id = $1', [id]);
      expect(Number((await read(id)).total_amount)).toBe(11);
    });

    it('the customer can still INSERT an order with money columns (checkout path is untouched: guard is UPDATE-only)', async () => {
      const c = await as(actors.customerId);
      const num = `OMG-${Date.now()}`;
      const { rows } = await c.query(
        `INSERT INTO public.orders (user_id, order_type, status, subtotal, total_amount, currency_id, payment_status, payment_method, order_number)
         VALUES ($1, 'product', 'pending', 10, 10, $2, 'pending', 'zelle', $3) RETURNING id`,
        [actors.customerId, actors.currencyId, num]);
      tracker.orders.push(rows[0].id);
      expect(Number((await read(rows[0].id)).total_amount)).toBe(10);
    });
  });

  describe('joint firing with the admin self-dealing guard (20261101100100)', () => {
    it('an admin PATCHing total_amount on his OWN order hits the money guard', async () => {
      const id = await seed({ userId: actors.adminId });
      const before = await moneyChecksum([id]);
      const c = await as(actors.adminId);
      const err = await failure(c.query('UPDATE public.orders SET total_amount = 0.01, subtotal = 0.01 WHERE id = $1', [id]));
      expect(err.message).toMatch(/order_money_columns_rpc_only/);
      expect(await moneyChecksum([id])).toEqual(before);
    });

    it('money + status in one direct PATCH on his own order: the money guard wins (fires first, alphabetical)', async () => {
      const id = await seed({ userId: actors.adminId });
      const c = await as(actors.adminId);
      const err = await failure(c.query(`UPDATE public.orders SET total_amount = 0.01, subtotal = 0.01, status = 'cancelled' WHERE id = $1`, [id]));
      expect(err.message).toMatch(/order_money_columns_rpc_only/);
      expect((await read(id)).status).toBe('pending');
    });

    it('an admin validating his OWN payment through the RPC is still blocked by self-dealing, not by the money guard', async () => {
      const id = await seed({ userId: actors.adminId, paymentStatus: 'proof_uploaded' });
      const c = await as(actors.adminId);
      const err = await failure(c.query('SELECT public.order_validate_payment($1)', [id]));
      expect(err.message).toMatch(/admin_self_dealing_not_allowed/);
      expect((await read(id)).payment_status).toBe('proof_uploaded');
    });

    it('an admin can still cancel his own pending order through the RPC (allowed transition, no money change)', async () => {
      const id = await seed({ userId: actors.adminId });
      const c = await as(actors.adminId);
      await c.query('SELECT public.order_cancel($1, $2)', [id, 'changed my mind']);
      expect((await read(id)).status).toBe('cancelled');
    });
  });

  describe('live functions stay untouched', () => {
    it('the migration does not redefine them nor write data', () => {
      const sql = readFileSync(MIGRATION, 'utf8').replace(/--.*$/gm, '');
      for (const name of UNTOUCHED_FUNCTIONS) {
        expect(sql).not.toMatch(new RegExp(`CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION\\s+(public\\.)?${name}\\b`, 'i'));
      }
      expect(sql).not.toMatch(/\b(DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|INSERT\s+INTO|UPDATE\s+public\.)/i);
    });
  });

  describe('trigger metadata', () => {
    it('is an ENABLE ALWAYS BEFORE UPDATE row trigger backed by a SECURITY INVOKER function reading the wrapper', async () => {
      const { rows } = await admin.query(
        `SELECT t.tgenabled, (t.tgtype & 2) <> 0 AS is_before, (t.tgtype & 16) <> 0 AS is_update, p.prosecdef, p.prosrc, p.proconfig
           FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
          WHERE t.tgrelid = 'public.orders'::regclass AND t.tgname = 'guard_orders_money_columns'`);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ is_before: true, is_update: true, prosecdef: false, tgenabled: 'A' });
      expect(rows[0].prosrc).toMatch(/current_user NOT IN \('authenticated', 'anon'\)/);
      expect(rows[0].prosrc).toMatch(/order_money_columns\(\)/);
      expect(rows[0].proconfig).toContain('search_path=public, pg_temp');
      const wrapper = await admin.query(
        `SELECT prosrc, prosecdef, proconfig,
                has_function_privilege('authenticated', 'public.financial_audit_columns(text)', 'EXECUTE') AS direct,
                has_function_privilege('authenticated', 'public.order_money_columns()', 'EXECUTE') AS via_wrapper,
                has_function_privilege('anon', 'public.order_money_columns()', 'EXECUTE') AS anon_wrapper,
                has_function_privilege('authenticated', 'public.guard_orders_money_columns()', 'EXECUTE') AS guard_exec
           FROM pg_proc WHERE oid = 'public.order_money_columns()'::regprocedure`);
      expect(wrapper.rows[0].prosrc).toMatch(/financial_audit_columns\('orders'\)/);
      expect(wrapper.rows[0]).toMatchObject({ prosecdef: true, direct: false, via_wrapper: true, anon_wrapper: false, guard_exec: false });
      expect(wrapper.rows[0].proconfig).toContain('search_path=public, pg_temp');
    });

    it('migration documents its rollback, runs in a transaction and ships a rollback script', () => {
      const sql = readFileSync(MIGRATION, 'utf8');
      expect(sql.split('\n').slice(0, 40).join('\n')).toMatch(/ROLLBACK/);
      expect(sql).toMatch(/^BEGIN;/m);
      expect(sql).toMatch(/^COMMIT;/m);
      expect(readFileSync(ROLLBACK, 'utf8')).toMatch(/DROP TRIGGER IF EXISTS guard_orders_money_columns/);
    });
  });
});
