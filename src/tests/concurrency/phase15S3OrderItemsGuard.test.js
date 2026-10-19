/**
 * Phase 1.5 / S3: BEFORE INSERT guard on public.order_items (patch P2) with an off / warn / block kill switch,
 * plus the flag-only items-vs-subtotal reconciliation (patch P4) inside _reserve_order_locked
 * (supabase/migrations/20261019100000_phase15_s3_order_items_guard.sql). Local Postgres only.
 *
 * Attacks closed (audit matrix): T-01 (unit_price 0.01), T-03 (items that do not add up to the order),
 * T-04 (huge quantity), T-17 (fake item_type / item_id).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { dbSuiteSkipReason, connectAdmin, connectAs, endAll } from './db';
import { loadActors, createTracker, seedProduct, seedOrder, cleanup } from './fixtures';

const skipReason = await dbSuiteSkipReason({
  functions: ['reserve_order_inventory', 'consume_order_inventory', 'is_admin_user'],
  tables: ['order_items', 'orders', 'products', 'combo_products', 'currencies', 'system_config', 'price_integrity_flags']
});
const describeDb = skipReason ? describe.skip : describe;

const MIGRATION = 'supabase/migrations/20261019100000_phase15_s3_order_items_guard.sql';
const MODE_KEY = 'order_items_pricing_guard_mode';
const UNIFORM_MESSAGE = 'order_item_pricing_rejected';

describeDb('phase 1.5 S3: order_items pricing guard + items/subtotal reconciliation (local Postgres)', () => {
  let admin;
  let actors;
  let usdId;
  let eurId;
  const tracker = createTracker();
  const clients = [];
  const flagSources = [];
  let product; // catalog price 10.00 (profit_margin 0)
  let combo; // catalog price 20.00

  const as = async (userId) => {
    const c = await connectAs(userId);
    clients.push(c);
    return c;
  };
  const asCustomer = () => as(actors.customerId);
  const asAdmin = () => as(actors.adminId);
  const asSuper = async () => {
    await admin.query(`UPDATE public.user_profiles SET role = 'super_admin' WHERE id = $1`, [actors.adminId]);
    return as(actors.adminId);
  };
  const setMode = (mode) => admin.query(`UPDATE public.system_config SET value_text = $2 WHERE key = $1`, [MODE_KEY, mode]);

  const newOrder = async (overrides = {}) => {
    const id = await seedOrder(admin, actors, tracker, [], overrides);
    flagSources.push(id);
    return id;
  };
  const line = (orderId, o = {}) => ({
    order_id: orderId,
    item_type: 'product',
    item_id: product.productId,
    quantity: 1,
    unit_price: 10,
    total_price: 10,
    ...o
  });
  const insertSql = `INSERT INTO public.order_items (order_id, item_type, item_id, item_name_es, item_name_en, quantity, unit_price, total_price)
                     VALUES ($1,$2,$3,'x','x',$4,$5,$6) RETURNING id`;
  const params = (l) => [l.order_id, l.item_type, l.item_id, l.quantity, String(l.unit_price), String(l.total_price)];
  const insert = async (client, l) => {
    const r = await client.query(insertSql, params(l));
    flagSources.push(r.rows[0].id);
    return r.rows[0].id;
  };
  const probe = async (client, l) => {
    await client.query('BEGIN');
    try {
      await client.query(insertSql, params(l));
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    } finally {
      await client.query('ROLLBACK');
    }
  };
  const expectRejected = async (client, l) => {
    const r = await probe(client, l);
    expect(r.ok, 'must be rejected').toBe(false);
    expect(r.error.message).toBe(UNIFORM_MESSAGE);
    expect(r.error.code).toBe('23514');
    expect(r.error.detail ?? null).toBeNull();
    expect(r.error.hint ?? null).toBeNull();
  };
  const expectAccepted = async (client, l) => {
    const r = await probe(client, l);
    expect(r.error?.message ?? null, 'must be accepted').toBeNull();
  };
  const flagsFor = async (id) =>
    (await admin.query(`SELECT rule, mode, user_id, source_table FROM public.price_integrity_flags WHERE source_id = $1 ORDER BY rule`, [id])).rows;

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
    usdId = (await admin.query(`SELECT id FROM public.currencies WHERE code = 'USD'`)).rows[0].id;
    eurId = (await admin.query(`SELECT id FROM public.currencies WHERE code <> 'USD' AND is_active ORDER BY code LIMIT 1`)).rows[0].id;
    const seeded = await seedProduct(admin, actors, tracker, { quantity: 1000 });
    await admin.query(`UPDATE public.products SET base_price = 10, profit_margin = 0, base_currency_id = $2 WHERE id = $1`, [seeded.productId, usdId]);
    product = seeded;
    combo = randomUUID();
    await admin.query(`INSERT INTO public.combo_products (id, name_es, name_en, base_total_price, profit_margin) VALUES ($1,'c','c',20,0)`, [combo]);
    tracker.combos.push(combo);
  });

  afterEach(async () => {
    await endAll(clients.splice(0));
    await setMode('warn');
    await admin.query(`DELETE FROM public.price_integrity_flags WHERE source_id = ANY($1)`, [flagSources.splice(0)]);
    // Drop per-test orders so reservations do not accumulate against the per-customer open-reservation cap.
    const orders = tracker.orders.splice(0);
    if (orders.length) {
      await admin.query(`DELETE FROM public.inventory_movements WHERE reference_id = ANY($1)`, [orders]);
      await admin.query(`DELETE FROM public.orders WHERE id = ANY($1)`, [orders]);
    }
    await admin.query(`DELETE FROM public.activity_logs WHERE action = 'order_items_pricing_guard_mode_changed'`);
    await admin.query(`UPDATE public.user_profiles SET role = 'admin' WHERE id = $1`, [actors.adminId]);
    await admin.query(`UPDATE public.products SET base_currency_id = $2 WHERE id = $1`, [product.productId, usdId]);
  });

  afterAll(async () => {
    await cleanup(admin, tracker);
    await admin.end();
  });

  // ------------------------------------------------------------------------------------------------
  describe('objects, privileges and ordering', () => {
    it('the kill switch row ships as warn and the pricing trigger sits right after the existing insert guard', async () => {
      const cfg = await admin.query(`SELECT value_text FROM public.system_config WHERE key = $1`, [MODE_KEY]);
      expect(cfg.rows).toEqual([{ value_text: 'warn' }]);
      const { rows } = await admin.query(
        `SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.order_items'::regclass AND NOT tgisinternal
            AND (tgtype & 1) = 1 AND (tgtype & 4) = 4 AND (tgtype & 2) = 2 ORDER BY tgname COLLATE "C"`
      );
      expect(rows.map((r) => r.tgname)).toEqual(['guard_order_items_insert', 'guard_order_items_pricing']);
    });

    it('DEFINER functions: EXECUTE revoked from PUBLIC / anon / authenticated (except the setter), search_path pinned', async () => {
      const { rows } = await admin.query(
        `SELECT p.proname, p.prosecdef, p.proconfig,
                has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x,
                has_function_privilege('public', p.oid, 'EXECUTE') AS public_x
           FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
            AND p.proname IN ('guard_order_items_pricing', '_order_items_guard_mode', '_flag_order_price_mismatch', 'set_order_items_pricing_guard_mode')
          ORDER BY p.proname`
      );
      expect(rows.map((r) => r.proname)).toEqual(['_flag_order_price_mismatch', '_order_items_guard_mode', 'guard_order_items_pricing', 'set_order_items_pricing_guard_mode']);
      for (const r of rows) {
        expect(r.prosecdef).toBe(true);
        expect(r.proconfig).toContain('search_path=public, pg_temp');
        expect(r.anon_x).toBe(false);
        expect(r.public_x).toBe(false);
        expect(r.auth_x).toBe(r.proname === 'set_order_items_pricing_guard_mode');
      }
    });

    it('reuses price_integrity_flags (no new table) and the migration is prepared-not-applied with an exact rollback', () => {
      const raw = readFileSync(resolve(process.cwd(), MIGRATION), 'utf8');
      expect(raw).toMatch(/PREPARED, NOT APPLIED/);
      expect(raw).toMatch(/ROLLBACK/);
      const sql = raw.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
      expect(sql).not.toMatch(/CREATE TABLE/i);
      expect(sql).not.toMatch(/ALTER PUBLICATION|DROP TABLE|TRUNCATE|DELETE FROM|execute_platform_reset/i);
      expect([...sql.matchAll(/^\s*CREATE (?:OR REPLACE )?TRIGGER\s+(\w+)/gim)].map((m) => m[1])).toEqual(['guard_order_items_pricing']);
    });

    it('P4 keeps the original _reserve_order_locked body byte-for-byte apart from the single guarded call', () => {
      const raw = readFileSync(resolve(process.cwd(), MIGRATION), 'utf8');
      const added = raw.match(/^[ \t]*-- P4-BEGIN[\s\S]*?-- P4-END\n/gm) ?? [];
      expect(added).toHaveLength(1);
      const stock = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261014190000_atomic_stock_reservation.sql'), 'utf8');
      const grab = (s) => s.slice(s.indexOf('CREATE OR REPLACE FUNCTION public._reserve_order_locked'), s.indexOf('REVOKE ALL ON FUNCTION public._reserve_order_locked'));
      const rewritten = grab(raw).replace(added[0], '');
      expect(rewritten.trim()).toBe(grab(stock).trim());
    });

    it('a customer cannot read the flags or the helper functions', async () => {
      const c = await asCustomer();
      await expect(c.query('SELECT * FROM public.price_integrity_flags')).rejects.toMatchObject({ code: '42501' });
      await expect(c.query('SELECT public._order_items_guard_mode()')).rejects.toMatchObject({ code: '42501' });
      await expect(c.query('SELECT public._flag_order_price_mismatch(gen_random_uuid())')).rejects.toMatchObject({ code: '42501' });
    });
  });

  // ------------------------------------------------------------------------------------------------
  describe('kill switch: off / warn / block', () => {
    it('warn (default): T-01 (0.01 for a 10.00 product) is ACCEPTED and leaves an observable flag; a legit line leaves none', async () => {
      const c = await asCustomer();
      const orderId = await newOrder();
      const bad = await insert(c, line(orderId, { unit_price: 0.01, total_price: 0.01 }));
      const flags = await flagsFor(bad);
      expect(flags.map((f) => f.rule)).toEqual(['below_floor']);
      expect(flags[0]).toMatchObject({ mode: 'warn', source_table: 'order_items', user_id: actors.customerId });

      const good = await insert(c, line(orderId));
      expect(await flagsFor(good)).toEqual([]);
    });

    it('block: the same insert is rejected with ONE uniform message and nothing is stored', async () => {
      await setMode('block');
      const c = await asCustomer();
      const orderId = await newOrder();
      await expectRejected(c, line(orderId, { unit_price: 0.01, total_price: 0.01 }));
      expect((await admin.query('SELECT count(*)::int AS n FROM public.order_items WHERE order_id = $1', [orderId])).rows[0].n).toBe(0);
    });

    it('off: nothing is checked and nothing is flagged', async () => {
      await setMode('off');
      const c = await asCustomer();
      const orderId = await newOrder();
      const id = await insert(c, line(orderId, { unit_price: 0.01, total_price: 0.01 }));
      expect(await flagsFor(id)).toEqual([]);
    });

    it('a missing or invalid mode value behaves as warn (never blocks by misconfiguration, still records)', async () => {
      const c = await asCustomer();
      const orderId = await newOrder();
      await setMode('banana');
      const id = await insert(c, line(orderId, { unit_price: 0.01, total_price: 0.01 }));
      expect((await flagsFor(id)).length).toBeGreaterThan(0);
      await admin.query(`DELETE FROM public.system_config WHERE key = $1`, [MODE_KEY]);
      try {
        const id2 = await insert(c, line(orderId, { unit_price: 0.01, total_price: 0.01 }));
        expect((await flagsFor(id2)).length).toBeGreaterThan(0);
      } finally {
        await admin.query(`INSERT INTO public.system_config (key, value_text, description) VALUES ($1, 'warn', 'restored by test')`, [MODE_KEY]);
      }
    });

    it('setter RPC: only a super_admin can change the mode; invalid values and other roles are refused; the change is logged', async () => {
      const cust = await asCustomer();
      await expect(cust.query(`SELECT public.set_order_items_pricing_guard_mode('block')`)).rejects.toMatchObject({ code: '42501' });
      const adm = await asAdmin();
      await expect(adm.query(`SELECT public.set_order_items_pricing_guard_mode('block')`)).rejects.toMatchObject({ code: '42501' });
      const sup = await asSuper();
      await expect(sup.query(`SELECT public.set_order_items_pricing_guard_mode('banana')`)).rejects.toMatchObject({ code: '22023' });
      await expect(sup.query(`SELECT public.set_order_items_pricing_guard_mode(NULL)`)).rejects.toMatchObject({ code: '22023' });
      const r = await sup.query(`SELECT public.set_order_items_pricing_guard_mode('block') AS m`);
      expect(r.rows[0].m).toBe('block');
      expect((await admin.query(`SELECT value_text FROM public.system_config WHERE key = $1`, [MODE_KEY])).rows[0].value_text).toBe('block');
      const log = await admin.query(`SELECT metadata FROM public.activity_logs WHERE action = 'order_items_pricing_guard_mode_changed'`);
      expect(log.rows).toHaveLength(1);
      expect(log.rows[0].metadata).toMatchObject({ before: 'warn', after: 'block' });
    });
  });

  // ------------------------------------------------------------------------------------------------
  describe('rules (block mode)', () => {
    it.each([
      ['T-01 unit_price far below the catalog floor', { unit_price: 4.99, total_price: 4.99 }],
      ['T-17 item_type outside product/combo', { item_type: 'remittance' }],
      ['T-17 item_id that is not in the catalog', { item_id: randomUUID() }],
      ['line total that does not match unit_price x quantity', { quantity: 3, unit_price: 10, total_price: 10 }],
      ['T-04 quantity above the cap', { quantity: 1001, unit_price: 10, total_price: 10010 }],
      ['combo below the floor', { item_type: 'combo', item_id: '__combo__', unit_price: 9.99, total_price: 9.99 }]
    ])('rejects: %s', async (_name, overrides) => {
      await setMode('block');
      const c = await asCustomer();
      const orderId = await newOrder();
      const o = { ...overrides };
      if (o.item_id === '__combo__') o.item_id = combo;
      await expectRejected(c, line(orderId, o));
    });

    it.each([
      ['exact catalog price', {}],
      ['exactly at the 50% floor', { unit_price: 5, total_price: 5 }],
      ['legit drift (0.906 x catalog)', { unit_price: 9.06, total_price: 9.06 }],
      ['price in a cheaper-unit currency (EUR-like 0.92 x)', { unit_price: 9.2, total_price: 9.2 }],
      ['price above the catalog (CUP-like display currency)', { unit_price: 4000, total_price: 4000 }],
      ['combo at catalog price', { item_type: 'combo', item_id: '__combo__', unit_price: 20, total_price: 20 }],
      ['combo labeled as product (detail page mislabel, handled by _order_stock_needs too)', { item_type: 'product', item_id: '__combo__', unit_price: 20, total_price: 20 }],
      ['quantity at the cap', { quantity: 1000, unit_price: 10, total_price: 10000 }],
      ['rounding drift inside the tolerance (27 x 0.55)', { quantity: 27, unit_price: 5.5, total_price: 148.51 }]
    ])('accepts: %s', async (_name, overrides) => {
      await setMode('block');
      const c = await asCustomer();
      const orderId = await newOrder();
      const o = { ...overrides };
      if (o.item_id === '__combo__') o.item_id = combo;
      await expectAccepted(c, line(orderId, o));
    });

    it('a product with a non-USD base currency is not floor-checked (conversion unknown) but leaves a flag', async () => {
      await setMode('block');
      await admin.query(`UPDATE public.products SET base_currency_id = $2 WHERE id = $1`, [product.productId, eurId]);
      const c = await asCustomer();
      const orderId = await newOrder();
      const id = await insert(c, line(orderId, { unit_price: 0.01, total_price: 0.01 }));
      expect(await flagsFor(id)).toEqual([expect.objectContaining({ rule: 'currency_unverified', mode: 'flag' })]);
    });

    it('a NULL operand rejects instead of skipping the rule (fail closed): unknown order is still stopped by RLS/guards', async () => {
      await setMode('block');
      const c = await asCustomer();
      await expect(c.query(insertSql, params(line(randomUUID())))).rejects.toBeTruthy();
    });
  });

  // ------------------------------------------------------------------------------------------------
  describe('who is not restricted', () => {
    it('admin, super_admin and postgres insert anything in block mode, without flags', async () => {
      await setMode('block');
      const orderId = await newOrder({ userId: actors.adminId, status: 'processing', paymentStatus: 'validated' });
      const bad = line(orderId, { unit_price: 0.01, total_price: 0.01 });
      for (const client of [await asAdmin(), await asSuper(), admin]) {
        const id = await insert(client, bad);
        expect(await flagsFor(id)).toEqual([]);
      }
    });
  });

  // ------------------------------------------------------------------------------------------------
  describe('P4: items vs subtotal reconciliation (flag only, never blocks)', () => {
    const reserveSql = 'public.reserve_order_inventory($1)';
    const orderWith = async (qty, overrides) => {
      // seedOrder: subtotal 10, items 5 x qty -> qty 2 matches the subtotal, qty 1 does not
      const id = await seedOrder(admin, actors, tracker, [{ type: 'product', id: product.productId, quantity: qty }], overrides);
      flagSources.push(id);
      return id;
    };

    it('reserve: a mismatch is recorded as ONE flag and the reservation still succeeds', async () => {
      const id = await orderWith(1);
      const c = await asCustomer();
      const r = await c.query(`SELECT ${reserveSql} AS r`, [id]);
      expect(r.rows[0].r).toMatchObject({ ok: true });
      const flags = await flagsFor(id);
      expect(flags).toEqual([expect.objectContaining({ rule: 'items_subtotal_mismatch', mode: 'flag', source_table: 'orders', user_id: actors.customerId })]);
    });

    it('reserve: items that add up to the subtotal leave no flag', async () => {
      const id = await orderWith(2);
      const c = await asCustomer();
      await c.query(`SELECT ${reserveSql}`, [id]);
      expect(await flagsFor(id)).toEqual([]);
    });

    it('block mode still never blocks the reservation, and off records nothing', async () => {
      await setMode('block');
      const id = await orderWith(1);
      const c = await asCustomer();
      expect((await c.query(`SELECT ${reserveSql} AS r`, [id])).rows[0].r).toMatchObject({ ok: true });
      expect((await flagsFor(id)).length).toBe(1);

      await setMode('off');
      const id2 = await orderWith(1);
      await c.query(`SELECT ${reserveSql}`, [id2]);
      expect(await flagsFor(id2)).toEqual([]);
    });

    it('consume (admin, payment validated, never reserved): the mismatch is flagged and the paid order is NOT cancelled', async () => {
      const id = await orderWith(1, { status: 'processing', paymentStatus: 'validated' });
      const a = await asAdmin();
      const r = await a.query(`SELECT public.consume_order_inventory($1) AS r`, [id]);
      expect(r.rows[0].r).toMatchObject({ ok: true, consumed: true });
      expect((await flagsFor(id)).map((f) => f.rule)).toEqual(['items_subtotal_mismatch']);
      expect((await admin.query('SELECT status FROM public.orders WHERE id = $1', [id])).rows[0].status).toBe('processing');
    });

    it('the helper is idempotent per order and rule, never raises, and tolerates +-0.01 per line', async () => {
      const id = await orderWith(1);
      await admin.query(`SELECT public._flag_order_price_mismatch($1)`, [id]);
      await admin.query(`SELECT public._flag_order_price_mismatch($1)`, [id]);
      expect((await flagsFor(id)).length).toBe(1);
      await expect(admin.query(`SELECT public._flag_order_price_mismatch($1)`, [randomUUID()])).resolves.toBeTruthy();

      const close = await orderWith(2);
      await admin.query(`UPDATE public.order_items SET total_price = 10.01 WHERE order_id = $1`, [close]);
      await admin.query(`SELECT public._flag_order_price_mismatch($1)`, [close]);
      expect(await flagsFor(close)).toEqual([]);
    });
  });
});
