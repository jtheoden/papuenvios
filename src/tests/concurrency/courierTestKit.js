/**
 * Shared kit for the courier-management DB suites (courierRules / courierAccruals / courierPaymentsReport).
 * Local scratch Postgres only. Every business value used here is a TEST value: the migrations seed none.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connectAs } from './db';
import { seedOrder } from './fixtures';

export const MIGRATIONS = {
  m1: 'supabase/migrations/20261031100000_couriers_and_payment_types.sql',
  m2: 'supabase/migrations/20261031110000_delivery_assignments_and_accruals.sql',
  m3: 'supabase/migrations/20261031120000_courier_payments_and_report.sql'
};
export const ROLLBACKS = {
  m1: 'supabase/rollbacks/20261031100000_couriers_and_payment_types_down.sql',
  m2: 'supabase/rollbacks/20261031110000_delivery_assignments_and_accruals_down.sql',
  m3: 'supabase/rollbacks/20261031120000_courier_payments_and_report_down.sql'
};

export const failure = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the statement to fail, but it succeeded');
};

export const readSql = (file) => readFileSync(file, 'utf8');

/** Append-only tables: the tests clean them with the guard trigger switched off (owner action, test DB only). */
export const wipeTable = async (admin, table, trigger) => {
  if (trigger) await admin.query(`ALTER TABLE public.${table} DISABLE TRIGGER ${trigger}`);
  try {
    await admin.query(`DELETE FROM public.${table}`);
  } finally {
    if (trigger) await admin.query(`ALTER TABLE public.${table} ENABLE TRIGGER ${trigger}`);
  }
};

export const makeKit = (admin, actors) => {
  const clients = [];
  const tracker = { orders: [], products: [], combos: [] };
  const remittances = [];
  const types = [];
  const zones = [];
  const rates = [];

  const as = async (userId) => {
    const c = await connectAs(userId);
    clients.push(c);
    return c;
  };
  const setRole = (userId, role, enabled = true) =>
    admin.query('UPDATE public.user_profiles SET role = $2, is_enabled = $3 WHERE id = $1', [userId, role, enabled]);
  const restoreActors = async () => {
    await admin.query(`UPDATE public.user_profiles SET role = 'admin', is_enabled = true WHERE id = $1`, [actors.adminId]);
    await admin.query(`UPDATE public.user_profiles SET is_enabled = true WHERE id = $1`, [actors.customerId]);
  };
  const call = async (client, fn, args = []) => {
    const ph = args.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await client.query(`SELECT * FROM public.${fn}(${ph})`, args);
    return rows;
  };

  const seedType = async ({ delivery = 'CUP', sent = 'USD', rate = 810 } = {}) => {
    const { rows } = await admin.query(
      `INSERT INTO public.remittance_types (name, currency_code, delivery_currency, exchange_rate,
         commission_percentage, commission_fixed, min_amount, delivery_method)
       VALUES ($1,$2,$3,$4,2.5,0,0.01,'transfer') RETURNING id`,
      [`ck-${randomUUID().slice(0, 8)}`, sent, delivery, rate]
    );
    types.push(rows[0].id);
    return rows[0].id;
  };
  const seedZone = async (transportCost = null) => {
    const { rows } = await admin.query(
      `INSERT INTO public.shipping_zones (province_name, municipality_name, shipping_cost, transport_cost, is_active)
       VALUES ('TestProv', $1, 15, $2, true) RETURNING id`,
      [`Z-${randomUUID().slice(0, 8)}`, transportCost]
    );
    zones.push(rows[0].id);
    return rows[0].id;
  };
  /** Active USD -> CUP rate (the scratch DB ships none). */
  const seedUsdCupRate = async (rate = 830) => {
    const usd = (await admin.query(`SELECT id FROM public.currencies WHERE code = 'USD'`)).rows[0].id;
    const cup = (await admin.query(`SELECT id FROM public.currencies WHERE code = 'CUP'`)).rows[0].id;
    await admin.query(`UPDATE public.exchange_rates SET is_active = false WHERE from_currency_id = $1 AND to_currency_id = $2`, [usd, cup]);
    const { rows } = await admin.query(
      `INSERT INTO public.exchange_rates (from_currency_id, to_currency_id, rate, is_active, effective_date)
       VALUES ($1,$2,$3,true, CURRENT_DATE - (random()*10000)::int) RETURNING id`,
      [usd, cup, rate]
    );
    rates.push(rows[0].id);
    return rows[0].id;
  };
  /** Remittance in `processing` (ready for remittance_confirm_delivery). amount_to_deliver = (sent - commission) * rate. */
  const seedRemittance = async ({
    typeId, status = 'processing', amount = 100, rate = 810, commission = 2.4, sent = 'USD', delivered = 'CUP',
    zoneId = null, deliveryCost = 0
  } = {}) => {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO public.remittances (id, user_id, remittance_type_id, amount_sent, exchange_rate,
         commission_percentage, commission_fixed, commission_total, amount_to_deliver, currency_sent,
         currency_delivered, recipient_name, recipient_phone, status, shipping_zone_id, delivery_cost)
       VALUES ($1,$2,$3,$4,$5,2.4,0,$6,$7,$8,$9,'Rcpt','+5355550100',$10,$11,$12)`,
      [id, actors.customerId, typeId, amount, rate, commission, Math.round((amount - commission) * rate * 100) / 100,
        sent, delivered, status, zoneId, deliveryCost]
    );
    remittances.push(id);
    return id;
  };
  const seedDispatchedOrder = ({ zoneId = null } = {}) =>
    seedOrder(admin, actors, tracker, [], { status: 'dispatched', paymentStatus: 'validated', stockManaged: false }).then(async (id) => {
      if (zoneId) await admin.query('UPDATE public.orders SET shipping_zone_id = $2 WHERE id = $1', [id, zoneId]);
      return id;
    });

  const deliverRemittance = async (id, { proof = null } = {}) => {
    const c = await as(actors.adminId);
    return call(c, 'remittance_confirm_delivery', [id, proof, null]);
  };
  const deliverOrder = async (id, { proof = null } = {}) => {
    const c = await as(actors.adminId);
    return call(c, 'order_mark_delivered', [id, proof]);
  };

  const accruals = async (opId) =>
    (await admin.query(
      `SELECT * FROM public.courier_accruals WHERE order_id = $1 OR remittance_id = $1 ORDER BY created_at, id`, [opId]
    )).rows;

  /** Creates a courier through the admin RPC. */
  const makeCourier = async (name = `C-${randomUUID().slice(0, 8)}`) => {
    const c = await as(actors.adminId);
    return (await call(c, 'admin_upsert_courier', [null, name, null, null, true]))[0].admin_upsert_courier;
  };

  /** admin_set_messenger_payment_type with named defaults; returns the new row id. */
  const setRule = async (client, o = {}) => {
    const p = {
      code: `r-${randomUUID().slice(0, 8)}`, name: 'Rule', applies_to: 'remittance', method: 'fixed_cup',
      fixed_cup: 200, cup_per_usd: null, percent: null, base: null,
      courier_id: null, zone_id: null, type_id: null, amount_from: null, amount_to: null,
      valid_from: null, valid_to: null, ...o
    };
    const { rows } = await client.query(
      `SELECT public.admin_set_messenger_payment_type($1,$2,$3,$4,$5::numeric,$6::numeric,$7::numeric,$8,$9::uuid,$10::uuid,$11::uuid,$12::numeric,$13::numeric,$14::timestamptz,$15::timestamptz) AS id`,
      [p.code, p.name, p.applies_to, p.method, p.fixed_cup, p.cup_per_usd, p.percent, p.base, p.courier_id, p.zone_id, p.type_id,
        p.amount_from, p.amount_to, p.valid_from, p.valid_to]
    );
    return rows[0].id;
  };

  const cleanup = async () => {
    await clients.splice(0).reduce((p, c) => p.then(() => c.end().catch(() => {})), Promise.resolve());
    const { cleanup: fixturesCleanup } = await import('./fixtures');
    // accruals/assignments cascade from the operations; payments, rules, couriers are append-only / referenced.
    if (remittances.length) await admin.query('DELETE FROM public.remittances WHERE id = ANY($1)', [remittances.splice(0)]);
    await fixturesCleanup(admin, tracker);
    await admin.query(`DELETE FROM public.courier_accruals`).catch(() => {});
    await admin.query(`DELETE FROM public.delivery_assignments`).catch(() => {});
    await wipeTable(admin, 'courier_payments', 'courier_payments_immutable').catch(() => {});
    await wipeTable(admin, 'messenger_payment_types', 'messenger_payment_types_guard').catch(() => {});
    await admin.query('DELETE FROM public.couriers').catch(() => {});
    await admin.query(`UPDATE public.courier_margin_settings SET warning_pct = NULL, critical_pct = NULL, target_pct = NULL, updated_by = NULL`).catch(() => {});
    if (types.length) await admin.query('DELETE FROM public.remittance_types WHERE id = ANY($1)', [types.splice(0)]);
    if (zones.length) await admin.query('DELETE FROM public.shipping_zones WHERE id = ANY($1)', [zones.splice(0)]);
    if (rates.length) await admin.query('DELETE FROM public.exchange_rates WHERE id = ANY($1)', [rates.splice(0)]);
    await restoreActors();
  };

  return {
    as, setRole, restoreActors, call, seedType, seedZone, seedUsdCupRate, seedRemittance, seedDispatchedOrder,
    deliverRemittance, deliverOrder, accruals, makeCourier, setRule, cleanup, clients
  };
};
