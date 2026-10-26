/**
 * Production-data safety of the refunds migrations 20261029100000..100400.
 *  1. Static: nothing in them rewrites existing rows (no UPDATE / DELETE / INSERT / TRUNCATE) or alters existing tables.
 *  2. Dynamic: with the migrations rolled back, realistic data is loaded (orders, items, remittances, history, already
 *     cancelled operations); the migrations are applied; counts and checksums of every existing table are identical, no
 *     refund row appears (no backfill), and the existing flows keep returning the same results.
 *  The rollback / apply sequence runs inside try/finally so the scratch database always ends with the migrations applied.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dbSuiteSkipReason, connectAdmin, connectAs, endAll } from './db';
import { loadActors } from './fixtures';

const MIGRATIONS = [
  '20261029100000_refund_requests_table',
  '20261029100100_add_business_days',
  '20261029100200_refund_triggers',
  '20261029100300_refund_rpcs',
  '20261029100400_fix_pending_orders_count_cancelled'
];
const up = (name) => readFileSync(`supabase/migrations/${name}.sql`, 'utf8');
const down = (name) => readFileSync(`supabase/rollbacks/${name}_down.sql`, 'utf8');

const skipReason = await dbSuiteSkipReason({
  functions: ['is_admin_user', 'order_cancel'],
  tables: ['orders', 'remittances', 'order_items', 'remittance_status_history', 'order_status_history']
});
const describeDb = skipReason ? describe.skip : describe;

describe('refund migrations are additive (static)', () => {
  const stripped = (sql) =>
    sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');

  it.each(MIGRATIONS)('%s never rewrites or deletes existing rows', (name) => {
    const sql = stripped(up(name));
    // UPDATE / DELETE / TRUNCATE may only target refund_requests (the table this feature creates).
    const withoutClauses = sql.replace(/\b(ON|FOR|AFTER|BEFORE|OR)\s+(UPDATE|DELETE)\b/gi, '');
    const targets = [...withoutClauses.matchAll(/\b(?:UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+(?:ONLY\s+)?(?:public\.)?(\w+)/gi)].map((m) => m[1]);
    expect(targets.filter((table) => table !== 'refund_requests')).toEqual([]);
    expect(sql).not.toMatch(/\bINSERT\s+INTO\s+public\.(orders|remittances|order_items|order_status_history|remittance_status_history|user_profiles)\b/i);
  });

  it.each(MIGRATIONS)('%s does not ALTER any existing table', (name) => {
    const sql = stripped(up(name));
    const altered = [...sql.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(public\.)?(\w+)/gi)].map((m) => m[2]);
    expect(altered.filter((table) => table !== 'refund_requests')).toEqual([]);
  });

  it('the only pre-existing function replaced is get_pending_orders_count', () => {
    const replaced = MIGRATIONS.flatMap((name) =>
      [...stripped(up(name)).matchAll(/CREATE OR REPLACE FUNCTION\s+public\.(\w+)/gi)].map((m) => m[1])
    );
    const created = new Set([
      'add_business_days',
      'refund_hold_hours',
      'refund_business_days',
      'refund_request_on_cancel',
      'refund_request_on_reopen',
      'admin_list_refunds',
      'admin_refund_counts',
      'admin_resolve_refund',
      'get_pending_orders_count'
    ]);
    expect(replaced.filter((fn) => !created.has(fn))).toEqual([]);
  });
});

describeDb('refund migrations on realistic data (dynamic)', () => {
  let admin;
  let actors;
  let typeId;
  const client = [];
  const orderIds = [];
  const remittanceIds = [];

  const TABLES = ['orders', 'order_items', 'order_status_history', 'remittances', 'remittance_status_history'];
  const snapshot = async () => {
    const out = {};
    for (const table of TABLES) {
      const { rows } = await admin.query(
        `SELECT count(*)::int AS n, coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '') AS sum FROM public.${table} t`
      );
      out[table] = rows[0];
    }
    return out;
  };

  const seedOrder = async (status, paymentStatus, total) => {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO public.orders (id, user_id, order_type, status, subtotal, total_amount, currency_id, payment_status,
                                  payment_method, stock_managed, order_number, payer_phone, payment_reference)
       VALUES ($1, $2, 'product', $3, $4, $4, $5, $6, 'zelle', false, $7, '+13055550100', 'REF-' || $8)`,
      [id, actors.customerId, status, total, actors.currencyId, paymentStatus, `SAF-${id.slice(0, 13)}`, id.slice(0, 6)]
    );
    await admin.query(
      `INSERT INTO public.order_items (order_id, item_type, item_id, item_name_es, item_name_en, quantity, unit_price, total_price)
       VALUES ($1, 'product', $2, 'x', 'x', 2, $3, $4)`,
      [id, randomUUID(), total / 2, total]
    );
    orderIds.push(id);
    return id;
  };

  const seedRemittance = async (status, extra = {}) => {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO public.remittances (id, user_id, remittance_type_id, amount_sent, exchange_rate, commission_percentage,
         commission_fixed, commission_total, amount_to_deliver, currency_sent, currency_delivered, recipient_name,
         recipient_phone, status, payment_validated_at, cancelled_at, cancellation_reason)
       VALUES ($1,$2,$3,$4,800,2.5,0,2.5,$5,'USD','CUP','Rcpt','+5355550100',$6,$7,$8,$9)`,
      [id, actors.customerId, typeId, extra.amount ?? 100, (extra.amount ?? 100) * 780, status, extra.validatedAt ?? null, extra.cancelledAt ?? null, extra.reason ?? null]
    );
    remittanceIds.push(id);
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
  afterAll(async () => {
    await endAll(client);
    if (remittanceIds.length) {
      await admin.query('DELETE FROM public.remittance_status_history WHERE remittance_id = ANY($1)', [remittanceIds]);
      await admin.query('DELETE FROM public.remittances WHERE id = ANY($1)', [remittanceIds]);
    }
    if (orderIds.length) await admin.query('DELETE FROM public.orders WHERE id = ANY($1)', [orderIds]);
    await admin.query('DELETE FROM public.remittance_types WHERE id = $1', [typeId]);
    await admin.end();
  });

  it('applying the migrations changes no existing row, creates no refund (no backfill) and leaves the flows working', async () => {
    let before;
    let after;
    let refundRowsAfterApply;
    try {
      // 1. Production-like state: the migrations are not there.
      for (const name of [...MIGRATIONS].reverse()) await admin.query(down(name));
      expect((await admin.query(`SELECT to_regclass('public.refund_requests') AS t`)).rows[0].t).toBeNull();

      // 2. Realistic data, including operations ALREADY cancelled after being paid (the case a backfill would target).
      for (let i = 0; i < 20; i += 1) await seedOrder('pending', 'pending', 10 + i);
      for (let i = 0; i < 6; i += 1) await seedOrder('pending', 'proof_uploaded', 40 + i);
      for (let i = 0; i < 6; i += 1) await seedOrder('processing', 'validated', 80 + i);
      for (let i = 0; i < 4; i += 1) await seedOrder('completed', 'validated', 120 + i);
      await seedOrder('cancelled', 'validated', 55);
      await seedOrder('cancelled', 'rejected', 25);
      for (const status of ['payment_pending', 'payment_proof_uploaded', 'payment_validated', 'processing', 'completed']) {
        for (let i = 0; i < 3; i += 1) await seedRemittance(status, { validatedAt: ['payment_pending', 'payment_proof_uploaded'].includes(status) ? null : new Date().toISOString() });
      }
      await seedRemittance('cancelled', { cancelledAt: new Date().toISOString(), reason: 'old cancellation' });

      before = await snapshot();
      const pendingBefore = await admin.query('SELECT public.get_pending_orders_count() AS n');
      // The one intended change: cancelled orders whose payment_status is still 'pending' stop counting as pending.
      const staleCancelled = (
        await admin.query(`SELECT count(*)::int AS n FROM public.orders WHERE status = 'cancelled' AND payment_status = 'pending'`)
      ).rows[0].n;
      expect(before.orders.n).toBeGreaterThan(0);

      // 3. Apply every migration, in order.
      for (const name of MIGRATIONS) await admin.query(up(name));
      after = await snapshot();
      refundRowsAfterApply = (await admin.query('SELECT count(*)::int AS n FROM public.refund_requests')).rows[0].n;
      const pendingAfter = await admin.query('SELECT public.get_pending_orders_count() AS n');
      expect(pendingAfter.rows[0].n).toBe(pendingBefore.rows[0].n - staleCancelled);
    } finally {
      // Whatever happened, leave the scratch database with the migrations applied (idempotent files).
      for (const name of MIGRATIONS) await admin.query(up(name));
    }

    expect(after).toEqual(before);
    expect(refundRowsAfterApply).toBe(0);
  });

  it('after applying, cancelling existing operations behaves as before: same final rows, plus a refund request when paid', async () => {
    const paid = await seedOrder('pending', 'proof_uploaded', 33);
    const unpaid = await seedOrder('pending', 'pending', 12);
    const rem = await seedRemittance('payment_proof_uploaded');
    const owner = await connectAs(actors.customerId);
    client.push(owner);
    for (const id of [paid, unpaid]) {
      const { rows } = await owner.query('SELECT * FROM public.order_cancel($1, $2)', [id, 'changed my mind']);
      expect(rows[0].status).toBe('cancelled');
    }
    const r = await owner.query('SELECT * FROM public.remittance_cancel($1, $2)', [rem, 'changed my mind']);
    expect(r.rows[0].status).toBe('cancelled');
    const refunds = await admin.query('SELECT order_id, remittance_id FROM public.refund_requests WHERE order_id = ANY($1) OR remittance_id = $2', [[paid, unpaid], rem]);
    expect(refunds.rows.map((x) => x.order_id ?? x.remittance_id).sort()).toEqual([paid, rem].sort());
  });
});
