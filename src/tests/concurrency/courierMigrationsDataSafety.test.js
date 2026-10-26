/**
 * Production-safety of the courier migrations (owner HARD RULE: real data must not be affected).
 * With realistic rows in orders / order_items / remittances / types / zones / cost snapshots, the migrations are
 * (a) strictly additive: they only CREATE objects, never DROP/TRUNCATE/DELETE/UPDATE existing tables;
 * (b) idempotent and reversible: re-applying them and rolling them back (in a rolled-back transaction) leaves the
 *     row counts and the md5 checksums of every pre-existing table unchanged;
 * (c) harmless to existing flows: delivering with the triggers in place changes nothing but the delivery itself.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { dbSuiteSkipReason, connectAdmin, endAll } from './db';
import { loadActors } from './fixtures';
import { MIGRATIONS, ROLLBACKS, readSql, makeKit } from './courierTestKit';

const skipReason = await dbSuiteSkipReason({ tables: ['orders', 'order_items', 'remittances', 'courier_accruals'] });
const describeDb = skipReason ? describe.skip : describe;

const EXISTING = ['orders', 'order_items', 'remittances', 'remittance_types', 'shipping_zones', 'exchange_rates',
  'order_courier_costs', 'remittance_courier_costs', 'user_profiles', 'financial_audit_log', 'order_status_history',
  'remittance_status_history'];
const strip = (sql) => sql.replace(/^\s*(BEGIN|COMMIT);\s*$/gm, '');
const ALL = ['m1', 'm2', 'm3'];

describe('static: additive only', () => {
  it.each(ALL)('%s migration has no DROP / TRUNCATE / DELETE / mass UPDATE on existing tables', (k) => {
    const sql = readSql(MIGRATIONS[k]).replace(/--.*$/gm, '');
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN|CONSTRAINT|FUNCTION|VIEW)\b/i);
    // DML lives only inside the new RPC bodies (on the new tables), never at top level
    const topLevel = sql.replace(/\$function\$[\s\S]*?\$function\$/g, '');
    expect(topLevel).not.toMatch(/^\s*DELETE\s+FROM/im);
    expect(topLevel).not.toMatch(/^\s*UPDATE\s/im);
    // ALTER TABLE only targets the new courier tables
    for (const m of sql.matchAll(/ALTER TABLE\s+(?:ONLY\s+)?public\.(\w+)/gi)) {
      expect(['couriers', 'messenger_payment_types', 'courier_margin_settings', 'delivery_assignments', 'courier_accruals', 'courier_payments'])
        .toContain(m[1]);
    }
    // triggers / policies are created or dropped only on the new tables, plus the one non-blocking delivery trigger
    for (const m of sql.matchAll(/(?:DROP|CREATE)\s+(?:TRIGGER|POLICY)\s+(?:IF EXISTS\s+)?(?!IF\b)(\w+)[\s\S]*?\bON\s+public\.(\w+)/gi)) {
      const [, name, table] = m;
      const own = ['couriers', 'messenger_payment_types', 'courier_margin_settings', 'delivery_assignments', 'courier_accruals', 'courier_payments'];
      expect(own.includes(table) || (['orders', 'remittances'].includes(table) && name === 'courier_accrual_on_delivered'), `${name} on ${table}`).toBe(true);
    }
    // the only existing tables that gain objects are orders / remittances, and only the two non-blocking triggers
    expect(sql).not.toMatch(/ALTER TABLE public\.(orders|remittances|order_items|financial_audit_log)\b/i);
  });
  it.each(ALL)('%s migration is idempotent by construction', (k) => {
    const sql = readSql(MIGRATIONS[k]);
    expect(sql).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/);
    expect(sql).not.toMatch(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/);
    expect(sql).not.toMatch(/CREATE FUNCTION/);
  });
});

describeDb('data safety on realistic rows (local Postgres)', () => {
  let admin;
  let actors;
  let kit;
  let typeId;

  const fingerprint = async () => {
    const out = {};
    for (const t of EXISTING) {
      const { rows } = await admin.query(
        `SELECT count(*)::int AS n, md5(COALESCE(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM public.${t} x`);
      out[t] = rows[0];
    }
    return out;
  };

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
    kit = makeKit(admin, actors);
    typeId = await kit.seedType();
    const zone = await kit.seedZone('4.00');
    // realistic sample: remittances in several states (with zone snapshots) and orders with items
    for (const status of ['payment_pending', 'processing', 'delivered', 'completed', 'cancelled']) {
      await kit.seedRemittance({ typeId, status, zoneId: status === 'processing' ? zone : null, deliveryCost: status === 'processing' ? 15 : 0 });
    }
    const { seedOrder, seedProduct } = await import('./fixtures');
    const tracker = { products: [], combos: [], orders: [] };
    const p = await seedProduct(admin, actors, tracker, { quantity: 50 });
    for (const status of ['pending', 'processing', 'dispatched', 'delivered']) {
      await seedOrder(admin, actors, tracker, [{ type: 'product', id: p.productId, quantity: 2 }], { status, paymentStatus: 'validated', stockManaged: false });
    }
    kit.extra = { tracker, product: p };
  });
  afterAll(async () => {
    const { cleanup } = await import('./fixtures');
    await cleanup(admin, kit.extra.tracker);
    await kit.cleanup();
    await endAll([admin]);
  });

  it('re-applying every migration (idempotency) leaves counts and checksums of existing tables unchanged', async () => {
    const before = await fingerprint();
    let during;
    await admin.query('BEGIN');
    try {
      for (const k of ALL) await admin.query(strip(readSql(MIGRATIONS[k])));
      during = await fingerprint(); // measured inside the transaction, then discarded
    } finally {
      await admin.query('ROLLBACK');
    }
    expect(during).toEqual(before);
    expect(await fingerprint()).toEqual(before);
  });

  it('rolling back M3 -> M2 -> M1 and re-applying M1 -> M3 leaves existing data untouched and restores the objects', async () => {
    const before = await fingerprint();
    await admin.query('BEGIN');
    let during;
    try {
      await admin.query(`SET LOCAL app.confirm_courier_rollback = 'yes'`);
      for (const k of [...ALL].reverse()) await admin.query(strip(readSql(ROLLBACKS[k])));
      const gone = (await admin.query(`SELECT to_regclass('public.courier_accruals') IS NULL AS g`)).rows[0].g;
      expect(gone).toBe(true);
      for (const k of ALL) await admin.query(strip(readSql(MIGRATIONS[k])));
      expect((await admin.query(`SELECT to_regclass('public.courier_accruals') IS NOT NULL AS b`)).rows[0].b).toBe(true);
      during = await fingerprint();
    } finally {
      await admin.query('ROLLBACK');
    }
    expect(during).toEqual(before);
    expect(await fingerprint()).toEqual(before);
  });

  it('delivering with the triggers in place changes only the delivery itself (+ the new accrual)', async () => {
    const id = await kit.seedRemittance({ typeId });
    const orderId = await kit.seedDispatchedOrder();
    const snap = async () => ({
      rem: (await admin.query('SELECT * FROM public.remittances WHERE id = $1', [id])).rows[0],
      ord: (await admin.query('SELECT * FROM public.orders WHERE id = $1', [orderId])).rows[0]
    });
    const before = await snap();
    await kit.deliverRemittance(id);
    await kit.deliverOrder(orderId);
    const after = await snap();
    const diff = (a, b) => Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).sort();
    expect(diff(before.rem, after.rem).filter((k) => !['status', 'delivered_at', 'delivery_proof_url', 'updated_at', 'delivered_by'].includes(k))).toEqual([]);
    expect(diff(before.rem, after.rem)).toEqual(expect.arrayContaining(['status', 'delivered_at']));
    // money columns and everything the customer sees are untouched
    for (const k of ['amount_sent', 'commission_total', 'amount_to_deliver', 'exchange_rate', 'delivery_cost']) expect(after.rem[k]).toBe(before.rem[k]);
    for (const k of ['subtotal', 'total_amount', 'shipping_cost']) expect(after.ord[k]).toBe(before.ord[k]);
    expect((await kit.accruals(id)).length).toBe(1);
    expect((await kit.accruals(orderId)).length).toBe(1);
  });
});
