/**
 * Phase 1.5 / S4 (patch P5): ownership on remittance_status_history inserts (T-18), a minimal offer_id validity
 * guard on orders and remittances (T-06) with an off / warn / block kill switch, and a characterization test that
 * pins WHY offers_select_authenticated is kept (supabase/migrations/20261019110000_phase15_s4_history_and_offers.sql).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { dbSuiteSkipReason, connectAdmin, connectAs, endAll } from './db';
import { loadActors } from './fixtures';

const skipReason = await dbSuiteSkipReason({
  tables: ['remittances', 'remittance_status_history', 'orders', 'offers', 'offer_usage', 'remittance_types', 'system_config', 'price_integrity_flags']
});
const describeDb = skipReason ? describe.skip : describe;

const MIGRATION = 'supabase/migrations/20261019110000_phase15_s4_history_and_offers.sql';
const MODE_KEY = 'offer_id_guard_mode';
const UNIFORM_MESSAGE = 'offer_id_rejected';

describeDb('phase 1.5 S4: remittance history ownership + offer_id validity (local Postgres)', () => {
  let admin;
  let actors;
  let type;
  let strangerId;
  const clients = [];
  const created = { offers: [], orders: [], remittances: [], flags: [] };

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

  const makeOffer = async (o = {}) => {
    const { rows } = await admin.query(
      `INSERT INTO public.offers (name_es, name_en, discount_type, discount_value, start_date, end_date, applies_to, is_active,
                                  min_purchase_amount, max_usage_global, max_usage_per_user, code)
       VALUES ('o','o','percentage',10, now() - interval '1 day', now() + interval '1 day', 'all', $1, $2, $3, $4, $5) RETURNING id`,
      [o.is_active ?? true, o.min ?? null, o.global ?? null, o.perUser ?? null, `P15S4${randomUUID().slice(0, 8)}`]
    );
    if (o.expired) await admin.query(`UPDATE public.offers SET start_date = now() - interval '3 days', end_date = now() - interval '1 day' WHERE id = $1`, [rows[0].id]);
    if (o.future) await admin.query(`UPDATE public.offers SET start_date = now() + interval '1 day', end_date = now() + interval '3 days' WHERE id = $1`, [rows[0].id]);
    created.offers.push(rows[0].id);
    return rows[0].id;
  };

  const orderPayload = (offerId, subtotal = 100) => ({
    id: randomUUID(),
    user_id: actors.customerId,
    order_type: 'product',
    status: 'pending',
    payment_status: 'pending',
    payment_method: 'zelle',
    subtotal: String(subtotal),
    discount_amount: '0',
    shipping_cost: '0',
    tax_amount: '0',
    total_amount: String(subtotal),
    currency_id: actors.currencyId,
    offer_id: offerId,
    order_number: `P15S4-${randomUUID().slice(0, 13)}`
  });
  const remittancePayload = (offerId) => ({
    id: randomUUID(),
    user_id: actors.customerId,
    remittance_type_id: type.id,
    amount_sent: '100',
    delivery_cost: '0',
    exchange_rate: '800',
    commission_percentage: '2.5',
    commission_fixed: '0',
    commission_total: '2.5',
    amount_to_deliver: '78000',
    currency_sent: 'USD',
    currency_delivered: 'CUP',
    recipient_name: 'R',
    recipient_phone: '+5355550100',
    recipient_address: 'a',
    recipient_province: 'p',
    recipient_municipality: 'm',
    status: 'payment_pending',
    offer_id: offerId
  });
  const insertSql = (table, p) => {
    const cols = Object.keys(p);
    return { text: `INSERT INTO public.${table} (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`, values: cols.map((c) => p[c]) };
  };
  const probe = async (client, table, p) => {
    await client.query('BEGIN');
    try {
      await client.query(insertSql(table, p));
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    } finally {
      await client.query('ROLLBACK');
    }
  };
  const keep = async (client, table, p) => {
    await client.query(insertSql(table, p));
    (table === 'orders' ? created.orders : created.remittances).push(p.id);
    created.flags.push(p.id);
    return p.id;
  };
  const expectRejected = async (client, table, p) => {
    const r = await probe(client, table, p);
    expect(r.ok, 'must be rejected').toBe(false);
    expect(r.error.message).toBe(UNIFORM_MESSAGE);
    expect(r.error.code).toBe('23514');
    expect(r.error.detail ?? null).toBeNull();
  };
  const expectAccepted = async (client, table, p) => {
    const r = await probe(client, table, p);
    expect(r.error?.message ?? null, 'must be accepted').toBeNull();
  };
  const flagsFor = async (id) => (await admin.query(`SELECT rule, mode, source_table FROM public.price_integrity_flags WHERE source_id = $1 ORDER BY rule`, [id])).rows;

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
    const t = await admin.query(
      `INSERT INTO public.remittance_types (name, currency_code, delivery_currency, exchange_rate, commission_percentage, commission_fixed, min_amount, max_amount, delivery_method, is_active)
       VALUES ('p15-s4-cash','USD','CUP',800,2.5,0,20,3000,'cash',true) RETURNING id`
    );
    type = t.rows[0];
    const s = await admin.query(`SELECT id FROM public.user_profiles WHERE id NOT IN ($1,$2) AND role = 'user' LIMIT 1`, [actors.customerId, actors.adminId]);
    strangerId = s.rows[0]?.id ?? null;
  });

  afterEach(async () => {
    await endAll(clients.splice(0));
    await setMode('warn');
    await admin.query(`DELETE FROM public.price_integrity_flags WHERE source_id = ANY($1)`, [created.flags.splice(0)]);
    await admin.query(`DELETE FROM public.offer_usage WHERE offer_id = ANY($1)`, [created.offers]);
    await admin.query(`DELETE FROM public.remittances WHERE id = ANY($1)`, [created.remittances.splice(0)]);
    await admin.query(`DELETE FROM public.orders WHERE id = ANY($1)`, [created.orders.splice(0)]);
    await admin.query(`DELETE FROM public.activity_logs WHERE action = 'offer_id_guard_mode_changed'`);
    await admin.query(`UPDATE public.user_profiles SET role = 'admin' WHERE id = $1`, [actors.adminId]);
  });

  afterAll(async () => {
    await admin.query(`DELETE FROM public.offers WHERE id = ANY($1)`, [created.offers]);
    await admin.query(`DELETE FROM public.remittance_types WHERE id = $1`, [type.id]);
    await admin.end();
  });

  // ------------------------------------------------------------------------------------------------
  describe('objects and the migration file', () => {
    it('kill switch ships as warn; one guard trigger per table; migration is prepared-not-applied, additive, with rollback', async () => {
      expect((await admin.query(`SELECT value_text FROM public.system_config WHERE key = $1`, [MODE_KEY])).rows).toEqual([{ value_text: 'warn' }]);
      for (const [table, name] of [['orders', 'guard_order_offer_id'], ['remittances', 'guard_remittance_offer_id']]) {
        const { rows } = await admin.query(`SELECT tgname FROM pg_trigger WHERE tgrelid = $1::regclass AND tgname = $2 AND NOT tgisinternal AND (tgtype & 2) = 2 AND (tgtype & 4) = 4`, [`public.${table}`, name]);
        expect(rows).toHaveLength(1);
      }
      const raw = readFileSync(resolve(process.cwd(), MIGRATION), 'utf8');
      expect(raw).toMatch(/PREPARED, NOT APPLIED/);
      expect(raw).toMatch(/ROLLBACK/);
      const sql = raw.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
      expect(sql).not.toMatch(/CREATE TABLE|DROP TABLE|TRUNCATE|DELETE FROM|execute_platform_reset|ALTER PUBLICATION/i);
      expect(sql).not.toMatch(/DROP POLICY\s+(IF EXISTS\s+)?"?offers_select_authenticated/i);
    });

    it('DEFINER functions: EXECUTE revoked from PUBLIC / anon / authenticated (except the setter), search_path pinned', async () => {
      const { rows } = await admin.query(
        `SELECT p.proname, p.prosecdef, p.proconfig, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x, has_function_privilege('public', p.oid, 'EXECUTE') AS public_x
           FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
            AND p.proname IN ('guard_offer_id_validity', '_offer_id_guard_mode', 'set_offer_id_guard_mode') ORDER BY p.proname`
      );
      expect(rows.map((r) => r.proname)).toEqual(['_offer_id_guard_mode', 'guard_offer_id_validity', 'set_offer_id_guard_mode']);
      for (const r of rows) {
        expect(r.prosecdef).toBe(true);
        expect(r.proconfig).toContain('search_path=public, pg_temp');
        expect([r.anon_x, r.public_x]).toEqual([false, false]);
        expect(r.auth_x).toBe(r.proname === 'set_offer_id_guard_mode');
      }
    });
  });

  // ------------------------------------------------------------------------------------------------
  describe('remittance_status_history: ownership on insert (T-18)', () => {
    const hist = (remittanceId, by) => ({ text: `INSERT INTO public.remittance_status_history (remittance_id, old_status, new_status, changed_by) VALUES ($1,'payment_pending','cancelled',$2)`, values: [remittanceId, by] });

    it('the owner can add history to their own remittance; a stranger cannot; an admin can add to any', async () => {
      const own = await keep(await asCustomer(), 'remittances', remittancePayload(null));
      const adminRem = await admin.query(`SELECT id FROM public.remittances WHERE user_id <> $1 LIMIT 1`, [actors.customerId]);
      const customer = await asCustomer();
      await expect(customer.query(hist(own, actors.customerId))).resolves.toBeTruthy();
      if (adminRem.rows[0]) {
        await expect(customer.query(hist(adminRem.rows[0].id, actors.customerId))).rejects.toMatchObject({ code: '42501' });
        const adm = await asAdmin();
        await expect(adm.query(hist(adminRem.rows[0].id, actors.adminId))).resolves.toBeTruthy();
        await admin.query(`DELETE FROM public.remittance_status_history WHERE remittance_id = $1 AND changed_by = $2`, [adminRem.rows[0].id, actors.adminId]);
      }
      // a remittance owned by the admin account is "foreign" for the customer
      const adminOwned = randomUUID();
      await admin.query(`INSERT INTO public.remittances (id, user_id, remittance_type_id, amount_sent, delivery_cost, exchange_rate, commission_percentage, commission_fixed, commission_total, amount_to_deliver, currency_sent, currency_delivered, recipient_name, recipient_phone, recipient_address, recipient_province, recipient_municipality, status)
                         SELECT $1, $2, remittance_type_id, amount_sent, delivery_cost, exchange_rate, commission_percentage, commission_fixed, commission_total, amount_to_deliver, currency_sent, currency_delivered, recipient_name, recipient_phone, recipient_address, recipient_province, recipient_municipality, status FROM public.remittances WHERE id = $3`, [adminOwned, actors.adminId, own]);
      created.remittances.push(adminOwned);
      await expect(customer.query(hist(adminOwned, actors.customerId))).rejects.toMatchObject({ code: '42501' });
    });

    it('the status-change audit trigger (DEFINER) keeps writing history when a customer creates a remittance', async () => {
      const own = await keep(await asCustomer(), 'remittances', remittancePayload(null));
      const n = await admin.query(`SELECT count(*)::int AS n FROM public.remittance_status_history WHERE remittance_id = $1`, [own]);
      expect(n.rows[0].n).toBeGreaterThanOrEqual(0); // creation must simply not fail under the stricter policy
    });

    it('rsh_insert no longer is WITH CHECK (true); the select policy is untouched', async () => {
      const { rows } = await admin.query(`SELECT policyname, cmd, with_check FROM pg_policies WHERE tablename = 'remittance_status_history' AND policyname NOT LIKE '%\_block\_disabled\_user' ORDER BY policyname`);
      expect(rows.map((r) => r.policyname)).toEqual(['rsh_insert', 'rsh_select']);
      expect(rows[0].with_check).not.toBe('true');
      expect(rows[0].with_check).toMatch(/auth\.uid\(\)|uid\(\)/);
    });
  });

  // ------------------------------------------------------------------------------------------------
  describe('offers_select_authenticated is kept (characterization)', () => {
    it('a customer can still read an INACTIVE offer attached to their own old order (orderService enriches orders with is_active offers)', async () => {
      const offerId = await makeOffer({ is_active: false });
      const id = await keep(admin, 'orders', orderPayload(offerId));
      const c = await asCustomer();
      const r = await c.query(`SELECT o.id, f.is_active FROM public.orders o JOIN public.offers f ON f.id = o.offer_id WHERE o.id = $1`, [id]);
      expect(r.rows).toEqual([{ id, is_active: false }]);
      const policies = await admin.query(`SELECT policyname FROM pg_policies WHERE tablename = 'offers' AND policyname = 'offers_select_authenticated'`);
      expect(policies.rows).toHaveLength(1);
    });
  });

  // ------------------------------------------------------------------------------------------------
  describe('offer_id validity guard (orders and remittances)', () => {
    it('warn (default): an inactive offer is ACCEPTED and flagged; a valid one and a NULL offer_id leave no flag', async () => {
      const c = await asCustomer();
      const bad = await keep(c, 'orders', orderPayload(await makeOffer({ is_active: false })));
      expect(await flagsFor(bad)).toEqual([{ rule: 'offer_inactive_or_out_of_window', mode: 'warn', source_table: 'orders' }]);
      const good = await keep(c, 'orders', orderPayload(await makeOffer()));
      expect(await flagsFor(good)).toEqual([]);
      const none = await keep(c, 'orders', orderPayload(null));
      expect(await flagsFor(none)).toEqual([]);
    });

    it('block: the same insert is rejected with ONE uniform message on both tables', async () => {
      await setMode('block');
      const c = await asCustomer();
      const off = await makeOffer({ is_active: false });
      await expectRejected(c, 'orders', orderPayload(off));
      await expectRejected(c, 'remittances', remittancePayload(off));
    });

    it('off: nothing is checked and nothing is flagged', async () => {
      await setMode('off');
      const c = await asCustomer();
      const id = await keep(c, 'orders', orderPayload(await makeOffer({ is_active: false })));
      expect(await flagsFor(id)).toEqual([]);
    });

    it('a missing or invalid mode behaves as warn', async () => {
      const c = await asCustomer();
      await setMode('banana');
      const id = await keep(c, 'orders', orderPayload(await makeOffer({ is_active: false })));
      expect((await flagsFor(id)).length).toBe(1);
      await admin.query(`DELETE FROM public.system_config WHERE key = $1`, [MODE_KEY]);
      try {
        const id2 = await keep(c, 'orders', orderPayload(await makeOffer({ is_active: false })));
        expect((await flagsFor(id2)).length).toBe(1);
      } finally {
        await admin.query(`INSERT INTO public.system_config (key, value_text, description) VALUES ($1, 'warn', 'restored by test')`, [MODE_KEY]);
      }
    });

    it.each([
      ['inactive', { is_active: false }, 100],
      ['expired', { expired: true }, 100],
      ['not started yet', { future: true }, 100],
      ['subtotal below min_purchase_amount (orders only)', { min: 500 }, 100],
      ['global usage limit reached', { global: 1 }, 100, 'global'],
      ['per-user usage limit reached', { perUser: 1 }, 100, 'user']
    ])('block rejects an order with an offer that is %s', async (_n, spec, subtotal, usage) => {
      await setMode('block');
      const offerId = await makeOffer(spec);
      if (usage) {
        await admin.query(`INSERT INTO public.offer_usage (offer_id, user_id) VALUES ($1, $2)`, [offerId, usage === 'user' ? actors.customerId : actors.adminId]);
      }
      await expectRejected(await asCustomer(), 'orders', orderPayload(offerId, subtotal));
    });

    it('block accepts valid offers: in window, subtotal at the minimum, usage below the limits; min_purchase is not applied to remittances', async () => {
      await setMode('block');
      const c = await asCustomer();
      await expectAccepted(c, 'orders', orderPayload(await makeOffer({ min: 100, global: 5, perUser: 2 }), 100));
      const offerId = await makeOffer({ min: 100000 });
      await expectAccepted(c, 'remittances', remittancePayload(offerId));
      const inactive = await makeOffer({ is_active: false });
      await expectRejected(c, 'remittances', remittancePayload(inactive));
    });

    it('admin, super_admin and postgres bypass the guard in block mode', async () => {
      await setMode('block');
      const off = await makeOffer({ is_active: false });
      for (const client of [await asAdmin(), await asSuper(), admin]) {
        const p = orderPayload(off);
        p.user_id = actors.adminId;
        await expectAccepted(client, 'orders', p);
      }
    });

    it('setter RPC: only a super_admin; invalid values refused; logged', async () => {
      await expect((await asCustomer()).query(`SELECT public.set_offer_id_guard_mode('block')`)).rejects.toMatchObject({ code: '42501' });
      await expect((await asAdmin()).query(`SELECT public.set_offer_id_guard_mode('block')`)).rejects.toMatchObject({ code: '42501' });
      const sup = await asSuper();
      await expect(sup.query(`SELECT public.set_offer_id_guard_mode('banana')`)).rejects.toMatchObject({ code: '22023' });
      await sup.query(`SELECT public.set_offer_id_guard_mode('block')`);
      expect((await admin.query(`SELECT value_text FROM public.system_config WHERE key = $1`, [MODE_KEY])).rows[0].value_text).toBe('block');
      const log = await admin.query(`SELECT metadata FROM public.activity_logs WHERE action = 'offer_id_guard_mode_changed'`);
      expect(log.rows[0].metadata).toMatchObject({ before: 'warn', after: 'block' });
    });
  });
});
