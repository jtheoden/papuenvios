/**
 * Production-data safety of the refund audit/proof migrations 20261029110000..110500.
 *  1. Static: nothing rewrites rows of existing tables, nothing existing is altered, every function is NEW (none replaced).
 *  2. Dynamic: with the migrations rolled back, realistic data is loaded (orders, remittances, histories, refund requests that
 *     already exist); the migrations are applied; counts and checksums of every pre-existing table are identical, the events
 *     table is born EMPTY (no backfill), the existing refund rows are unchanged, and the bodies (prosrc) of the live functions are
 *     byte-identical. The rollback / apply sequence runs in try/finally so the scratch database always ends with the migrations applied.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dbSuiteSkipReason, connectAdmin, connectAs, endAll } from './db';
import { loadActors } from './fixtures';

const MIGRATIONS = [
  '20261029110000_refund_request_events',
  '20261029110100_operation_timeline_trace',
  '20261029110200_refund_metrics_export',
  '20261029110300_refund_proofs_bucket',
  '20261029110400_refund_resolve_with_proof',
  '20261029110500_refund_proof_retention',
  '20261029110600_refund_constants_search_path'
];
const up = (name) => readFileSync(`supabase/migrations/${name}.sql`, 'utf8');
const down = (name) => readFileSync(`supabase/rollbacks/${name}_down.sql`, 'utf8');
const stripped = (sql) =>
  sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

const skipReason = await dbSuiteSkipReason({
  functions: ['is_admin_user', 'order_cancel', 'admin_resolve_refund'],
  tables: ['orders', 'remittances', 'order_items', 'remittance_status_history', 'order_status_history', 'refund_requests']
});
const describeDb = skipReason ? describe.skip : describe;

describe('refund audit migrations are additive (static)', () => {
  const NEW_TABLES = new Set(['refund_requests', 'refund_request_events']);

  it.each(MIGRATIONS)('%s only writes to its own tables', (name) => {
    const sql = stripped(up(name));
    const withoutClauses = sql.replace(/\b(ON|FOR|AFTER|BEFORE|OR)\s+(UPDATE|DELETE|TRUNCATE)\b/gi, '');
    const targets = [...withoutClauses.matchAll(/\b(?:UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+(?:ONLY\s+)?(?:public\.)?(\w+)/gi)].map((m) => m[1]);
    expect(targets.filter((table) => !NEW_TABLES.has(table))).toEqual([]);
    const inserts = [...sql.matchAll(/\bINSERT\s+INTO\s+((?:public|storage)\.\w+)/gi)].map((m) => m[1]);
    // activity_logs: best-effort failure log and the refund_resolved row; storage.buckets: the new bucket (ON CONFLICT DO NOTHING).
    expect(inserts.filter((t) => !['public.refund_request_events', 'public.activity_logs', 'storage.buckets'].includes(t))).toEqual([]);
  });

  it.each(MIGRATIONS)('%s does not ALTER any pre-existing table', (name) => {
    const sql = stripped(up(name));
    const altered = [...sql.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(public\.)?(\w+)/gi)].map((m) => m[2]);
    expect(altered.filter((table) => !NEW_TABLES.has(table))).toEqual([]);
  });

  it('every function is new: none of the live refund/transition functions is replaced', () => {
    const created = MIGRATIONS.flatMap((name) =>
      [...stripped(up(name)).matchAll(/CREATE OR REPLACE FUNCTION\s+public\.(\w+)/gi)].map((m) => m[1])
    );
    const live = new Set([
      'admin_resolve_refund', 'admin_list_refunds', 'admin_refund_counts', 'refund_request_on_cancel', 'refund_request_on_reopen',
      'add_business_days', 'refund_hold_hours', 'refund_business_days', 'get_pending_orders_count', '_order_transition',
      '_remittance_transition', 'audit_order_status_change', 'audit_remittance_status_change', 'order_cancel', 'order_reopen',
      'remittance_cancel', 'admin_set_remittance_commission', 'remittance_accept_commission', 'execute_platform_reset'
    ]);
    expect(created.filter((fn) => live.has(fn))).toEqual([]);
    expect(new Set(created).size).toBe(created.length);
  });

  it('never drops or disables triggers of orders / remittances and creates none on them', () => {
    for (const name of MIGRATIONS) {
      const sql = stripped(up(name));
      expect(sql, name).not.toMatch(/ON\s+(public\.)?(orders|remittances|order_status_history|remittance_status_history)\b/i);
    }
  });

  it.each(MIGRATIONS)('%s has a rollback file', (name) => {
    expect(down(name)).toMatch(/ROLLBACK/i);
  });

  it('20261029110600 only pins the search_path of the two constants (no body is redefined)', () => {
    const sql = stripped(up('20261029110600_refund_constants_search_path'));
    expect(sql).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i);
    const alters = [...sql.matchAll(/ALTER\s+FUNCTION\s+public\.(\w+)\(\)\s+SET\s+search_path\s*=\s*pg_catalog/gi)].map((m) => m[1]).sort();
    expect(alters).toEqual(['refund_business_days', 'refund_hold_hours']);
  });

  it('the export builds its rows under an alias that is not the reserved word ROW', () => {
    expect(stripped(up('20261029110200_refund_metrics_export'))).not.toMatch(/\bAS\s+row\b/i);
  });

  it('the rollback of the events table refuses to run over existing events without an explicit confirmation', () => {
    const sql = down('20261029110000_refund_request_events');
    expect(sql).toMatch(/app\.confirm_refund_rollback/);
    expect(sql.indexOf('app.confirm_refund_rollback')).toBeLessThan(sql.indexOf('DROP TABLE'));
  });

  it('the purge re-checks disputes right before every Storage delete', () => {
    const src = readFileSync('supabase/functions/purge-refund-proofs/index.ts', 'utf8');
    const check = src.indexOf('_refund_dispute_open');
    const remove = src.indexOf('.remove(');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(remove);
  });

  it('no policy on another bucket is touched', () => {
    const sql = stripped(up('20261029110300_refund_proofs_bucket'));
    const policies = [...sql.matchAll(/(?:CREATE|DROP)\s+POLICY\s+(?:IF EXISTS\s+)?"([^"]+)"/gi)].map((m) => m[1]);
    expect(policies.every((p) => /refund proofs/i.test(p))).toBe(true);
  });
});

describeDb('refund audit migrations on realistic data (dynamic)', () => {
  let admin;
  let actors;
  let typeId;
  const orderIds = [];
  const remittanceIds = [];
  const refundIds = [];

  const TABLES = ['orders', 'order_items', 'order_status_history', 'remittances', 'remittance_status_history'];
  const LIVE_FUNCTIONS = [
    'admin_resolve_refund', 'admin_list_refunds', 'admin_refund_counts', 'refund_request_on_cancel', 'refund_request_on_reopen',
    '_order_transition', '_remittance_transition', 'audit_order_status_change', 'audit_remittance_status_change',
    'order_cancel', 'remittance_cancel', 'execute_platform_reset', 'refund_hold_hours', 'refund_business_days', 'add_business_days'
  ];
  const ORIGINAL_REFUND_COLUMNS = `ARRAY['proof_path','proof_sha256','proof_expires_at','proof_purged_at','self_resolved']`;

  const snapshot = async () => {
    const out = {};
    for (const table of TABLES) {
      const { rows } = await admin.query(
        `SELECT count(*)::int AS n, coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '') AS sum FROM public.${table} t`
      );
      out[table] = rows[0];
    }
    const refunds = await admin.query(
      `SELECT count(*)::int AS n,
              coalesce(md5(string_agg(((to_jsonb(r) - ${ORIGINAL_REFUND_COLUMNS}::text[]))::text, '|' ORDER BY r.id)), '') AS sum
         FROM public.refund_requests r`
    );
    out.refund_requests = refunds.rows[0];
    const bodies = await admin.query(
      `SELECT proname, md5(prosrc) AS sum FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = ANY($1) ORDER BY 1, 2`,
      [LIVE_FUNCTIONS]
    );
    out.function_bodies = bodies.rows;
    const triggers = await admin.query(
      `SELECT c.relname, t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE NOT t.tgisinternal AND c.relname IN ('orders', 'remittances', 'order_status_history', 'remittance_status_history')
        ORDER BY 1, 2`
    );
    out.triggers = triggers.rows;
    return out;
  };

  const seedOrder = async (status, paymentStatus, total) => {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO public.orders (id, user_id, order_type, status, subtotal, total_amount, currency_id, payment_status,
                                  payment_method, stock_managed, order_number, payer_phone, payment_reference)
       VALUES ($1, $2, 'product', $3, $4, $4, $5, $6, 'zelle', false, $7, '+13055550100', 'REF-' || $8)`,
      [id, actors.customerId, status, total, actors.currencyId, paymentStatus, `SAF2-${id.slice(0, 12)}`, id.slice(0, 6)]
    );
    await admin.query(
      `INSERT INTO public.order_items (order_id, item_type, item_id, item_name_es, item_name_en, quantity, unit_price, total_price)
       VALUES ($1, 'product', $2, 'x', 'x', 2, $3, $4)`,
      [id, randomUUID(), total / 2, total]
    );
    orderIds.push(id);
    return id;
  };
  const seedRemittance = async (status) => {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO public.remittances (id, user_id, remittance_type_id, amount_sent, exchange_rate, commission_percentage,
         commission_fixed, commission_total, amount_to_deliver, currency_sent, currency_delivered, recipient_name,
         recipient_phone, status)
       VALUES ($1,$2,$3,100,800,2.5,0,2.5,78000,'USD','CUP','Rcpt','+5355550100',$4)`,
      [id, actors.customerId, typeId, status]
    );
    remittanceIds.push(id);
    return id;
  };
  const seedRefund = async (orderId) => {
    const { rows } = await admin.query(
      `INSERT INTO public.refund_requests (order_id, user_id, payment_evidence, amount, payment_method, cancelled_at, eligible_at, due_at)
       VALUES ($1, $2, 'validated', 20, 'zelle', now() - interval '3 days', now() - interval '1 day', now() + interval '4 days') RETURNING id`,
      [orderId, actors.customerId]
    );
    refundIds.push(rows[0].id);
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
    if (refundIds.length) await admin.query('DELETE FROM public.refund_requests WHERE id = ANY($1)', [refundIds]);
    if (remittanceIds.length) {
      await admin.query('DELETE FROM public.remittance_status_history WHERE remittance_id = ANY($1)', [remittanceIds]);
      await admin.query('DELETE FROM public.remittances WHERE id = ANY($1)', [remittanceIds]);
    }
    if (orderIds.length) await admin.query('DELETE FROM public.orders WHERE id = ANY($1)', [orderIds]);
    await admin.query('DELETE FROM public.remittance_types WHERE id = $1', [typeId]);
    await endAll([admin]);
  });

  it('applying changes no existing row, backfills no event, replaces no live function body, adds no trigger to orders/remittances', async () => {
    let before;
    let after;
    let eventsAfterApply;
    let schemaAfterApply;
    try {
      // 1. Production-like state: the R5 migrations are not there (R4 stays).
      await admin.query("SET app.confirm_refund_rollback = 'yes'");
      for (const name of [...MIGRATIONS].reverse()) await admin.query(down(name));
      await admin.query('RESET app.confirm_refund_rollback');
      expect((await admin.query(`SELECT to_regclass('public.refund_request_events') AS t`)).rows[0].t).toBeNull();

      // 2. Realistic data, including refund requests that ALREADY exist (the case a backfill would target).
      for (let i = 0; i < 12; i += 1) await seedOrder('pending', 'pending', 10 + i);
      const paid = [];
      for (let i = 0; i < 4; i += 1) paid.push(await seedOrder('cancelled', 'rejected', 40 + i));
      for (const id of paid.slice(0, 3)) await seedRefund(id);
      for (const status of ['payment_pending', 'payment_proof_uploaded', 'payment_validated', 'processing', 'completed', 'cancelled']) {
        await seedRemittance(status);
      }
      before = await snapshot();
      expect(before.refund_requests.n).toBeGreaterThanOrEqual(3);

      // 3. Apply every migration, in order.
      for (const name of MIGRATIONS) await admin.query(up(name));
      after = await snapshot();
      eventsAfterApply = (await admin.query('SELECT count(*)::int AS n FROM public.refund_request_events')).rows[0].n;
      schemaAfterApply = (
        await admin.query(
          `SELECT (SELECT count(*)::int FROM public.refund_requests WHERE proof_path IS NOT NULL OR proof_purged_at IS NOT NULL OR self_resolved) AS touched`
        )
      ).rows[0].touched;
    } finally {
      // Whatever happened, leave the scratch database with the migrations applied (idempotent files).
      for (const name of MIGRATIONS) await admin.query(up(name));
    }

    expect(after).toEqual(before);
    expect(eventsAfterApply).toBe(0);
    expect(schemaAfterApply).toBe(0);
  });

  it('rolling the migrations back and forward again keeps the existing refund rows intact and the events empty', async () => {
    const orderId = await seedOrder('cancelled', 'rejected', 77);
    await seedRefund(orderId);
    const rows = async () =>
      (await admin.query(`SELECT md5(string_agg(((to_jsonb(r) - ${ORIGINAL_REFUND_COLUMNS}::text[]))::text, '|' ORDER BY r.id)) AS s FROM public.refund_requests r`)).rows[0].s;
    const before = await rows();
    try {
      await admin.query("SET app.confirm_refund_rollback = 'yes'");
      for (const name of [...MIGRATIONS].reverse()) await admin.query(down(name));
      await admin.query('RESET app.confirm_refund_rollback');
      expect(await rows()).toBe(before);
    } finally {
      for (const name of MIGRATIONS) await admin.query(up(name));
    }
    expect(await rows()).toBe(before);
    expect((await admin.query('SELECT count(*)::int AS n FROM public.refund_request_events')).rows[0].n).toBe(0);
  });

  it('the events rollback aborts (and changes nothing) when events exist and no confirmation is given', async () => {
    const orderId = await seedOrder('pending', 'proof_uploaded', 21);
    const ownerClient = await connectAs(actors.customerId);
    try {
      await ownerClient.query('SELECT * FROM public.order_cancel($1, $2)', [orderId, 'changed my mind']);
    } finally {
      await ownerClient.end();
    }
    const events = async () => (await admin.query('SELECT count(*)::int AS n FROM public.refund_request_events')).rows[0].n;
    const before = await events();
    expect(before).toBeGreaterThan(0);
    // The later migrations are rolled back first (they allow it); the events one must refuse.
    for (const name of [...MIGRATIONS].reverse().filter((n) => !n.startsWith('20261029110000'))) await admin.query(down(name));
    let refused = null;
    try {
      await admin.query(down('20261029110000_refund_request_events'));
    } catch (error) {
      refused = error;
      await admin.query('ROLLBACK');
    }
    try {
      expect(refused?.message).toMatch(/refund_request_events/);
      expect(await events()).toBe(before);
      expect((await admin.query(`SELECT to_regclass('public.refund_request_events') AS t`)).rows[0].t).not.toBeNull();
    } finally {
      for (const name of MIGRATIONS.filter((n) => !n.startsWith('20261029110000'))) await admin.query(up(name));
    }
  });

  it('the constants keep their bodies and now run with a pinned search_path', async () => {
    const { rows } = await admin.query(
      `SELECT proname, prosrc, proconfig FROM pg_proc WHERE pronamespace = 'public'::regnamespace
        AND proname IN ('refund_hold_hours', 'refund_business_days') ORDER BY 1`
    );
    expect(rows.map((r) => [r.proname, r.prosrc.trim()])).toEqual([
      ['refund_business_days', 'SELECT 5'],
      ['refund_hold_hours', 'SELECT 48']
    ]);
    for (const r of rows) expect(r.proconfig).toContain('search_path=pg_catalog');
  });
});
