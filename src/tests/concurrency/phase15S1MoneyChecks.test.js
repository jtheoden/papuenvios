/**
 * Phase 1.5 / S1: arithmetic money CHECK constraints on orders and remittances
 * (supabase/migrations/20261017100000_phase15_s1_money_checks.sql). Local Postgres only.
 *
 * Attacks closed (audit_phase1_price_tamper.md, matrix): T-02 (negative / tiny / inconsistent order
 * totals, negative or oversized discount, NULL in a nullable money column), T-07/T-09 arithmetic part
 * (non-positive amounts and rates, negative commissions) and the negative discount of a remittance.
 * The CHECKs apply to EVERY writer (postgres included), so these tests insert as the superuser to keep
 * the INSERT triggers out of the picture.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { dbSuiteSkipReason, connectAdmin, connectAs, endAll } from './db';
import { loadActors } from './fixtures';

const skipReason = await dbSuiteSkipReason({ tables: ['orders', 'remittances', 'remittance_types', 'currencies'] });
const describeDb = skipReason ? describe.skip : describe;

const MIGRATION = 'supabase/migrations/20261017100000_phase15_s1_money_checks.sql';
const ORDER_CHECKS = [
  'orders_money_total_positive_chk',
  'orders_money_subtotal_positive_chk',
  'orders_money_tax_nonneg_chk',
  'orders_money_shipping_nonneg_chk',
  'orders_money_discount_range_chk',
  'orders_money_total_identity_chk'
];
const REMITTANCE_CHECKS = [
  'remittances_money_amount_sent_positive_chk',
  'remittances_money_amount_to_deliver_positive_chk',
  'remittances_money_rate_positive_chk',
  'remittances_money_commission_total_nonneg_chk',
  'remittances_money_commission_fixed_nonneg_chk',
  'remittances_money_commission_pct_range_chk',
  'remittances_money_discount_nonneg_chk'
];

describeDb('phase 1.5 S1: money CHECK constraints (local Postgres)', () => {
  let admin;
  let actors;
  let usdId;
  let typeId;
  const orderIds = [];
  const remittanceIds = [];
  const clients = [];

  const insertOrder = async (client, o = {}) => {
    const v = { subtotal: 100, discount: 0, shipping: 5, tax: 0, total: 105, ...o };
    const res = await client.query(
      `INSERT INTO public.orders (user_id, order_type, subtotal, discount_amount, shipping_cost, tax_amount, total_amount, currency_id, payment_method)
       VALUES ($1, 'product', $2, $3, $4, $5, $6, $7, 'zelle') RETURNING id`,
      [actors.customerId, v.subtotal, v.discount, v.shipping, v.tax, v.total, usdId]
    );
    orderIds.push(res.rows[0].id);
    return res.rows[0].id;
  };

  const insertRemittance = async (client, o = {}) => {
    const v = {
      sent: 100, rate: 800, pct: 2.5, fixed: 0, comm: 2.5, deliver: 78000, discount: 0,
      ...o
    };
    const res = await client.query(
      `INSERT INTO public.remittances (user_id, remittance_type_id, amount_sent, exchange_rate, commission_percentage,
         commission_fixed, commission_total, amount_to_deliver, currency_sent, currency_delivered, recipient_name,
         recipient_phone, discount_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'USD','CUP','Rcpt','+5355550100',$9) RETURNING id`,
      [actors.customerId, typeId, v.sent, v.rate, v.pct, v.fixed, v.comm, v.deliver, v.discount]
    );
    remittanceIds.push(res.rows[0].id);
    return res.rows[0].id;
  };

  // PostgreSQL evaluates CHECKs in constraint-name order and reports the first one that fails, so a row that
  // violates several (e.g. a negative total also breaks the identity) is accepted under any of the names given.
  const rejects = async (promise, ...constraints) => {
    const error = await promise.then(() => null, (e) => e);
    expect(error, 'the statement must be rejected').not.toBeNull();
    expect(error.code).toBe('23514');
    expect(constraints).toContain(error.constraint);
  };

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
    usdId = (await admin.query(`SELECT id FROM public.currencies WHERE code = 'USD'`)).rows[0].id;
    typeId = (
      await admin.query(
        `INSERT INTO public.remittance_types (name, currency_code, delivery_currency, exchange_rate, commission_percentage, min_amount, max_amount, delivery_method)
         VALUES ('p15-s1-type', 'USD', 'CUP', 800, 2.5, 20, 3000, 'cash') RETURNING id`
      )
    ).rows[0].id;
  });

  afterEach(async () => {
    await endAll(clients.splice(0));
    if (orderIds.length) await admin.query('DELETE FROM public.orders WHERE id = ANY($1)', [orderIds.splice(0)]);
    if (remittanceIds.length) await admin.query('DELETE FROM public.remittances WHERE id = ANY($1)', [remittanceIds.splice(0)]);
  });

  afterAll(async () => {
    await admin.query('DELETE FROM public.remittance_types WHERE id = $1', [typeId]);
    await admin.end();
  });

  describe('constraints exist, validated, and cover only orders / remittances', () => {
    it('all 13 constraints are present and VALIDATED', async () => {
      const { rows } = await admin.query(
        `SELECT conname, convalidated FROM pg_constraint
          WHERE conname = ANY($1) ORDER BY conname`,
        [[...ORDER_CHECKS, ...REMITTANCE_CHECKS]]
      );
      expect(rows.map((r) => r.conname)).toEqual([...ORDER_CHECKS, ...REMITTANCE_CHECKS].sort());
      expect(rows.every((r) => r.convalidated === true)).toBe(true);
    });

    it('the migration is prepared-not-applied, additive and only ALTERs orders / remittances', () => {
      const sql = readFileSync(resolve(process.cwd(), MIGRATION), 'utf8');
      expect(sql).toMatch(/PREPARED, NOT APPLIED/);
      expect(sql).toMatch(/ROLLBACK/);
      const alters = [...sql.matchAll(/^\s*ALTER TABLE\s+(?:ONLY\s+)?(?:public\.)?(\w+)/gim)].map((m) => m[1]);
      expect(alters.length).toBeGreaterThan(0);
      expect(new Set(alters)).toEqual(new Set(['orders', 'remittances']));
      expect(sql).not.toMatch(/\bDROP\s+TABLE\b|\bDELETE\s+FROM\b|\bTRUNCATE\b|\bUPDATE\s+public\./i);
      expect(sql).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?(FUNCTION|TRIGGER|TABLE)/i);
      expect(sql).not.toMatch(/^\s*ALTER TABLE\s+(?:public\.)?order_items/im);
      for (const name of [...ORDER_CHECKS, ...REMITTANCE_CHECKS]) {
        expect(sql).toContain(`DROP CONSTRAINT IF EXISTS ${name}`);
      }
    });

    it('does not add any constraint to order_items', async () => {
      const { rows } = await admin.query(
        `SELECT conname FROM pg_constraint WHERE conrelid = 'public.order_items'::regclass AND conname LIKE '%money%'`
      );
      expect(rows).toEqual([]);
    });
  });

  describe('orders (T-02)', () => {
    it('accepts the legitimate shapes the client sends', async () => {
      await insertOrder(admin, { subtotal: 100, discount: 0, shipping: 0, tax: 0, total: 100 });
      await insertOrder(admin, { subtotal: 100, discount: 10, shipping: 5, tax: 0, total: 95 });
      await insertOrder(admin, { subtotal: 0.01, discount: 0, shipping: 0, tax: 0, total: 0.01 });
    });

    it('accepts a cent of drift in the total identity (client rounds each component separately)', async () => {
      await insertOrder(admin, { subtotal: 100, discount: 10, shipping: 5, tax: 0, total: 95.01 });
      await insertOrder(admin, { subtotal: 100, discount: 10, shipping: 5, tax: 0, total: 94.99 });
    });

    it('rejects a negative total', async () => {
      await rejects(insertOrder(admin, { subtotal: -50, discount: 0, shipping: 0, tax: 0, total: -50 }), 'orders_money_subtotal_positive_chk', 'orders_money_discount_range_chk');
      await rejects(insertOrder(admin, { subtotal: 50, discount: 0, shipping: 0, tax: 0, total: -50 }), 'orders_money_total_positive_chk', 'orders_money_total_identity_chk');
    });

    it('rejects a zero total and a total far below what the parts add up to (0.01 for a 100 order)', async () => {
      await rejects(insertOrder(admin, { subtotal: 100, discount: 0, shipping: 0, tax: 0, total: 0 }), 'orders_money_total_positive_chk', 'orders_money_total_identity_chk');
      await rejects(insertOrder(admin, { subtotal: 100, discount: 0, shipping: 5, tax: 0, total: 0.01 }), 'orders_money_total_identity_chk');
    });

    it('rejects a total that is two cents off the identity (either direction)', async () => {
      await rejects(insertOrder(admin, { subtotal: 100, discount: 10, shipping: 5, tax: 0, total: 94.97 }), 'orders_money_total_identity_chk');
      await rejects(insertOrder(admin, { subtotal: 100, discount: 10, shipping: 5, tax: 0, total: 95.03 }), 'orders_money_total_identity_chk');
    });

    it('rejects a negative discount (would inflate the total) and a discount above the subtotal', async () => {
      await rejects(insertOrder(admin, { subtotal: 100, discount: -20, shipping: 0, tax: 0, total: 120 }), 'orders_money_discount_range_chk');
      await rejects(insertOrder(admin, { subtotal: 100, discount: 100.01, shipping: 0, tax: 0, total: 5 }), 'orders_money_discount_range_chk');
    });

    it('rejects negative shipping and negative tax', async () => {
      await rejects(insertOrder(admin, { subtotal: 100, discount: 0, shipping: -5, tax: 0, total: 95 }), 'orders_money_shipping_nonneg_chk');
      await rejects(insertOrder(admin, { subtotal: 100, discount: 0, shipping: 0, tax: -5, total: 95 }), 'orders_money_tax_nonneg_chk');
    });

    it('a NULL in a nullable money column neither bypasses the identity nor breaks a consistent order', async () => {
      // tax NULL must count as 0: a total that only adds up with a hidden tax is rejected ...
      await rejects(insertOrder(admin, { subtotal: 100, discount: 0, shipping: 0, tax: null, total: 105 }), 'orders_money_total_identity_chk');
      // ... shipping NULL / discount NULL with a consistent total are plain zeros
      await insertOrder(admin, { subtotal: 100, discount: null, shipping: null, tax: null, total: 100 });
      // a NULL discount cannot hide a discounted total either
      await rejects(insertOrder(admin, { subtotal: 100, discount: null, shipping: 0, tax: 0, total: 1 }), 'orders_money_total_identity_chk');
    });

    it('applies on UPDATE too: staff cannot set a negative total or an inconsistent discount afterwards', async () => {
      const id = await insertOrder(admin);
      await rejects(admin.query('UPDATE public.orders SET total_amount = -1 WHERE id = $1', [id]), 'orders_money_total_positive_chk', 'orders_money_total_identity_chk');
      await rejects(admin.query('UPDATE public.orders SET discount_amount = 90 WHERE id = $1', [id]), 'orders_money_total_identity_chk');
    });

    it('a customer connection is subject to the same CHECKs (authenticated role)', async () => {
      const customer = await connectAs(actors.customerId);
      clients.push(customer);
      await rejects(insertOrder(customer, { subtotal: 100, discount: 0, shipping: 0, tax: 0, total: 0.01 }), 'orders_money_total_identity_chk');
      await insertOrder(customer, { subtotal: 100, discount: 0, shipping: 0, tax: 0, total: 100 });
    });
  });

  describe('remittances (T-07 / T-09 arithmetic part)', () => {
    it('accepts the legitimate shapes the client sends (rate-1 same-currency style and CUP cash)', async () => {
      await insertRemittance(admin);
      await insertRemittance(admin, { sent: 103, rate: 1, pct: 4.76, comm: 3, deliver: 100 });
      await insertRemittance(admin, { sent: 100, comm: 0, pct: 0, deliver: 80000 }); // 100% offer discount => 0 commission
    });

    it.each([
      ['amount_sent = 0', { sent: 0 }, 'remittances_money_amount_sent_positive_chk'],
      ['amount_sent negative', { sent: -5 }, 'remittances_money_amount_sent_positive_chk'],
      ['amount_to_deliver = 0', { deliver: 0 }, 'remittances_money_amount_to_deliver_positive_chk'],
      ['amount_to_deliver negative', { deliver: -1 }, 'remittances_money_amount_to_deliver_positive_chk'],
      ['exchange_rate = 0', { rate: 0 }, 'remittances_money_rate_positive_chk'],
      ['exchange_rate negative', { rate: -800 }, 'remittances_money_rate_positive_chk'],
      ['commission_total negative (inflates the delivery)', { comm: -10 }, 'remittances_money_commission_total_nonneg_chk'],
      ['commission_fixed negative', { fixed: -1 }, 'remittances_money_commission_fixed_nonneg_chk'],
      ['commission_percentage above 100', { pct: 100.01 }, 'remittances_money_commission_pct_range_chk'],
      ['commission_percentage negative', { pct: -0.01 }, 'remittances_money_commission_pct_range_chk'],
      ['discount_amount negative', { discount: -1 }, 'remittances_money_discount_nonneg_chk']
    ])('rejects %s', async (_label, override, constraint) => {
      await rejects(insertRemittance(admin, override), constraint);
    });

    it('a NULL discount_amount is treated as 0 (accepted), not as a bypass of the sign check', async () => {
      await insertRemittance(admin, { discount: null });
    });

    it('applies on UPDATE as well', async () => {
      const id = await insertRemittance(admin);
      await rejects(admin.query('UPDATE public.remittances SET amount_to_deliver = -5 WHERE id = $1', [id]), 'remittances_money_amount_to_deliver_positive_chk');
    });

    it('recalculate_remittance_at_current_rate still works on a valid pending remittance', async () => {
      const customer = await connectAs(actors.customerId);
      clients.push(customer);
      const id = await insertRemittance(admin);
      const { rows } = await customer.query('SELECT * FROM public.recalculate_remittance_at_current_rate($1::uuid)', [id]);
      expect(Number(rows[0].exchange_rate)).toBe(800);
      expect(Number(rows[0].amount_to_deliver)).toBeGreaterThan(0);
    });
  });
});
