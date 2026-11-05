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
  'remittance_status_history', 'courier_accruals', 'messenger_payment_types'];
const strip = (sql) => sql.replace(/^\s*(BEGIN|COMMIT);\s*$/gm, '');
const ALL = ['m1', 'm2', 'm3'];
// phase A alters messenger_payment_types (a module table, empty in production): it is checked on its own, then chained;
// phase B (subscriptions) goes on top of A and is rolled back first
const CHAIN = [...ALL, 'a', 'b'];

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
  it('phase A only alters messenger_payment_types (+ the production-drift exchange_rates.rate_type): ADD COLUMN IF NOT EXISTS and named CHECKs, no DROP of data objects', () => {
    const sql = readSql(MIGRATIONS.a).replace(/--.*$/gm, '');
    expect(sql).toMatch(/^BEGIN;/m);
    expect(sql).toMatch(/SET LOCAL lock_timeout = '5s'/);
    expect(sql.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN|FUNCTION|VIEW|TRIGGER|POLICY)\b/i);
    const topLevel = sql.replace(/\$function\$[\s\S]*?\$function\$/g, '');
    expect(topLevel).not.toMatch(/^\s*(DELETE\s+FROM|UPDATE\s|INSERT\s+INTO)/im);
    const alters = [...sql.matchAll(/ALTER TABLE\s+(?:ONLY\s+)?public\.(\w+)\s+([^;]*);/gi)];
    for (const m of alters.filter((a) => a[1] !== 'messenger_payment_types')) {
      expect(m[1]).toBe('exchange_rates');
      expect(m[2]).toMatch(/^ADD COLUMN IF NOT EXISTS rate_type text DEFAULT 'general' CHECK \(rate_type IN \('general', 'orders', 'remittances'\)\)$/);
    }
    expect(alters.filter((a) => a[1] === 'exchange_rates')).toHaveLength(1);
    for (const m of sql.matchAll(/DROP CONSTRAINT IF EXISTS (\w+)/gi)) expect(m[1]).toMatch(/^messenger_payment_types_\w+_chk$|^messenger_payment_types_method_check$/);
    for (const m of sql.matchAll(/ADD COLUMN (\w+ )?(\w+)/gi)) expect(m[1]).toBe('IF ');
    expect(sql).not.toMatch(/CREATE FUNCTION/);
    expect(sql).not.toMatch(/FUNCTION public\._(order|remittance)_transition/);
    // v1 is closed, never dropped nor replaced (the rollback re-grants it)
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.admin_set_messenger_payment_type\(/);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.admin_set_messenger_payment_type\(/);
    // the live rate is read from exchange_rates, never through the fail-open helpers
    expect(sql).not.toMatch(/get_(order|market)_exchange_rate/);
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
      for (const k of CHAIN) await admin.query(strip(readSql(MIGRATIONS[k])));
      during = await fingerprint(); // measured inside the transaction, then discarded
    } finally {
      await admin.query('ROLLBACK');
    }
    expect(during).toEqual(before);
    expect(await fingerprint()).toEqual(before);
  });

  it('rolling back B -> A -> M3 -> M2 -> M1 and re-applying M1 -> B leaves existing data untouched and restores the objects', async () => {
    const before = await fingerprint();
    await admin.query('BEGIN');
    let during;
    try {
      await admin.query(`SET LOCAL app.confirm_courier_rollback = 'yes'`);
      for (const k of [...CHAIN].reverse()) await admin.query(strip(readSql(ROLLBACKS[k])));
      const gone = (await admin.query(`SELECT to_regclass('public.courier_accruals') IS NULL AS g`)).rows[0].g;
      expect(gone).toBe(true);
      for (const k of CHAIN) await admin.query(strip(readSql(MIGRATIONS[k])));
      expect((await admin.query(`SELECT to_regclass('public.courier_accruals') IS NOT NULL AS b`)).rows[0].b).toBe(true);
      during = await fingerprint();
    } finally {
      await admin.query('ROLLBACK');
    }
    expect(during).toEqual(before);
    expect(await fingerprint()).toEqual(before);
  });

  it('phase A over existing no_rule accruals: re-apply, rollback and re-apply leave them (and every other table) byte-identical', async () => {
    // production today: 0 payment types, 16 accruals with reason no_rule
    const r = await kit.seedRemittance({ typeId });
    const o = await kit.seedDispatchedOrder();
    await kit.deliverRemittance(r);
    await kit.deliverOrder(o);
    const reasons = (await admin.query(`SELECT rule_snapshot->>'reason' AS reason, amount_cup FROM public.courier_accruals WHERE source_id = ANY($1) ORDER BY source_kind`, [[r, o]])).rows;
    expect(reasons).toEqual([{ reason: 'no_rule', amount_cup: null }, { reason: 'no_rule', amount_cup: null }]);
    const before = await fingerprint();
    await admin.query('BEGIN');
    let during;
    try {
      await admin.query(strip(readSql(MIGRATIONS.a)));
      await admin.query(strip(readSql(ROLLBACKS.a)));
      const cols = (await admin.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'messenger_payment_types' AND column_name IN ('currency','fixed_amount')`)).rows[0].n;
      expect(cols).toBe(0);
      // production had exchange_rates.rate_type before phase A: the rollback must never drop it
      expect((await admin.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'exchange_rates' AND column_name = 'rate_type'`)).rows[0].n).toBe(1);
      expect((await admin.query(`SELECT to_regprocedure('public._courier_rule_resolve_v2(text,uuid,uuid,uuid,numeric,text,numeric,timestamptz)') IS NULL AS g`)).rows[0].g).toBe(true);
      expect((await admin.query(`SELECT has_function_privilege('authenticated', 'public.admin_set_messenger_payment_type(text,text,text,text,numeric,numeric,numeric,text,uuid,uuid,uuid,numeric,numeric,timestamptz,timestamptz)', 'EXECUTE') AS g`)).rows[0].g).toBe(true);
      await admin.query(strip(readSql(MIGRATIONS.a)));
      during = await fingerprint();
    } finally {
      await admin.query('ROLLBACK');
    }
    expect(during).toEqual(before);
    expect(await fingerprint()).toEqual(before);
  });

  it('the phase A rollback refuses to run while phase B is applied (its down file goes first)', async () => {
    await admin.query('BEGIN');
    try {
      await admin.query('CREATE TABLE public.courier_payment_type_subscriptions (id int)');
      const e = await admin.query(strip(readSql(ROLLBACKS.a))).then(() => null, (err) => err);
      expect(e?.code).toBe('55000');
      expect(e?.message).toMatch(/phase B/);
    } finally {
      await admin.query('ROLLBACK');
    }
  });

  it('the phase A rollback refuses to run once a rule depends on it (fixed_amount, CUP currency, percent on orders)', async () => {
    const c = await kit.as(actors.adminId);
    const { wipeTable } = await import('./courierTestKit');
    for (const rule of [
      { method: 'fixed_amount', fixed_cup: null, fixed_amount: 1 },
      { currency: 'CUP' },
      { applies_to: 'order', method: 'percent_of_base', fixed_cup: null, percent: 1, base: 'nominal_usd' }
    ]) {
      await wipeTable(admin, 'messenger_payment_types', 'messenger_payment_types_guard');
      await kit.setRule(c, rule);
      await admin.query('BEGIN');
      try {
        const e = await admin.query(strip(readSql(ROLLBACKS.a))).then(() => null, (err) => err);
        expect(e?.code, JSON.stringify(rule)).toBe('55000');
      } finally {
        await admin.query('ROLLBACK');
      }
    }
    await wipeTable(admin, 'messenger_payment_types', 'messenger_payment_types_guard');
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
