/**
 * Financial audit trail (supabase/migrations/20261020100000_financial_audit_log.sql). Local Postgres only.
 *
 * public.financial_audit_log is append-only: nothing can delete its rows, not even postgres, so these tests never
 * clean it up. Every assertion is scoped to the unique row_id of fixtures created by the test itself.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { dbSuiteSkipReason, connectAdmin, connectAs, connectAnon, endAll } from './db';
import { loadActors, createTracker, seedProduct, seedOrder, cleanup, asRateWriter as rateWriter } from './fixtures';

const skipReason = await dbSuiteSkipReason({
  tables: ['remittances', 'orders', 'remittance_types', 'shipping_zones', 'exchange_rates', 'financial_audit_log'],
  functions: ['reserve_order_inventory']
});
const describeDb = skipReason ? describe.skip : describe;

const MIGRATION = 'supabase/migrations/20261020100000_financial_audit_log.sql';
const ROLLBACK = 'supabase/rollbacks/20261020100000_financial_audit_log_down.sql';
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

// [column, newValue] per monitored table. newValue is a function of the old value (as pg returns it) or a literal.
const REMITTANCE_COLUMNS = [
  'commission_percentage', 'commission_fixed', 'commission_total', 'exchange_rate', 'amount_sent',
  'amount_to_deliver', 'discount_amount', 'delivery_cost'
];
const TYPE_COLUMNS = ['exchange_rate', 'commission_percentage', 'commission_fixed', 'min_amount', 'max_amount'];
const ZONE_COLUMNS = ['shipping_cost', 'transport_cost'];
// The single source of truth is public.financial_audit_columns(); this is the spec the tests pin it to.
const EXPECTED_COLUMNS = {
  remittances: ['commission_percentage', 'commission_fixed', 'commission_total', 'exchange_rate', 'amount_sent', 'amount_to_deliver',
    'discount_amount', 'delivery_cost', 'shipping_zone_id', 'remittance_type_id', 'currency_sent', 'currency_delivered',
    // 20261023120000: a PATCH of offer_id changes the discount a later re-pricing re-derives
    'offer_id'],
  orders: ['subtotal', 'discount_amount', 'shipping_cost', 'tax_amount', 'total_amount', 'shipping_zone_id', 'payment_amount',
    'payment_usd_reference', 'payment_fx_rate', 'currency_id', 'payment_currency'],
  remittance_types: ['exchange_rate', 'commission_percentage', 'commission_fixed', 'min_amount', 'max_amount', 'is_active',
    'currency_code', 'delivery_currency'],
  shipping_zones: ['shipping_cost', 'transport_cost', 'free_shipping', 'is_active'],
  exchange_rates: ['rate', 'is_active', 'effective_date', 'from_currency_id', 'to_currency_id']
};
const sorted = (a) => [...a].sort();

describeDb('financial audit log (local Postgres)', () => {
  let admin;
  let actors;
  let zoneA;
  let zoneB;
  const clients = [];

  const as = async (userId) => {
    const c = await connectAs(userId);
    clients.push(c);
    return c;
  };
  const asAdmin = () => as(actors.adminId);
  const asCustomer = () => as(actors.customerId);
  // Since 20261023110000 (remittances) and 20261102100000 (orders) a direct (authenticated) PATCH of money columns is rejected by
  // guard_remittance_money_columns / guard_orders_money_columns. The audit trail is still exercised for those columns from the owner role carrying
  // the admin's JWT, which is exactly how a SECURITY DEFINER RPC looks to the audit trigger.
  const asAdminViaRpc = async () => {
    const c = await connectAdmin();
    await c.query('SELECT set_config($1, $2, false)', ['request.jwt.claims', JSON.stringify({ sub: actors.adminId, role: 'authenticated' })]);
    clients.push(c);
    return c;
  };

  const auditRows = async (rowId) =>
    (await admin.query(
      `SELECT table_name, column_name, old_value, new_value, operation, changed_by, changed_by_role, via_function, txid
         FROM public.financial_audit_log WHERE row_id = $1 ORDER BY id`, [rowId]
    )).rows;

  const makeType = async () => {
    const { rows } = await admin.query(
      `INSERT INTO public.remittance_types (name, currency_code, delivery_currency, exchange_rate, commission_percentage,
         commission_fixed, min_amount, max_amount, delivery_method, is_active)
       VALUES ($1,'USD','CUP',800,2.5,1,20,3000,'cash',true) RETURNING id`, [`fal-${randomUUID().slice(0, 8)}`]
    );
    return rows[0].id;
  };
  const makeZone = async () => {
    const { rows } = await admin.query(
      `INSERT INTO public.shipping_zones (province_name, shipping_cost, transport_cost, free_shipping, is_active)
       VALUES ($1, 10, 4, false, true) RETURNING id`, [`fal-${randomUUID().slice(0, 8)}`]
    );
    return rows[0].id;
  };
  const makeRemittance = async ({ typeId, userId, status = 'payment_pending', rate = 700 } = {}) => {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO public.remittances (id, user_id, remittance_type_id, amount_sent, delivery_cost, exchange_rate,
         commission_percentage, commission_fixed, commission_total, amount_to_deliver, discount_amount, currency_sent,
         currency_delivered, recipient_name, recipient_phone, status, remittance_number)
       VALUES ($1,$2,$3,100,5,$4,2,0.5,2.5,68250,1,'USD','CUP','Rcpt','+5355550100',$5,$6)`,
      [id, userId ?? actors.customerId, typeId, rate, status, `FAL-${id.slice(0, 12)}`]
    );
    return id;
  };
  const makeOrder = async () => {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO public.orders (id, user_id, order_type, status, subtotal, discount_amount, shipping_cost, tax_amount,
         total_amount, currency_id, payment_status, payment_method, stock_managed, order_number)
       VALUES ($1,$2,'product','pending',10,1,2,3,14,$3,'pending','zelle',false,$4)`,
      [id, actors.customerId, actors.currencyId, `FAL-${id.slice(0, 13)}`]
    );
    return id;
  };

  /** Runs `fn(client)` inside a transaction that is always rolled back (client = the given connection). */
  const rolledBack = async (client, fn) => {
    await client.query('BEGIN');
    try {
      return await fn();
    } finally {
      await client.query('ROLLBACK');
    }
  };

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
    zoneA = await makeZone();
    zoneB = await makeZone();
  });

  afterEach(async () => {
    await endAll(clients.splice(0));
    await admin.query(`UPDATE public.user_profiles SET role = 'admin' WHERE id = $1`, [actors.adminId]);
  });

  afterAll(async () => {
    await admin.query('UPDATE public.orders SET shipping_zone_id = NULL WHERE shipping_zone_id = ANY($1)', [[zoneA, zoneB]]);
    await admin.query('UPDATE public.remittances SET shipping_zone_id = NULL WHERE shipping_zone_id = ANY($1)', [[zoneA, zoneB]]);
    await admin.query('DELETE FROM public.shipping_zones WHERE id = ANY($1)', [[zoneA, zoneB]]);
    await admin.end();
  });

  // ------------------------------------------------------------------------------------------------
  describe('objects, privileges, immutability', () => {
    it('table shape: no recipient PII, no FK, not published to realtime, RLS on', async () => {
      const { rows } = await admin.query(
        `SELECT c.relrowsecurity,
                (SELECT count(*)::int FROM pg_constraint WHERE conrelid = c.oid AND contype = 'f') AS fks,
                (SELECT count(*)::int FROM pg_publication_tables WHERE tablename = 'financial_audit_log') AS published,
                (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute
                   WHERE attrelid = c.oid AND attnum > 0 AND NOT attisdropped) AS cols
           FROM pg_class c WHERE c.oid = 'public.financial_audit_log'::regclass`
      );
      expect(rows[0]).toMatchObject({ relrowsecurity: true, fks: 0, published: 0 });
      expect(rows[0].cols).toEqual([
        'id', 'table_name', 'row_id', 'column_name', 'old_value', 'new_value', 'operation',
        'changed_by', 'changed_by_role', 'via_function', 'txid', 'changed_at'
      ]);
    });

    it('privileges: API roles can only SELECT (anon nothing); trigger function not executable by API roles', async () => {
      const { rows } = await admin.query(
        `SELECT r AS role,
                has_table_privilege(r, 'public.financial_audit_log', 'SELECT') AS sel,
                has_table_privilege(r, 'public.financial_audit_log', 'INSERT') AS ins,
                has_table_privilege(r, 'public.financial_audit_log', 'UPDATE') AS upd,
                has_table_privilege(r, 'public.financial_audit_log', 'DELETE') AS del,
                has_table_privilege(r, 'public.financial_audit_log', 'TRUNCATE') AS trunc
           FROM unnest(ARRAY['anon','authenticated','service_role']) r ORDER BY 1`
      );
      const by = Object.fromEntries(rows.map((r) => [r.role, r]));
      expect(by.anon).toMatchObject({ sel: false, ins: false, upd: false, del: false, trunc: false });
      expect(by.authenticated).toMatchObject({ sel: true, ins: false, upd: false, del: false, trunc: false });
      expect(by.service_role).toMatchObject({ sel: true, ins: false, upd: false, del: false, trunc: false });

      const fn = await admin.query(
        `SELECT p.prosecdef, p.proconfig, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x,
                has_function_privilege('public', p.oid, 'EXECUTE') AS public_x
           FROM pg_proc p WHERE p.proname = 'audit_financial_changes' AND p.pronamespace = 'public'::regnamespace`
      );
      expect(fn.rows).toHaveLength(1);
      expect(fn.rows[0]).toMatchObject({ prosecdef: true, anon_x: false, auth_x: false, public_x: false });
      expect(fn.rows[0].proconfig).toContain('search_path=public, pg_temp');
    });

    it('triggers: UPDATE audit on five tables, DELETE audit on types, zones and exchange rates, plus immutability guards', async () => {
      const { rows } = await admin.query(
        `SELECT tgrelid::regclass::text AS t, tgname FROM pg_trigger
          WHERE NOT tgisinternal AND tgname LIKE ANY (ARRAY['audit_financial_%','financial_audit_log_immutable_%'])
          ORDER BY 1, 2`
      );
      expect(rows.map((r) => `${r.t}:${r.tgname}`)).toEqual([
        'exchange_rates:audit_financial_delete',
        'exchange_rates:audit_financial_update',
        'financial_audit_log:financial_audit_log_immutable_row',
        'financial_audit_log:financial_audit_log_immutable_truncate',
        'orders:audit_financial_update',
        'remittance_types:audit_financial_delete',
        'remittance_types:audit_financial_update',
        'remittances:audit_financial_update',
        'shipping_zones:audit_financial_delete',
        'shipping_zones:audit_financial_update'
      ]);
    });

    it('nobody can UPDATE, DELETE or TRUNCATE existing rows, not even postgres', async () => {
      const zone = await makeZone();
      await admin.query('UPDATE public.shipping_zones SET shipping_cost = 99 WHERE id = $1', [zone]);
      for (const sql of [
        `UPDATE public.financial_audit_log SET new_value = '0' WHERE row_id = $1`,
        `DELETE FROM public.financial_audit_log WHERE row_id = $1`
      ]) {
        await expect(admin.query(sql, [zone])).rejects.toMatchObject({ message: expect.stringContaining('financial_audit_log_is_append_only') });
      }
      await expect(admin.query('TRUNCATE public.financial_audit_log')).rejects.toMatchObject({
        message: expect.stringContaining('financial_audit_log_is_append_only')
      });
      expect(await auditRows(zone)).toHaveLength(1);
      // The fixture zone cannot be removed without writing DELETE audit rows, which is fine.
      await admin.query('DELETE FROM public.shipping_zones WHERE id = $1', [zone]);
    });

    it('API roles cannot write: authenticated (admin and customer) and anon get 42501; customer and anon cannot read', async () => {
      const zone = await makeZone();
      await admin.query('UPDATE public.shipping_zones SET shipping_cost = 98 WHERE id = $1', [zone]);
      const ins = `INSERT INTO public.financial_audit_log (table_name, row_id, column_name, operation) VALUES ('orders', gen_random_uuid(), 'x', 'UPDATE')`;
      for (const c of [await asAdmin(), await asCustomer(), await connectAnon()]) {
        clients.push(c);
        await expect(c.query(ins)).rejects.toMatchObject({ code: '42501' });
        await expect(c.query('UPDATE public.financial_audit_log SET new_value = NULL')).rejects.toMatchObject({ code: '42501' });
        await expect(c.query('DELETE FROM public.financial_audit_log')).rejects.toMatchObject({ code: '42501' });
        await expect(c.query('TRUNCATE public.financial_audit_log')).rejects.toMatchObject({ code: '42501' });
      }
      const cust = await asCustomer();
      expect((await cust.query('SELECT * FROM public.financial_audit_log WHERE row_id = $1', [zone])).rows).toEqual([]);
      const anon = await connectAnon();
      clients.push(anon);
      await expect(anon.query('SELECT * FROM public.financial_audit_log')).rejects.toMatchObject({ code: '42501' });
      const adm = await asAdmin();
      expect((await adm.query('SELECT column_name FROM public.financial_audit_log WHERE row_id = $1', [zone])).rows).toEqual([
        { column_name: 'shipping_cost' }
      ]);
      await admin.query('DELETE FROM public.shipping_zones WHERE id = $1', [zone]);
    });

    it('migration file: rollback documented, additive, no realtime publication, no PII columns', () => {
      const raw = read(MIGRATION);
      expect(raw).toMatch(/ROLLBACK/);
      const sql = raw.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
      expect(sql).not.toMatch(/ALTER PUBLICATION/i);
      expect(sql).not.toMatch(/recipient|phone|address|email/i);
      expect(sql).not.toMatch(/execute_platform_reset/);
      expect([...sql.matchAll(/^\s*CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:public\.)?(\w+)/gim)].map((m) => m[1])).toEqual(['financial_audit_log']);
    });
  });

  // ------------------------------------------------------------------------------------------------
  describe('every monitored column is audited (admin PATCH)', () => {
    it.each(REMITTANCE_COLUMNS)('remittances.%s', async (col) => {
      const id = await makeRemittance({ typeId: await makeType() });
      const before = (await admin.query(`SELECT ${col}::text AS v FROM public.remittances WHERE id = $1`, [id])).rows[0].v;
      const adm = await asAdminViaRpc();
      await adm.query(`UPDATE public.remittances SET ${col} = ${col} + 1 WHERE id = $1`, [id]);
      const after = (await admin.query(`SELECT ${col}::text AS v FROM public.remittances WHERE id = $1`, [id])).rows[0].v;
      const rows = await auditRows(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        table_name: 'remittances', column_name: col, old_value: before, new_value: after,
        operation: 'UPDATE', changed_by: actors.adminId, changed_by_role: 'admin', via_function: null
      });
    });

    it('remittances.shipping_zone_id', async () => {
      const id = await makeRemittance({ typeId: await makeType() });
      const adm = await asAdminViaRpc();
      await adm.query('UPDATE public.remittances SET shipping_zone_id = $2 WHERE id = $1', [id, zoneA]);
      await adm.query('UPDATE public.remittances SET shipping_zone_id = $2 WHERE id = $1', [id, zoneB]);
      const rows = await auditRows(id);
      expect(rows.map((r) => [r.column_name, r.old_value, r.new_value])).toEqual([
        ['shipping_zone_id', null, zoneA],
        ['shipping_zone_id', zoneA, zoneB]
      ]);
    });

    // orders_money_total_identity_chk ties total_amount to subtotal - discount + shipping + tax: move the column and the total together.
    it.each([['subtotal', 1], ['discount_amount', -1], ['shipping_cost', 1], ['tax_amount', 1]])('orders.%s (and the total it drags along)', async (col, totalDelta) => {
      const id = await makeOrder();
      const adm = await asAdminViaRpc();
      await adm.query(`UPDATE public.orders SET ${col} = ${col} + 1, total_amount = total_amount + ${totalDelta} WHERE id = $1`, [id]);
      const rows = await auditRows(id);
      expect(rows.map((r) => r.column_name).sort()).toEqual([col, 'total_amount'].sort());
      expect(rows.find((r) => r.column_name === col)).toMatchObject({
        table_name: 'orders', operation: 'UPDATE', changed_by: actors.adminId, changed_by_role: 'admin', via_function: null
      });
      const totals = rows.find((r) => r.column_name === 'total_amount');
      expect(Number(totals.new_value) - Number(totals.old_value)).toBe(totalDelta);
    });

    it('orders.total_amount alone (identity check relaxed inside a rolled-back transaction)', async () => {
      const id = await makeOrder();
      await rolledBack(admin, async () => {
        await admin.query('ALTER TABLE public.orders DROP CONSTRAINT orders_money_total_identity_chk');
        await admin.query('UPDATE public.orders SET total_amount = 99 WHERE id = $1', [id]);
        expect((await auditRows(id)).map((r) => [r.column_name, r.old_value, r.new_value])).toEqual([['total_amount', '14.00', '99.00']]);
      });
    });

    it('orders.payment_amount / payment_usd_reference / payment_fx_rate (sealed Bizum amounts: only the owner role can touch them)', async () => {
      const id = await makeOrder();
      await rolledBack(admin, async () => {
        // A zelle fixture cannot carry Bizum amounts (orders_zelle_clean); relax it inside the rolled-back transaction.
        await admin.query('ALTER TABLE public.orders DROP CONSTRAINT orders_zelle_clean');
        await admin.query('UPDATE public.orders SET payment_amount = 9, payment_usd_reference = 10, payment_fx_rate = 1.1 WHERE id = $1', [id]);
        const rows = await auditRows(id);
        expect(rows.map((r) => [r.column_name, r.old_value, r.new_value]).sort()).toEqual([
          ['payment_amount', null, '9.00'], ['payment_fx_rate', null, '1.100000'], ['payment_usd_reference', null, '10.00']
        ]);
        expect(rows.every((r) => r.changed_by_role === 'system')).toBe(true);
      });
    });

    it('orders.shipping_zone_id', async () => {
      const id = await makeOrder();
      const adm = await asAdminViaRpc();
      await adm.query('UPDATE public.orders SET shipping_zone_id = $2 WHERE id = $1', [id, zoneA]);
      expect((await auditRows(id)).map((r) => [r.column_name, r.old_value, r.new_value])).toEqual([['shipping_zone_id', null, zoneA]]);
    });

    it.each(TYPE_COLUMNS)('remittance_types.%s', async (col) => {
      const id = await makeType();
      const before = (await admin.query(`SELECT ${col}::text AS v FROM public.remittance_types WHERE id = $1`, [id])).rows[0].v;
      const adm = await asAdmin();
      await adm.query(`UPDATE public.remittance_types SET ${col} = ${col} + 1 WHERE id = $1`, [id]);
      const after = (await admin.query(`SELECT ${col}::text AS v FROM public.remittance_types WHERE id = $1`, [id])).rows[0].v;
      const rows = await auditRows(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        table_name: 'remittance_types', column_name: col, old_value: before, new_value: after,
        changed_by: actors.adminId, changed_by_role: 'admin'
      });
    });

    it('remittance_types.is_active / currency_code / delivery_currency', async () => {
      const id = await makeType();
      const adm = await asAdmin();
      await adm.query(
        `UPDATE public.remittance_types SET is_active = false, currency_code = 'EUR', delivery_currency = 'USD' WHERE id = $1`, [id]
      );
      const rows = await auditRows(id);
      expect(rows.map((r) => [r.column_name, r.old_value, r.new_value]).sort()).toEqual([
        ['currency_code', 'USD', 'EUR'], ['delivery_currency', 'CUP', 'USD'], ['is_active', 'true', 'false']
      ]);
    });

    it.each(ZONE_COLUMNS)('shipping_zones.%s', async (col) => {
      const id = await makeZone();
      const before = (await admin.query(`SELECT ${col}::text AS v FROM public.shipping_zones WHERE id = $1`, [id])).rows[0].v;
      const adm = await asAdmin();
      await adm.query(`UPDATE public.shipping_zones SET ${col} = ${col} + 1 WHERE id = $1`, [id]);
      const after = (await admin.query(`SELECT ${col}::text AS v FROM public.shipping_zones WHERE id = $1`, [id])).rows[0].v;
      const rows = await auditRows(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        table_name: 'shipping_zones', column_name: col, old_value: before, new_value: after,
        changed_by: actors.adminId, changed_by_role: 'admin'
      });
    });

    it('shipping_zones.free_shipping', async () => {
      const id = await makeZone();
      const adm = await asAdmin();
      await adm.query('UPDATE public.shipping_zones SET free_shipping = true WHERE id = $1', [id]);
      expect((await auditRows(id)).map((r) => [r.column_name, r.old_value, r.new_value])).toEqual([['free_shipping', 'false', 'true']]);
    });

    it('remittances.remittance_type_id / currency_sent / currency_delivered', async () => {
      const typeA = await makeType();
      const typeB = await makeType();
      const id = await makeRemittance({ typeId: typeA });
      const adm = await asAdminViaRpc();
      await adm.query(`UPDATE public.remittances SET remittance_type_id = $2, currency_sent = 'EUR', currency_delivered = 'USD' WHERE id = $1`, [id, typeB]);
      expect((await auditRows(id)).map((r) => [r.column_name, r.old_value, r.new_value]).sort()).toEqual([
        ['currency_delivered', 'CUP', 'USD'], ['currency_sent', 'USD', 'EUR'], ['remittance_type_id', typeA, typeB]
      ]);
    });

    it('orders.currency_id', async () => {
      const id = await makeOrder();
      const other = (await admin.query('SELECT id FROM public.currencies WHERE id <> $1 LIMIT 1', [actors.currencyId])).rows[0].id;
      const adm = await asAdminViaRpc();
      await adm.query('UPDATE public.orders SET currency_id = $2 WHERE id = $1', [id, other]);
      expect((await auditRows(id)).map((r) => [r.column_name, r.old_value, r.new_value])).toEqual([['currency_id', actors.currencyId, other]]);
    });

    it('orders.payment_currency', async () => {
      const id = await makeOrder();
      await rolledBack(admin, async () => {
        await admin.query('ALTER TABLE public.orders DROP CONSTRAINT orders_zelle_clean');
        await admin.query(`UPDATE public.orders SET payment_currency = 'EUR' WHERE id = $1`, [id]);
        expect((await auditRows(id)).map((r) => [r.column_name, r.old_value, r.new_value])).toEqual([['payment_currency', null, 'EUR']]);
      });
    });

    it('shipping_zones.is_active', async () => {
      const id = await makeZone();
      const adm = await asAdmin();
      await adm.query('UPDATE public.shipping_zones SET is_active = false WHERE id = $1', [id]);
      expect((await auditRows(id)).map((r) => [r.column_name, r.old_value, r.new_value])).toEqual([['is_active', 'true', 'false']]);
    });

    // exchange_rates: the remittance re-pricing reads it. Inactive far-future rows so no active pair is disturbed.
    describe('exchange_rates', () => {
      // DEC-10: only a super_admin writes exchange_rates; promoted per rate statement only (see fixtures.asRateWriter).
      const asRateWriter = async () => rateWriter(admin, actors.adminId, await asAdmin());
      const makeRate = async (isActive = false) => {
        const [from, to] = [actors.currencyId, (await admin.query('SELECT id FROM public.currencies WHERE id <> $1 ORDER BY id LIMIT 1', [actors.currencyId])).rows[0].id];
        const day = `20${70 + Math.floor(Math.random() * 29)}-0${1 + Math.floor(Math.random() * 9)}-1${Math.floor(Math.random() * 9)}`;
        const { rows } = await admin.query(
          `INSERT INTO public.exchange_rates (from_currency_id, to_currency_id, rate, is_active, effective_date)
           VALUES ($1,$2,123.456789,$3,$4) RETURNING id`, [from, to, isActive, day]
        );
        return { id: rows[0].id, from, to };
      };

      it('rate keeps its exact scale', async () => {
        const { id } = await makeRate();
        const adm = await asRateWriter();
        await adm.query('UPDATE public.exchange_rates SET rate = 124.5 WHERE id = $1', [id]);
        expect((await auditRows(id)).map((r) => [r.table_name, r.column_name, r.old_value, r.new_value, r.changed_by_role])).toEqual([
          ['exchange_rates', 'rate', '123.456789', '124.500000', 'super_admin']
        ]);
      });

      it('is_active, effective_date and both currency ids', async () => {
        const { id, from, to } = await makeRate();
        const third = (await admin.query('SELECT id FROM public.currencies WHERE id NOT IN ($1,$2) LIMIT 1', [from, to])).rows[0].id;
        const adm = await asRateWriter();
        await rolledBack(adm, async () => {
          await adm.query(`UPDATE public.exchange_rates SET is_active = false WHERE from_currency_id = $1 AND to_currency_id = $2 AND is_active`, [from, third]);
          await adm.query(`UPDATE public.exchange_rates SET is_active = true, effective_date = '2099-12-31', from_currency_id = $2, to_currency_id = $3 WHERE id = $1`, [id, third, from]);
          expect((await adm.query(`SELECT column_name, old_value, new_value FROM public.financial_audit_log WHERE row_id = $1 ORDER BY column_name`, [id])).rows).toEqual([
            { column_name: 'effective_date', old_value: expect.any(String), new_value: '2099-12-31' },
            { column_name: 'from_currency_id', old_value: from, new_value: third },
            { column_name: 'is_active', old_value: 'false', new_value: 'true' },
            { column_name: 'to_currency_id', old_value: to, new_value: from }
          ]);
        });
      });

      it('DELETE audits every monitored column with new_value NULL', async () => {
        const { id } = await makeRate();
        const adm = await asRateWriter();
        await adm.query('DELETE FROM public.exchange_rates WHERE id = $1', [id]);
        const rows = await auditRows(id);
        expect(rows.map((r) => r.column_name).sort()).toEqual(sorted(EXPECTED_COLUMNS.exchange_rates));
        expect(rows.every((r) => r.operation === 'DELETE' && r.new_value === null && r.changed_by_role === 'super_admin')).toBe(true);
      });

      it('updated_at-only changes (the existing touch trigger) write nothing', async () => {
        const { id } = await makeRate();
        await admin.query('UPDATE public.exchange_rates SET updated_at = now() WHERE id = $1', [id]);
        expect(await auditRows(id)).toEqual([]);
      });
    });

    it('a multi-column UPDATE writes one row per changed column, all in the same transaction id', async () => {
      const id = await makeRemittance({ typeId: await makeType() });
      const adm = await asAdminViaRpc();
      await adm.query('UPDATE public.remittances SET commission_total = 9, amount_to_deliver = 70000, delivery_cost = 5 WHERE id = $1', [id]);
      const rows = await auditRows(id);
      expect(rows.map((r) => r.column_name).sort()).toEqual(['amount_to_deliver', 'commission_total']); // delivery_cost unchanged
      expect(new Set(rows.map((r) => r.txid)).size).toBe(1);
    });

    it('a super_admin is recorded as super_admin', async () => {
      await admin.query(`UPDATE public.user_profiles SET role = 'super_admin' WHERE id = $1`, [actors.adminId]);
      const id = await makeZone();
      const sup = await asAdmin();
      await sup.query('UPDATE public.shipping_zones SET shipping_cost = 77 WHERE id = $1', [id]);
      expect((await auditRows(id))[0]).toMatchObject({ changed_by: actors.adminId, changed_by_role: 'super_admin' });
    });
  });

  // ------------------------------------------------------------------------------------------------
  describe('no real change, no row', () => {
    it('same value, status-only and non-monitored updates write nothing', async () => {
      const rid = await makeRemittance({ typeId: await makeType(), status: 'payment_proof_uploaded' });
      const oid = await makeOrder();
      const adm = await asAdmin();
      await adm.query('UPDATE public.remittances SET commission_total = commission_total, amount_sent = 100.00 WHERE id = $1', [rid]);
      await adm.query('SELECT public.remittance_validate_payment($1)', [rid]); // status-only change, through the RPC (E8)
      await adm.query('UPDATE public.orders SET total_amount = total_amount, shipping_cost = 2 WHERE id = $1', [oid]);
      await adm.query(`SELECT public.order_cancel($1, 'duplicate')`, [oid]);
      expect(await auditRows(rid)).toEqual([]);
      expect(await auditRows(oid)).toEqual([]);
    });
  });

  describe('edge cases', () => {
    it('value -> NULL is recorded with new_value NULL', async () => {
      const id = await makeRemittance({ typeId: await makeType() });
      const adm = await asAdminViaRpc();
      await adm.query('UPDATE public.remittances SET shipping_zone_id = $2 WHERE id = $1', [id, zoneA]);
      await adm.query('UPDATE public.remittances SET shipping_zone_id = NULL WHERE id = $1', [id]);
      const rows = await auditRows(id);
      expect(rows.map((r) => [r.old_value, r.new_value])).toEqual([[null, zoneA], [zoneA, null]]);
    });

    it('a multi-row UPDATE in one statement audits each row once, in one transaction', async () => {
      const ids = [await makeZone(), await makeZone(), await makeZone()];
      const adm = await asAdmin();
      await adm.query('UPDATE public.shipping_zones SET shipping_cost = shipping_cost + 1, transport_cost = transport_cost WHERE id = ANY($1)', [ids]);
      const all = [];
      for (const id of ids) {
        const rows = await auditRows(id);
        expect(rows.map((r) => [r.column_name, r.old_value, r.new_value])).toEqual([['shipping_cost', '10', '11']]);
        all.push(rows[0].txid);
      }
      expect(new Set(all).size).toBe(1);
    });

    it('a scale-only change (10 -> 10.00) is not a change: numeric equality, no row', async () => {
      const id = await makeZone();
      const adm = await asAdmin();
      await adm.query('UPDATE public.shipping_zones SET shipping_cost = 10.00 WHERE id = $1', [id]);
      expect((await admin.query('SELECT shipping_cost::text AS c FROM public.shipping_zones WHERE id = $1', [id])).rows[0].c).toBe('10.00');
      expect(await auditRows(id)).toEqual([]);
    });
  });

  // ------------------------------------------------------------------------------------------------
  describe('the owner cannot change money and sees no audit', () => {
    it('customer PATCH on money columns is rejected by the existing guards and leaves no audit row', async () => {
      const rid = await makeRemittance({ typeId: await makeType() });
      const oid = await makeOrder();
      const cust = await asCustomer();
      await expect(cust.query('UPDATE public.remittances SET amount_to_deliver = 999999 WHERE id = $1', [rid])).rejects.toMatchObject({ code: '42501' });
      await expect(cust.query('UPDATE public.orders SET total_amount = 0.01 WHERE id = $1', [oid])).rejects.toMatchObject({ code: '42501' });
      expect(await auditRows(rid)).toEqual([]);
      expect(await auditRows(oid)).toEqual([]);
      expect((await cust.query('SELECT count(*)::int AS n FROM public.financial_audit_log')).rows[0].n).toBe(0);
    });
  });

  // ------------------------------------------------------------------------------------------------
  describe('system origin', () => {
    it('a session without a user (postgres / SQL editor) is recorded as system with no actor', async () => {
      const id = await makeZone();
      await admin.query('UPDATE public.shipping_zones SET shipping_cost = 55 WHERE id = $1', [id]);
      expect((await auditRows(id))[0]).toMatchObject({ changed_by: null, changed_by_role: 'system', via_function: null });
    });

    it('service_role (no JWT subject) is recorded as service_role', async () => {
      const id = await makeZone();
      const svc = await connectAdmin();
      clients.push(svc);
      await svc.query('BEGIN');
      await svc.query('GRANT UPDATE, SELECT ON public.shipping_zones TO service_role');
      await svc.query(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
      await svc.query('SET LOCAL ROLE service_role');
      await svc.query('UPDATE public.shipping_zones SET shipping_cost = 56 WHERE id = $1', [id]);
      await svc.query('RESET ROLE');
      await svc.query('COMMIT'); // the audit row must be committed; the GRANT is reverted below
      await admin.query('REVOKE UPDATE, SELECT ON public.shipping_zones FROM service_role');
      expect((await auditRows(id))[0]).toMatchObject({ changed_by: null, changed_by_role: 'service_role' });
    });
  });

  describe('via_function and changed_at', () => {
    it('via_function is the nearest calling function even with characters outside [A-Za-z0-9_] (regex [^(\\s]+)', async () => {
      const id = await makeZone();
      await rolledBack(admin, async () => {
        await admin.query(`CREATE FUNCTION public.fal_via$x1(p uuid) RETURNS void LANGUAGE plpgsql AS $f$
          BEGIN UPDATE public.shipping_zones SET shipping_cost = 44 WHERE id = p; END $f$`);
        await admin.query('SELECT public.fal_via$x1($1)', [id]);
        // pg prints names that need quoting in double quotes; the old [A-Za-z0-9_]+ regex returned NULL here
        expect((await auditRows(id))[0].via_function).toBe('"fal_via$x1"');
      });
    });

    it('changed_at is the statement-time clock (clock_timestamp), so two changes in one transaction are ordered', async () => {
      const id = await makeZone();
      await rolledBack(admin, async () => {
        await admin.query('UPDATE public.shipping_zones SET shipping_cost = 61 WHERE id = $1', [id]);
        await admin.query('SELECT pg_sleep(0.01)');
        await admin.query('UPDATE public.shipping_zones SET shipping_cost = 62 WHERE id = $1', [id]);
        const { rows } = await admin.query('SELECT changed_at, txid FROM public.financial_audit_log WHERE row_id = $1 ORDER BY id', [id]);
        expect(rows).toHaveLength(2);
        expect(rows[0].txid).toBe(rows[1].txid);
        expect(rows[1].changed_at.getTime()).toBeGreaterThan(rows[0].changed_at.getTime());
      });
    });
  });

  // ------------------------------------------------------------------------------------------------
  describe('legitimate flows keep working', () => {
    it('recalculate_remittance_at_current_rate (owner) works and is audited with its function name', async () => {
      const typeId = await makeType();
      const rid = await makeRemittance({ typeId, rate: 700 });
      const cust = await asCustomer();
      await cust.query('SELECT public.recalculate_remittance_at_current_rate($1)', [rid]);
      const rows = await auditRows(rid);
      // commission_total stays 2.5: gross 3.5 (2.5% of 100 + 1) minus the stored discount_amount 1 (no offer row => kept).
      expect(rows.map((r) => r.column_name).sort()).toEqual(
        ['amount_to_deliver', 'commission_fixed', 'commission_percentage', 'exchange_rate']
      );
      expect(rows.every((r) => r.via_function === 'recalculate_remittance_at_current_rate' && r.changed_by === actors.customerId && r.changed_by_role === 'user')).toBe(true);
      expect(rows.find((r) => r.column_name === 'exchange_rate')).toMatchObject({ old_value: '700.0000', new_value: '800.0000' });
    });

    it('recalculate by an admin is audited as admin; a no-op recalculation writes nothing', async () => {
      const typeId = await makeType();
      const rid = await makeRemittance({ typeId, rate: 700 });
      const adm = await asAdmin();
      await adm.query('SELECT public.recalculate_remittance_at_current_rate($1)', [rid]);
      const first = await auditRows(rid);
      expect(first.length).toBeGreaterThan(0);
      expect(first.every((r) => r.changed_by_role === 'admin' && r.via_function === 'recalculate_remittance_at_current_rate')).toBe(true);
      await adm.query('SELECT public.recalculate_remittance_at_current_rate($1)', [rid]);
      expect(await auditRows(rid)).toHaveLength(first.length);
    });

    it('payment validation (status + payment_validated) by an admin works and writes no financial audit', async () => {
      const rid = await makeRemittance({ typeId: await makeType(), status: 'payment_proof_uploaded' });
      const adm = await asAdmin();
      await adm.query('SELECT public.remittance_validate_payment($1)', [rid]);
      expect((await admin.query('SELECT status, payment_validated FROM public.remittances WHERE id = $1', [rid])).rows[0]).toEqual({
        status: 'payment_validated', payment_validated: true
      });
      expect(await auditRows(rid)).toEqual([]);
    });

    it('customer cancellation of an order and of a remittance works and writes no financial audit', async () => {
      const oid = await makeOrder();
      const rid = await makeRemittance({ typeId: await makeType() });
      const cust = await asCustomer();
      await cust.query(`SELECT public.order_cancel($1, 'changed my mind')`, [oid]);
      await cust.query(`SELECT public.remittance_cancel($1, 'x')`, [rid]);
      expect((await admin.query(`SELECT status FROM public.orders WHERE id = $1`, [oid])).rows[0].status).toBe('cancelled');
      expect((await admin.query(`SELECT status FROM public.remittances WHERE id = $1`, [rid])).rows[0].status).toBe('cancelled');
      expect(await auditRows(oid)).toEqual([]);
      expect(await auditRows(rid)).toEqual([]);
    });

    it('stock reservation / release of a stock_managed order with real items and batches runs _reserve_order_locked and writes no audit', async () => {
      const tracker = createTracker();
      try {
        const { productId, inventoryId } = await seedProduct(admin, actors, tracker, { quantity: 5 });
        const oid = await seedOrder(admin, actors, tracker, [{ type: 'product', id: productId, quantity: 2 }]);
        const cust = await asCustomer();
        const { rows } = await cust.query('SELECT public.reserve_order_inventory($1) AS r', [oid]);
        expect(rows[0].r).toMatchObject({ ok: true });
        expect((await admin.query('SELECT stock_reserved FROM public.orders WHERE id = $1', [oid])).rows[0].stock_reserved).toBe(true);
        const inv = () => admin.query('SELECT reserved_quantity AS r FROM public.inventory WHERE id = $1', [inventoryId]);
        expect((await inv()).rows[0].r).toBe(2);

        await cust.query(`SELECT public.order_cancel($1, 'changed my mind')`, [oid]); // release trigger
        expect((await inv()).rows[0].r).toBe(0);
        expect(await auditRows(oid)).toEqual([]);
      } finally {
        await cleanup(admin, tracker);
      }
    });

    it('checkout INSERT (customer) is not affected: no audit row, no extra failure', async () => {
      const typeId = await makeType();
      const cust = await asCustomer();
      const id = randomUUID();
      await cust.query(
        `INSERT INTO public.remittances (id, user_id, remittance_type_id, amount_sent, delivery_cost, exchange_rate,
           commission_percentage, commission_fixed, commission_total, amount_to_deliver, currency_sent, currency_delivered,
           recipient_name, recipient_phone, status)
         VALUES ($1,$2,$3,100,0,800,2.5,1,3.5,77200,'USD','CUP','Rcpt','+5355550100','payment_pending')`,
        [id, actors.customerId, typeId]
      );
      expect(await auditRows(id)).toEqual([]);
    });

    it('execute_platform_reset still runs (its DELETEs fire no audit trigger) and keeps the audit rows', async () => {
      const typeId = await makeType();
      const rid = await makeRemittance({ typeId });
      const oid = await makeOrder();
      const adm = await asAdminViaRpc();
      await adm.query('UPDATE public.remittances SET commission_total = 11 WHERE id = $1', [rid]);
      await adm.query('UPDATE public.orders SET shipping_cost = 3, total_amount = 15 WHERE id = $1', [oid]);
      expect(await auditRows(rid)).toHaveLength(1);

      const total = async () => (await admin.query('SELECT count(*)::int AS n FROM public.financial_audit_log')).rows[0].n;
      await rolledBack(admin, async () => {
        await admin.query(`UPDATE public.user_profiles SET role = 'super_admin' WHERE id = $1`, [actors.adminId]);
        await admin.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: actors.adminId, role: 'authenticated' })]);
        await admin.query(`INSERT INTO public.platform_reset_control (id, enabled) VALUES (1, true) ON CONFLICT (id) DO UPDATE SET enabled = true`);
        const before = await total();
        const { rows } = await admin.query(`SELECT public.execute_platform_reset('RESETEAR') AS r`);
        expect(rows[0].r.remittances).toBeGreaterThanOrEqual(1);
        expect(rows[0].r.orders).toBeGreaterThanOrEqual(1);
        expect((await admin.query('SELECT count(*)::int AS n FROM public.remittances WHERE id = $1', [rid])).rows[0].n).toBe(0);
        expect(await total()).toBe(before); // audit rows survive the reset (no FK, no DELETE of the log)
        expect((await auditRows(rid))).toHaveLength(1);
      });
    });
  });

  // ------------------------------------------------------------------------------------------------
  describe('DELETE on types and zones', () => {
    it('deleting a remittance type audits every monitored column with new_value NULL', async () => {
      const id = await makeType();
      const adm = await asAdmin();
      await adm.query('DELETE FROM public.remittance_types WHERE id = $1', [id]);
      const rows = await auditRows(id);
      expect(rows.map((r) => r.column_name).sort()).toEqual(
        ['commission_fixed', 'commission_percentage', 'currency_code', 'delivery_currency', 'exchange_rate', 'is_active', 'max_amount', 'min_amount']
      );
      expect(rows.every((r) => r.operation === 'DELETE' && r.new_value === null && r.changed_by_role === 'admin')).toBe(true);
      expect(rows.find((r) => r.column_name === 'exchange_rate').old_value).toBe('800.0000');
    });

    it('deleting a shipping zone audits its monitored columns', async () => {
      const id = await makeZone();
      const adm = await asAdmin();
      await adm.query('DELETE FROM public.shipping_zones WHERE id = $1', [id]);
      const rows = await auditRows(id);
      expect(rows.map((r) => r.column_name).sort()).toEqual(['free_shipping', 'is_active', 'shipping_cost', 'transport_cost']);
      expect(rows.every((r) => r.operation === 'DELETE' && r.new_value === null)).toBe(true);
    });
  });

  // ------------------------------------------------------------------------------------------------
  describe('column list: single source, real columns, gated triggers', () => {
    const fnCols = async (t) => (await admin.query('SELECT public.financial_audit_columns($1) AS c', [t])).rows[0].c;

    it('financial_audit_columns() is IMMUTABLE, not callable by API roles, and returns the pinned lists', async () => {
      const { rows } = await admin.query(
        `SELECT p.provolatile, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x
           FROM pg_proc p WHERE p.proname = 'financial_audit_columns' AND p.pronamespace = 'public'::regnamespace`
      );
      expect(rows).toEqual([{ provolatile: 'i', anon_x: false, auth_x: false }]);
      for (const [t, cols] of Object.entries(EXPECTED_COLUMNS)) expect(sorted(await fnCols(t))).toEqual(sorted(cols));
      expect(await fnCols('nope')).toEqual([]);
    });

    it('every monitored column exists in information_schema.columns (a rename/drop would otherwise fail open silently)', async () => {
      for (const t of Object.keys(EXPECTED_COLUMNS)) {
        const { rows } = await admin.query(
          `SELECT c AS col FROM unnest(public.financial_audit_columns($1)) c
            WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns i
                               WHERE i.table_schema = 'public' AND i.table_name = $1 AND i.column_name = c)`, [t]
        );
        expect(rows, `${t} has monitored columns that do not exist`).toEqual([]);
      }
    });

    it('UPDATE triggers are `UPDATE OF <cols> ... WHEN (old.c IS DISTINCT FROM new.c ...)` and both lists equal the function list', async () => {
      for (const t of Object.keys(EXPECTED_COLUMNS)) {
        const def = (await admin.query(
          `SELECT pg_get_triggerdef(oid) AS d FROM pg_trigger WHERE tgrelid = $1::regclass AND tgname = 'audit_financial_update'`, [`public.${t}`]
        )).rows[0].d;
        expect(def).toMatch(/AFTER UPDATE OF .+ ON public\.\w+ FOR EACH ROW WHEN \(/);
        const updateOf = def.match(/UPDATE OF (.+?) ON /)[1].split(',').map((c) => c.trim());
        // varchar columns are printed as (old.c)::text IS DISTINCT FROM (new.c)::text
        const when = [...def.matchAll(/\(?(?:old|new)\.(\w+)\)?(?:::\w+)? IS DISTINCT FROM \(?(?:old|new)\.(\w+)\)?(?:::\w+)?/g)];
        expect(when.every((m) => m[1] === m[2])).toBe(true);
        const whenCols = [...new Set(when.map((m) => m[1]))];
        expect(sorted(updateOf), `${t} UPDATE OF`).toEqual(sorted(await fnCols(t)));
        expect(sorted(whenCols), `${t} WHEN`).toEqual(sorted(await fnCols(t)));
      }
    });

    it('audit and log triggers are ENABLE ALWAYS (tgenabled = A): they also fire under session_replication_role = replica', async () => {
      const { rows } = await admin.query(
        `SELECT tgrelid::regclass::text AS t, tgname, tgenabled FROM pg_trigger
          WHERE NOT tgisinternal AND tgname LIKE ANY (ARRAY['audit_financial_%','financial_audit_log_immutable_%']) ORDER BY 1, 2`
      );
      expect(rows).toHaveLength(10);
      expect(rows.filter((r) => r.tgenabled !== 'A')).toEqual([]);

      const id = await makeZone();
      await rolledBack(admin, async () => {
        await admin.query(`SET LOCAL session_replication_role = replica`); // only a superuser may; the local postgres is one
        await admin.query('UPDATE public.shipping_zones SET shipping_cost = 31 WHERE id = $1', [id]);
        expect((await auditRows(id)).map((r) => r.column_name)).toEqual(['shipping_cost']);
      });
    });

    // The function is swapped for a counter inside a rolled-back transaction: it proves WHEN the TRIGGER calls it.
    const withCounter = async (fn) =>
      rolledBack(admin, async () => {
        await admin.query(`SELECT set_config('fal.calls', '0', true)`);
        await admin.query(`CREATE OR REPLACE FUNCTION public.audit_financial_changes() RETURNS trigger LANGUAGE plpgsql AS $f$
          BEGIN PERFORM set_config('fal.calls', (current_setting('fal.calls')::int + 1)::text, true); RETURN NULL; END $f$`);
        const calls = async () => Number((await admin.query(`SELECT current_setting('fal.calls') AS n`)).rows[0].n);
        return fn(calls);
      });

    it('status / stock / non-monitored updates do not execute the trigger function; money changes do (once per row)', async () => {
      const rid = await makeRemittance({ typeId: await makeType() });
      const oid = await makeOrder();
      await withCounter(async (calls) => {
        await admin.query(`UPDATE public.orders SET status = 'processing', stock_reserved = true, updated_at = now() WHERE id = $1`, [oid]);
        await admin.query(`UPDATE public.remittances SET status = 'payment_proof_uploaded', updated_at = now() WHERE id = $1`, [rid]);
        await admin.query('UPDATE public.orders SET total_amount = total_amount, shipping_cost = 2 WHERE id = $1', [oid]); // same values
        expect(await calls()).toBe(0);

        await admin.query('UPDATE public.orders SET shipping_cost = 3, total_amount = 15 WHERE id = $1', [oid]);
        expect(await calls()).toBe(1);
        await admin.query('UPDATE public.remittances SET commission_total = 12 WHERE id = $1', [rid]);
        expect(await calls()).toBe(2);
      });
    });

  });

  // ------------------------------------------------------------------------------------------------
  describe('fail-closed', () => {
    it('if the audit INSERT fails, the money UPDATE fails too and nothing changes', async () => {
      const id = await makeZone();
      await rolledBack(admin, async () => {
        await admin.query(`ALTER TABLE public.financial_audit_log ADD CONSTRAINT fal_test_fail CHECK (false) NOT VALID`);
        await expect(admin.query('UPDATE public.shipping_zones SET shipping_cost = 1234 WHERE id = $1', [id])).rejects.toMatchObject({ code: '23514' });
      });
      expect((await admin.query('SELECT shipping_cost::text AS c FROM public.shipping_zones WHERE id = $1', [id])).rows[0].c).toBe('10');
      expect(await auditRows(id)).toEqual([]);
    });
  });

  // ------------------------------------------------------------------------------------------------
  describe('migration lifecycle', () => {
    it('is idempotent: running it again changes nothing and keeps the rows', async () => {
      const before = (await admin.query('SELECT count(*)::int AS n FROM public.financial_audit_log')).rows[0].n;
      await rolledBack(admin, async () => {
        await admin.query(read(MIGRATION));
        await admin.query(read(MIGRATION));
        const after = (await admin.query('SELECT count(*)::int AS n FROM public.financial_audit_log')).rows[0].n;
        expect(after).toBe(before);
        const trg = await admin.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE NOT tgisinternal AND (tgname LIKE 'audit_financial_%' OR tgname LIKE 'financial_audit_log_immutable_%')`);
        expect(trg.rows[0].n).toBe(10);
      });
    });

    it('rollback up -> down -> up: the down script removes every object and the up script restores them', async () => {
      const objects = async () =>
        (await admin.query(
          `SELECT (to_regclass('public.financial_audit_log') IS NOT NULL) AS tbl,
                  (to_regproc('public.audit_financial_changes') IS NOT NULL) AS fn,
                  (to_regproc('public.financial_audit_columns') IS NOT NULL) AS cols_fn,
                  (SELECT count(*)::int FROM pg_trigger WHERE NOT tgisinternal
                      AND (tgname LIKE 'audit_financial_%' OR tgname LIKE 'financial_audit_log_immutable_%')) AS triggers`
        )).rows[0];
      await rolledBack(admin, async () => {
        expect(await objects()).toEqual({ tbl: true, fn: true, cols_fn: true, triggers: 10 });
        await admin.query(read(ROLLBACK));
        expect(await objects()).toEqual({ tbl: false, fn: false, cols_fn: false, triggers: 0 });
        // money updates still work with the audit gone
        const z = (await admin.query(`INSERT INTO public.shipping_zones (province_name, shipping_cost) VALUES ('fal-rb', 1) RETURNING id`)).rows[0].id;
        await admin.query('UPDATE public.shipping_zones SET shipping_cost = 2 WHERE id = $1', [z]);
        await admin.query(read(MIGRATION));
        expect(await objects()).toEqual({ tbl: true, fn: true, cols_fn: true, triggers: 10 });
      });
      expect(await objects()).toEqual({ tbl: true, fn: true, cols_fn: true, triggers: 10 });
    });
  });
});
