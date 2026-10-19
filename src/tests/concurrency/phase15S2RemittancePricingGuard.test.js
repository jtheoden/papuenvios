/**
 * Phase 1.5 / S2: BEFORE INSERT guard on public.remittances with an off / warn / block kill switch
 * (supabase/migrations/20261017110000_phase15_s2_remittance_pricing_guard.sql). Local Postgres only.
 *
 * Attacks closed (audit matrix): T-07 (inflated amount_to_deliver), T-08 (own exchange rate),
 * T-10 (amount outside the type limits / currencies that do not match the type), the USD->USD forced
 * rate (the type row carries exchange_rate = 105 for same-currency types), a negative commission.
 * T-09 "commission 0" is deliberately flag-only (production rows REM-2026-001111 / 001113 would fail
 * a hard floor): it must never block.
 *
 * The test payload is exactly what src/lib/remittanceService.js createRemittance() writes today, and the
 * "legit" vectors replay the client's own float arithmetic (including the unrounded commission that makes
 * amount_to_deliver differ by up to ~4 CUP from the stored-commission formula).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { dbSuiteSkipReason, connectAdmin, connectAs, endAll } from './db';
import { loadActors } from './fixtures';

const skipReason = await dbSuiteSkipReason({ tables: ['remittances', 'remittance_types', 'system_config', 'currencies', 'exchange_rates'] });
const describeDb = skipReason ? describe.skip : describe;

const MIGRATION = 'supabase/migrations/20261017110000_phase15_s2_remittance_pricing_guard.sql';
const MODE_KEY = 'remittance_pricing_guard_mode';
const UNIFORM_MESSAGE = 'remittance_pricing_rejected';

/** Mirror of the client arithmetic in calculateRemittance() (JS floats, commission NOT rounded). */
const clientCalc = (type, amount, offer = null) => {
  const sameCurrency = type.currency_code === type.delivery_currency;
  const rate = sameCurrency ? 1 : type.exchange_rate;
  const pct = (amount * (type.commission_percentage || 0)) / 100;
  const fixed = type.commission_fixed || 0;
  const gross = pct + fixed;
  let discount = 0;
  if (offer?.type === 'percentage') discount = gross * (offer.value / 100);
  if (offer?.type === 'fixed') discount = Math.min(offer.value, gross);
  discount = Math.round(discount * 100) / 100;
  const eff = Math.max(0, gross - discount);
  return {
    rate,
    commission_percentage: type.commission_percentage || 0,
    commission_fixed: fixed,
    commission_total: eff,
    discount,
    amount_to_deliver: amount * rate - eff * rate
  };
};

const mulberry32 = (seed) => () => {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describeDb('phase 1.5 S2: remittance pricing guard (local Postgres)', () => {
  let admin;
  let actors;
  const clients = [];
  const types = {};
  const created = { remittances: [], types: [] };

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
  const setMode = (mode) =>
    admin.query(`UPDATE public.system_config SET value_text = $2 WHERE key = $1`, [MODE_KEY, mode]);

  const makeType = async (name, t) => {
    const { rows } = await admin.query(
      `INSERT INTO public.remittance_types (name, currency_code, delivery_currency, exchange_rate, commission_percentage,
         commission_fixed, min_amount, max_amount, delivery_method, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [name, t.currency_code, t.delivery_currency, t.exchange_rate, t.commission_percentage, t.commission_fixed ?? 0,
        t.min_amount, t.max_amount ?? null, t.delivery_method ?? 'cash', t.is_active ?? true]
    );
    const row = {
      ...rows[0],
      exchange_rate: Number(rows[0].exchange_rate),
      commission_percentage: Number(rows[0].commission_percentage),
      commission_fixed: Number(rows[0].commission_fixed),
      min_amount: Number(rows[0].min_amount),
      max_amount: rows[0].max_amount === null ? null : Number(rows[0].max_amount)
    };
    created.types.push(row.id);
    return row;
  };

  /** The exact column set createRemittance() writes (see the static contract test below). */
  const payloadFor = (type, amount, overrides = {}) => {
    const c = clientCalc(type, amount);
    return {
      user_id: actors.customerId,
      remittance_type_id: type.id,
      amount_sent: amount,
      delivery_cost: 0,
      shipping_zone_id: null,
      exchange_rate: c.rate,
      commission_percentage: c.commission_percentage,
      commission_fixed: c.commission_fixed,
      commission_total: c.commission_total,
      amount_to_deliver: c.amount_to_deliver,
      currency_sent: type.currency_code,
      currency_delivered: type.delivery_currency,
      recipient_name: 'Rcpt',
      recipient_phone: '+5355550100',
      recipient_address: 'addr',
      recipient_province: 'prov',
      recipient_municipality: 'mun',
      recipient_id_number: null,
      delivery_notes: null,
      status: 'payment_pending',
      zelle_account_id: null,
      ...overrides
    };
  };
  const columns = () => Object.keys(payloadFor({ id: 'x', currency_code: 'USD', delivery_currency: 'CUP', exchange_rate: 800 }, 100));

  const insertSql = (cols) =>
    `INSERT INTO public.remittances (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`;

  /** Insert and keep the row (cleaned up afterwards). */
  const insert = async (client, payload) => {
    const cols = Object.keys(payload);
    const res = await client.query(insertSql(cols), cols.map((k) => (payload[k] === null ? null : typeof payload[k] === 'number' ? String(payload[k]) : payload[k])));
    created.remittances.push(res.rows[0].id);
    return res.rows[0].id;
  };
  /** Insert inside a transaction that is always rolled back: returns { ok, error }. */
  const probe = async (client, payload) => {
    const cols = Object.keys(payload);
    await client.query('BEGIN');
    try {
      await client.query(insertSql(cols), cols.map((k) => (payload[k] === null ? null : typeof payload[k] === 'number' ? String(payload[k]) : payload[k])));
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    } finally {
      await client.query('ROLLBACK');
    }
  };
  const expectRejected = async (client, payload) => {
    const r = await probe(client, payload);
    expect(r.ok, 'must be rejected').toBe(false);
    expect(r.error.message).toBe(UNIFORM_MESSAGE);
    expect(r.error.detail ?? null).toBeNull();
    expect(r.error.hint ?? null).toBeNull();
    return r.error;
  };
  const expectAccepted = async (client, payload) => {
    const r = await probe(client, payload);
    expect(r.error?.message ?? null, 'must be accepted').toBeNull();
  };
  const flagsFor = async (id) =>
    (await admin.query(`SELECT rule, mode, user_id, source_table, details FROM public.price_integrity_flags WHERE source_id = $1 ORDER BY rule`, [id])).rows;

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
    types.cash = await makeType('p15-s2-cash', { currency_code: 'USD', delivery_currency: 'CUP', exchange_rate: 800, commission_percentage: 2.5, min_amount: 20, max_amount: 3000 });
    types.usd = await makeType('p15-s2-usd', { currency_code: 'USD', delivery_currency: 'USD', exchange_rate: 105, commission_percentage: 4.7619047619, min_amount: 20, max_amount: 1000 });
    types.inactive = await makeType('p15-s2-inactive', { currency_code: 'USD', delivery_currency: 'CUP', exchange_rate: 900, commission_percentage: 5, min_amount: 100, is_active: false });
    types.nomax = await makeType('p15-s2-nomax', { currency_code: 'USD', delivery_currency: 'CUP', exchange_rate: 800, commission_percentage: 2.5, min_amount: 100, max_amount: null });
    types.fixedFee = await makeType('p15-s2-fixed', { currency_code: 'USD', delivery_currency: 'CUP', exchange_rate: 800, commission_percentage: 2, commission_fixed: 1.5, min_amount: 10, max_amount: 500 });
  });

  afterEach(async () => {
    await endAll(clients.splice(0));
    await setMode('warn');
    if (created.remittances.length) {
      await admin.query('DELETE FROM public.price_integrity_flags WHERE source_id = ANY($1)', [created.remittances]);
      await admin.query('DELETE FROM public.remittances WHERE id = ANY($1)', [created.remittances.splice(0)]);
    }
    await admin.query(`DELETE FROM public.activity_logs WHERE action = 'remittance_pricing_guard_mode_changed'`);
    await admin.query(`UPDATE public.user_profiles SET role = 'admin' WHERE id = $1`, [actors.adminId]);
  });

  afterAll(async () => {
    await admin.query('DELETE FROM public.remittance_types WHERE id = ANY($1)', [created.types]);
    await admin.end();
  });

  // ------------------------------------------------------------------------------------------------
  describe('objects, privileges and ordering', () => {
    it('the kill switch row ships as warn and the guard trigger sits between the owner guard and the reset lock', async () => {
      const cfg = await admin.query(`SELECT value_text FROM public.system_config WHERE key = $1`, [MODE_KEY]);
      expect(cfg.rows).toEqual([{ value_text: 'warn' }]);
      const { rows } = await admin.query(
        `SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.remittances'::regclass AND NOT tgisinternal
            AND (tgtype & 1) = 1 AND (tgtype & 4) = 4 AND (tgtype & 2) = 2 ORDER BY tgname COLLATE "C"`
      );
      expect(rows.map((r) => r.tgname)).toEqual([
        'guard_payment_method_enabled',
        'guard_remittance_owner_insert',
        'guard_remittance_pricing',
        'guard_reset_lock_remittances',
        'trigger_generate_remittance_number'
      ]);
    });

    it('trigger function: EXECUTE revoked from PUBLIC / anon / authenticated, search_path pinned', async () => {
      const { rows } = await admin.query(
        `SELECT p.prosecdef, p.proconfig, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x,
                has_function_privilege('public', p.oid, 'EXECUTE') AS public_x
           FROM pg_proc p WHERE p.proname = 'guard_remittance_pricing' AND p.pronamespace = 'public'::regnamespace`
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ anon_x: false, auth_x: false, public_x: false });
      expect(rows[0].proconfig).toContain('search_path=public, pg_temp');
    });

    it('flags table: RLS on, no grants for anon / authenticated, no FK, not published to realtime, generic source columns', async () => {
      const { rows } = await admin.query(
        `SELECT c.relrowsecurity,
                has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS anon_any,
                has_table_privilege('authenticated', c.oid, 'SELECT') AS auth_select,
                has_table_privilege('authenticated', c.oid, 'INSERT') AS auth_insert,
                (SELECT count(*)::int FROM pg_constraint WHERE conrelid = c.oid AND contype = 'f') AS fks,
                (SELECT count(*)::int FROM pg_publication_tables WHERE tablename = 'price_integrity_flags') AS published,
                (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid = c.oid AND attnum > 0 AND NOT attisdropped) AS cols
           FROM pg_class c WHERE c.oid = 'public.price_integrity_flags'::regclass`
      );
      expect(rows[0]).toMatchObject({ relrowsecurity: true, anon_any: false, auth_select: false, auth_insert: false, fks: 0, published: 0 });
      expect(rows[0].cols).toEqual(expect.arrayContaining(['id', 'created_at', 'source_table', 'source_id', 'user_id', 'rule', 'mode', 'details']));
    });

    it('a customer cannot read or forge flags', async () => {
      const c = await asCustomer();
      await expect(c.query('SELECT * FROM public.price_integrity_flags')).rejects.toMatchObject({ code: '42501' });
      await expect(
        c.query(`INSERT INTO public.price_integrity_flags (source_table, source_id, rule, mode) VALUES ('remittances', gen_random_uuid(), 'x', 'warn')`)
      ).rejects.toMatchObject({ code: '42501' });
    });

    it('the migration is prepared-not-applied and additive (own function, trigger, table, one config row, setter)', () => {
      const raw = readFileSync(resolve(process.cwd(), MIGRATION), 'utf8');
      expect(raw).toMatch(/PREPARED, NOT APPLIED/);
      expect(raw).toMatch(/ROLLBACK/);
      const sql = raw.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n'); // executable statements only
      expect(sql).not.toMatch(/ALTER PUBLICATION/i);
      expect([...sql.matchAll(/^\s*CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:public\.)?(\w+)/gim)].map((m) => m[1])).toEqual(['price_integrity_flags']);
      expect([...sql.matchAll(/^\s*CREATE (?:OR REPLACE )?TRIGGER\s+(\w+)/gim)].map((m) => m[1])).toEqual(['guard_remittance_pricing']);
      expect([...sql.matchAll(/^\s*ALTER TABLE\s+(?:ONLY\s+)?(?:public\.)?(\w+)/gim)].map((m) => m[1]).filter((t) => t !== 'price_integrity_flags')).toEqual([]);
      expect([...sql.matchAll(/^\s*CREATE (?:OR REPLACE )?FUNCTION\s+(?:public\.)?(\w+)/gim)].map((m) => m[1]).sort()).toEqual(
        ['_remittance_guard_mode', 'guard_remittance_pricing', 'set_remittance_pricing_guard_mode'].sort()
      );
      expect([...sql.matchAll(/INSERT INTO\s+(?:public\.)?(\w+)/gi)].map((m) => m[1]).filter((t, i, a) => a.indexOf(t) === i).sort()).toEqual(['activity_logs', 'price_integrity_flags', 'system_config']);
      expect(sql).not.toMatch(/\bDROP\s+TABLE\b|\bTRUNCATE\b|\bDELETE\s+FROM\b|\bUPDATE\s+public\.(orders|remittances|remittance_types)/i);
      expect(sql).not.toMatch(/execute_platform_reset/);
    });

    it('does not modify other tables: orders / remittances / remittance_types policies and column sets are unchanged', async () => {
      const { rows } = await admin.query(
        `SELECT tablename, count(*)::int AS n FROM pg_policies WHERE tablename IN ('remittances','remittance_types') GROUP BY 1 ORDER BY 1`
      );
      expect(rows).toEqual([{ tablename: 'remittance_types', n: 2 }, { tablename: 'remittances', n: 5 }]);
      const cols = await admin.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND table_name='remittances'`);
      expect(cols.rows[0].n).toBe(53);
    });

    it('client contract: createRemittance writes exactly the columns this guard was validated against', () => {
      const src = readFileSync(resolve(process.cwd(), 'src/lib/remittanceService.js'), 'utf8');
      const block = src.slice(src.indexOf('const insertData = {'), src.indexOf('};', src.indexOf('const insertData = {')));
      const keys = [...block.matchAll(/^\s{6}(\w+)[:,]/gm)].map((m) => m[1]);
      expect(keys).toEqual([
        'user_id', 'remittance_type_id', 'amount_sent', 'delivery_cost', 'shipping_zone_id', 'exchange_rate',
        'commission_percentage', 'commission_fixed', 'commission_total', 'amount_to_deliver', 'currency_sent',
        'currency_delivered', 'recipient_name', 'recipient_phone', 'recipient_address', 'recipient_province',
        'recipient_municipality', 'recipient_id_number', 'delivery_notes', 'status', 'zelle_account_id'
      ]);
      expect(columns()).toEqual(keys);
    });
  });

  // ------------------------------------------------------------------------------------------------
  describe('kill switch: off / warn / block', () => {
    const inflated = () => payloadFor(types.cash, 100, { amount_to_deliver: 780000 }); // T-07: x10

    it('warn (default): the inflated insert is ACCEPTED and leaves an observable flag; a legit insert leaves none', async () => {
      const c = await asCustomer();
      const bad = await insert(c, inflated());
      const flags = await flagsFor(bad);
      expect(flags.map((f) => f.rule)).toContain('delivery_above_cap');
      expect(flags.every((f) => f.mode === 'warn' && f.source_table === 'remittances' && f.user_id === actors.customerId)).toBe(true);

      const good = await insert(c, payloadFor(types.cash, 100));
      expect(await flagsFor(good)).toEqual([]);
    });

    it('block: the same insert is rejected with ONE uniform message and nothing is stored', async () => {
      await setMode('block');
      const c = await asCustomer();
      const before = (await admin.query('SELECT count(*)::int AS n FROM public.price_integrity_flags')).rows[0].n;
      const err = await expectRejected(c, inflated());
      expect(err.code).toBe('23514');
      expect((await admin.query('SELECT count(*)::int AS n FROM public.price_integrity_flags')).rows[0].n).toBe(before);
    });

    it('off: nothing is checked and nothing is flagged', async () => {
      await setMode('off');
      const c = await asCustomer();
      const id = await insert(c, inflated());
      expect(await flagsFor(id)).toEqual([]);
    });

    it('a missing or invalid mode value behaves as warn (never blocks by misconfiguration, still records)', async () => {
      const c = await asCustomer();
      await setMode('banana');
      const id = await insert(c, inflated());
      expect((await flagsFor(id)).length).toBeGreaterThan(0);
      await admin.query(`DELETE FROM public.system_config WHERE key = $1`, [MODE_KEY]);
      try {
        const id2 = await insert(c, inflated());
        expect((await flagsFor(id2)).length).toBeGreaterThan(0);
      } finally {
        await admin.query(`INSERT INTO public.system_config (key, value_text, description) VALUES ($1, 'warn', 'restored by test')`, [MODE_KEY]);
      }
    });

    it('setter RPC: only a super_admin can change the mode; invalid values and other roles are refused; the change is logged', async () => {
      const sup = await asSuper();
      const { rows } = await sup.query('SELECT public.set_remittance_pricing_guard_mode($1) AS mode', ['block']);
      expect(rows[0].mode).toBe('block');
      expect((await admin.query(`SELECT value_text FROM public.system_config WHERE key = $1`, [MODE_KEY])).rows[0].value_text).toBe('block');
      const log = await admin.query(`SELECT metadata FROM public.activity_logs WHERE action = 'remittance_pricing_guard_mode_changed'`);
      expect(log.rows).toHaveLength(1);
      await expect(sup.query('SELECT public.set_remittance_pricing_guard_mode($1)', ['banana'])).rejects.toMatchObject({ code: '22023' });
      await sup.end();

      await admin.query(`UPDATE public.user_profiles SET role = 'admin' WHERE id = $1`, [actors.adminId]);
      const adm = await asAdmin();
      await expect(adm.query('SELECT public.set_remittance_pricing_guard_mode($1)', ['off'])).rejects.toMatchObject({ code: '42501' });
      const cust = await asCustomer();
      await expect(cust.query('SELECT public.set_remittance_pricing_guard_mode($1)', ['off'])).rejects.toMatchObject({ code: '42501' });
    });

    it('setter RPC privileges: no EXECUTE for PUBLIC / anon; the config reader helper is not callable by API roles', async () => {
      const { rows } = await admin.query(
        `SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x, has_function_privilege('public', p.oid, 'EXECUTE') AS public_x,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x
           FROM pg_proc p WHERE p.proname IN ('set_remittance_pricing_guard_mode', '_remittance_guard_mode') AND p.pronamespace = 'public'::regnamespace ORDER BY 1`
      );
      expect(rows).toEqual([
        { proname: '_remittance_guard_mode', anon_x: false, public_x: false, auth_x: false },
        { proname: 'set_remittance_pricing_guard_mode', anon_x: false, public_x: false, auth_x: true }
      ]);
    });
  });

  // ------------------------------------------------------------------------------------------------
  describe('who is NOT restricted (bypass) - the SECURITY DEFINER owner trap', () => {
    it('block mode: customer rejected; admin, super_admin, service_role and postgres accepted without any flag', async () => {
      await setMode('block');
      const bad = (type = types.cash) => payloadFor(type, 100, { amount_to_deliver: 780000, exchange_rate: 8000 });

      await expectRejected(await asCustomer(), bad());

      const adm = await asAdmin();
      const idAdmin = await insert(adm, { ...bad(), user_id: actors.adminId }); // RLS: staff insert their own rows
      const sup = await asSuper();
      const idSuper = await insert(sup, { ...bad(), user_id: actors.adminId });
      const idPostgres = await insert(admin, bad());

      // service_role: no JWT subject, role switched like PostgREST does (local scratch DB has no grant for it)
      const svc = await connectAdmin();
      clients.push(svc);
      await svc.query('BEGIN');
      await svc.query('GRANT INSERT, SELECT ON public.remittances TO service_role');
      await svc.query('GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role');
      await svc.query('GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role');
      await svc.query(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
      await svc.query('SET LOCAL ROLE service_role');
      const cols = Object.keys(bad());
      const res = await svc.query(insertSql(cols), cols.map((k) => (bad()[k] === null ? null : typeof bad()[k] === 'number' ? String(bad()[k]) : bad()[k])));
      await svc.query('RESET ROLE');
      const svcFlags = (await svc.query('SELECT count(*)::int AS n FROM public.price_integrity_flags WHERE source_id = $1', [res.rows[0].id])).rows[0].n;
      await svc.query('ROLLBACK'); // also reverts the temporary GRANTs (the scratch DB gives service_role no table privileges)
      expect(svcFlags).toBe(0);

      for (const id of [idAdmin, idSuper, idPostgres]) {
        expect(await flagsFor(id)).toEqual([]);
      }
    });

    it('a customer with a JWT but a spoofed claim set is still a customer (uid present => checked)', async () => {
      await setMode('block');
      const c = await asCustomer();
      await expectRejected(c, payloadFor(types.cash, 100, { exchange_rate: 2000, amount_to_deliver: 195000 }));
    });
  });

  // ------------------------------------------------------------------------------------------------
  describe('attack matrix in block mode', () => {
    let c;
    beforeAll(async () => {
      /* connection is opened per test; block mode set per test */
    });
    const customerBlock = async () => {
      await setMode('block');
      return asCustomer();
    };

    it('T-07: amount_to_deliver x10 with the honest rate', async () => {
      c = await customerBlock();
      await expectRejected(c, payloadFor(types.cash, 100, { amount_to_deliver: 780000 }));
    });

    it('T-07: one extra USD worth of delivery (rate units) is rejected, the rounding allowance passes', async () => {
      c = await customerBlock();
      const base = clientCalc(types.cash, 100);
      await expectRejected(c, payloadFor(types.cash, 100, { amount_to_deliver: base.amount_to_deliver + 800 }));
      await expectAccepted(c, payloadFor(types.cash, 100, { amount_to_deliver: base.amount_to_deliver + 9 })); // <= 0.0125 * rate
      await expectRejected(c, payloadFor(types.cash, 100, { amount_to_deliver: base.amount_to_deliver + 12 }));
    });

    it('T-08: own exchange rate (2000) with a consistent amount_to_deliver', async () => {
      c = await customerBlock();
      await expectRejected(c, payloadFor(types.cash, 100, { exchange_rate: 2000, amount_to_deliver: 97.5 * 2000 }));
    });

    it('rate tolerance: 0.05% above the type rate passes, 0.06% fails; a lower (stale) rate passes', async () => {
      c = await customerBlock();
      const mk = (rate) => payloadFor(types.cash, 100, { exchange_rate: rate, amount_to_deliver: (100 - 2.5) * rate });
      await expectAccepted(c, mk(800.4));
      await expectRejected(c, mk(800.5));
      await expectAccepted(c, mk(690));
    });

    it('USD->USD with the type row rate forced (105): rejected; the real same-currency flow (rate 1) passes', async () => {
      c = await customerBlock();
      await expectRejected(c, payloadFor(types.usd, 103, { exchange_rate: 105, amount_to_deliver: 100 * 105 }));
      await expectRejected(c, payloadFor(types.usd, 103, { exchange_rate: 1.01, amount_to_deliver: 100 }));
      await expectAccepted(c, payloadFor(types.usd, 107, { commission_total: 7, amount_to_deliver: 100 }));
    });

    it('T-10: currencies that do not match the type', async () => {
      c = await customerBlock();
      await expectRejected(c, payloadFor(types.cash, 100, { currency_delivered: 'USD' }));
      await expectRejected(c, payloadFor(types.cash, 100, { currency_sent: 'EUR' }));
    });

    it('T-10: amount below the minimum, above the maximum, and no maximum when the type has none', async () => {
      c = await customerBlock();
      await expectRejected(c, payloadFor(types.cash, 19.99));
      await expectRejected(c, payloadFor(types.cash, 3000.01));
      await expectAccepted(c, payloadFor(types.cash, 20));
      await expectAccepted(c, payloadFor(types.cash, 3000));
      await expectRejected(c, payloadFor(types.nomax, 99.99));
      await expectAccepted(c, payloadFor(types.nomax, 250000));
    });

    it('inactive currency on the type', async () => {
      await admin.query(`INSERT INTO public.currencies (code, name_es, name_en, symbol, is_active) VALUES ('ZZI', 'zz', 'zz', 'z', false) ON CONFLICT (code) DO NOTHING`);
      try {
        const t = await makeType('p15-s2-inactive-currency', { currency_code: 'USD', delivery_currency: 'ZZI', exchange_rate: 10, commission_percentage: 2, min_amount: 20, max_amount: 1000 });
        c = await customerBlock();
        await expectRejected(c, payloadFor(t, 100));
      } finally {
        await admin.query(`DELETE FROM public.remittance_types WHERE name = 'p15-s2-inactive-currency'`);
        await admin.query(`DELETE FROM public.currencies WHERE code = 'ZZI'`);
      }
    });

    it('inactive remittance type', async () => {
      c = await customerBlock();
      await expectRejected(c, payloadFor(types.inactive, 150, { exchange_rate: 900, commission_total: 7.5, amount_to_deliver: 142.5 * 900 }));
    });

    it('negative commission (inflates the delivery) is rejected by the guard itself', async () => {
      c = await customerBlock();
      await expectRejected(c, payloadFor(types.cash, 100, { commission_total: -10, amount_to_deliver: 110 * 800 }));
    });

    it('commission 0 / far below the type floor is FLAG-ONLY: accepted in block mode, flagged, never blocks', async () => {
      c = await customerBlock();
      const zero = payloadFor(types.cash, 100, { commission_total: 0, commission_percentage: 0, amount_to_deliver: 100 * 800 });
      const id = await insert(c, zero);
      const flags = await flagsFor(id);
      expect(flags.map((f) => f.rule)).toEqual(['commission_below_floor']);
      expect(flags[0].mode).toBe('flag');
    });

    it('a 100% offer legitimately gives commission 0: no floor flag', async () => {
      c = await customerBlock();
      const calc = clientCalc(types.cash, 100, { type: 'percentage', value: 100 });
      const id = await insert(c, payloadFor(types.cash, 100, {
        commission_total: calc.commission_total, discount_amount: calc.discount, amount_to_deliver: calc.amount_to_deliver
      }));
      expect(calc.commission_total).toBe(0);
      expect(await flagsFor(id)).toEqual([]);
    });

    it('fixed-fee types: floor includes the fixed part', async () => {
      c = await customerBlock();
      const ok = await insert(c, payloadFor(types.fixedFee, 100));
      expect(await flagsFor(ok)).toEqual([]);
      const low = await insert(c, payloadFor(types.fixedFee, 100, { commission_total: 2, amount_to_deliver: 98 * 800 }));
      expect((await flagsFor(low)).map((f) => f.rule)).toEqual(['commission_below_floor']);
    });

    it('the error never carries rates, limits or commissions (uniform text, no detail/hint)', async () => {
      c = await customerBlock();
      const attempts = [
        payloadFor(types.cash, 100, { exchange_rate: 2000, amount_to_deliver: 195000 }),
        payloadFor(types.cash, 19),
        payloadFor(types.cash, 100, { currency_delivered: 'USD' }),
        payloadFor(types.cash, 100, { amount_to_deliver: 999999 }),
        payloadFor(types.inactive, 150, { exchange_rate: 900, commission_total: 7.5, amount_to_deliver: 142.5 * 900 })
      ];
      const messages = new Set();
      for (const a of attempts) messages.add((await expectRejected(c, a)).message);
      expect([...messages]).toEqual([UNIFORM_MESSAGE]);
    });

    it('rate source for a type whose own rate is 0: active direct pair of exchange_rates, else rule skipped + flagged', async () => {
      const zeroType = await makeType('p15-s2-zero', { currency_code: 'USD', delivery_currency: 'CUP', exchange_rate: 0, commission_percentage: 2.5, min_amount: 20, max_amount: 3000 });
      c = await customerBlock();
      const ids = (await admin.query(`SELECT code, id FROM public.currencies WHERE code IN ('USD','CUP')`)).rows;
      const usd = ids.find((r) => r.code === 'USD').id;
      const cup = ids.find((r) => r.code === 'CUP').id;
      const prior = (await admin.query(`SELECT id FROM public.exchange_rates WHERE from_currency_id = $1 AND to_currency_id = $2 AND is_active`, [usd, cup])).rows;
      await admin.query(`UPDATE public.exchange_rates SET is_active = false WHERE id = ANY($1)`, [prior.map((r) => r.id)]);
      let pairId;
      try {
        // no pair: the rate rule is skipped but flagged (the client would have fallen back to a rate we cannot reproduce)
        const mk = (rate) => payloadFor(zeroType, 100, { exchange_rate: rate, amount_to_deliver: 97.5 * rate });
        const id = await insert(c, mk(790));
        expect((await flagsFor(id)).map((f) => f.rule)).toContain('rate_unresolvable');
        pairId = (await admin.query(
          `INSERT INTO public.exchange_rates (from_currency_id, to_currency_id, rate, is_active, effective_date) VALUES ($1,$2,790,true,CURRENT_DATE + 3650) RETURNING id`, [usd, cup]
        )).rows[0].id;
        await expectAccepted(c, mk(790));
        await expectRejected(c, mk(800));
      } finally {
        if (pairId) await admin.query('DELETE FROM public.exchange_rates WHERE id = $1', [pairId]);
        await admin.query(`UPDATE public.exchange_rates SET is_active = true WHERE id = ANY($1)`, [prior.map((r) => r.id)]);
      }
    });
  });

  // ------------------------------------------------------------------------------------------------
  describe('legitimate flow must pass in block mode (no false positives)', () => {
    // [sent, storedRate, commissionTotal, amountToDeliver] of production remittances (names / phones omitted), 2026-09-10 .. 2026-10-17
    const PROD_CUP = [
      [100, 690, 2.9, 67000], [257.3, 705, 7.3, 176250.5], [100, 730, 2.74, 71000], [120, 740, 3.24, 86400],
      [150, 740, 4.05, 108000], [100, 750, 2.67, 73000], [135, 750, 3.6, 98550], [120, 750, 3.2, 87600],
      [100, 760, 2.63, 74000], [153, 760, 4.03, 113220], [50, 780, 1.28, 38000], [40, 780, 1.03, 30400],
      [100, 790, 2.53, 77000], [100, 800, 2.5, 78000], [765, 800, 19.13, 596700]
    ];

    it('every production CUP remittance shape passes against the current type config (REM-2026-001125: 765 / 19.13 / 596700 included)', async () => {
      await setMode('block');
      const c = await asCustomer();
      for (const [sent, rate, comm, deliver] of PROD_CUP) {
        await expectAccepted(c, payloadFor(types.cash, sent, { exchange_rate: rate, commission_total: comm, amount_to_deliver: deliver }));
      }
    });

    it('production USD->USD rows pass; the two with commission 3.00 pass too but are flagged (REM-2026-001111 / 001113)', async () => {
      await setMode('block');
      const c = await asCustomer();
      await expectAccepted(c, payloadFor(types.usd, 107, { commission_total: 7, amount_to_deliver: 100 }));
      const id = await insert(c, payloadFor(types.usd, 103, { commission_total: 3, amount_to_deliver: 100 }));
      expect((await flagsFor(id)).map((f) => f.rule)).toEqual(['commission_below_floor']);
    });

    it('reverse mode: amount_sent derived from 80000 CUP (non-terminating), then run forward by the client', async () => {
      await setMode('block');
      const c = await asCustomer();
      const desired = 80000;
      const sentRaw = desired / 800 / (1 - 0.025); // 102.5641025641...
      const calc = clientCalc(types.cash, sentRaw);
      await expectAccepted(c, payloadFor(types.cash, sentRaw, { commission_total: calc.commission_total, amount_to_deliver: calc.amount_to_deliver }));
    });

    it('client float arithmetic over 3000 random amounts / rates / offers always passes (commission rounding and amount rounding both pushing the same way)', async () => {
      await setMode('block');
      const c = await asCustomer();
      const rnd = mulberry32(20261017);
      const offers = [null, { type: 'percentage', value: 10 }, { type: 'percentage', value: 33 }, { type: 'fixed', value: 1.25 }];
      let failures = 0;
      let worstSlack = Infinity;
      for (let i = 0; i < 3000; i += 1) {
        const type = [types.cash, types.fixedFee, types.usd][i % 3];
        const max = type.max_amount ? Number(type.max_amount) : 3000;
        const amount = type.min_amount + rnd() * (Math.min(max, 3000) - type.min_amount);
        const raw = i % 2 === 0 ? amount : Math.round(amount * 100) / 100;
        const calc = clientCalc(type, raw, offers[i % offers.length]);
        const payload = payloadFor(type, raw, {
          commission_total: calc.commission_total, amount_to_deliver: calc.amount_to_deliver,
          ...(calc.discount ? { discount_amount: calc.discount } : {})
        });
        const r = await probe(c, payload);
        if (!r.ok) failures += 1;
        const stored = { sent: Math.round(raw * 100) / 100, comm: Math.round(calc.commission_total * 100) / 100, deliver: Math.round(calc.amount_to_deliver * 100) / 100 };
        const cap = (stored.sent - stored.comm) * calc.rate + 0.0125 * calc.rate + 0.0001 * stored.sent + 0.02;
        worstSlack = Math.min(worstSlack, cap - stored.deliver);
      }
      expect(failures).toBe(0);
      expect(worstSlack).toBeGreaterThan(0);
    }, 120000);
  });
});
