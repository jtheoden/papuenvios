/**
 * Admin override of the commission of a pending remittance (F4a, decisions ND-3 / ND-4 / ND-5).
 *
 * Migration under test: 20261023120000_remittance_commission_override.sql
 *   * table remittance_commission_overrides (append-only history: commission, standard, reason, who, when). It is the ONLY
 *     place the override and its reason live: remittances gets no new column, so the owner of a remittance (who can
 *     SELECT the whole row) can neither read the reason nor tell that the commission was adjusted (ND-5).
 *   * RPC admin_set_remittance_commission(id, commission, reason): SECURITY DEFINER, admin only, payment_pending /
 *     payment_rejected only, discount_amount forced to 0, amount_to_deliver = round((sent - commission) * rate4, 2)
 *   * recalculate_remittance_at_current_rate keeps the latest override
 *   * offer_id joins the audited / guarded columns
 *
 * The suite does not list the new objects in `needs`: a missing migration fails loudly (red phase).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dbSuiteSkipReason, connectAdmin, connectAs, connectAnon, endAll, fireTogether } from './db';
import { loadActors } from './fixtures';
import { calcCommissionOverride } from '../../lib/commissionOverrideRules';

const MIGRATION = 'supabase/migrations/20261023120000_remittance_commission_override.sql';
const ROLLBACK = 'supabase/rollbacks/20261023120000_remittance_commission_override_down.sql';
const REASON = 'Cliente frecuente, acuerdo comercial';
const SET = 'SELECT * FROM public.admin_set_remittance_commission($1::uuid, $2::numeric, $3::text)';
const TABLE = 'public.remittance_commission_overrides';

const skipReason = await dbSuiteSkipReason({
  functions: ['is_admin_user', 'is_super_admin', 'recalculate_remittance_at_current_rate', 'financial_audit_columns'],
  tables: ['remittances', 'remittance_types', 'offers', 'financial_audit_log']
});
const describeDb = skipReason ? describe.skip : describe;

const failure = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the statement to fail, but it succeeded');
};

describeDb('admin_set_remittance_commission', () => {
  let admin;
  let actors;
  const clients = [];
  const remittances = [];
  const remittanceTypes = [];
  const offers = [];

  const as = async (userId) => {
    const c = await connectAs(userId);
    clients.push(c);
    return c;
  };

  const seedType = async ({ rate = 800, pct = 2.5, fixed = 0 } = {}) => {
    const { rows } = await admin.query(
      `INSERT INTO public.remittance_types (name, currency_code, delivery_currency, exchange_rate,
                                            commission_percentage, commission_fixed, min_amount, delivery_method)
       VALUES ($1, 'USD', 'CUP', $2, $3, $4, 0.01, 'transfer') RETURNING id`,
      [`co-${randomUUID().slice(0, 8)}`, rate, pct, fixed]
    );
    remittanceTypes.push(rows[0].id);
    return rows[0].id;
  };

  const seedOffer = async (discountType, value) => {
    const { rows } = await admin.query(
      `INSERT INTO public.offers (name_es, name_en, discount_type, discount_value, start_date, end_date, applies_to, is_active, code)
       VALUES ('o','o',$1,$2, now() - interval '3 days', now() + interval '3 days', 'all', true, $3) RETURNING id`,
      [discountType, value, `CO${randomUUID().slice(0, 8)}`]
    );
    offers.push(rows[0].id);
    return rows[0].id;
  };

  /** 100 USD at 800 with the type's 2.5% => standard commission 2.50, delivery 78000. */
  const seedRemittance = async (typeId, { status = 'payment_pending', amount = 100, rate = 800, offerId = null, discount = 0 } = {}) => {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO public.remittances (id, user_id, remittance_type_id, amount_sent, exchange_rate,
         commission_percentage, commission_fixed, commission_total, amount_to_deliver, currency_sent,
         currency_delivered, recipient_name, recipient_phone, status, offer_id, discount_amount)
       VALUES ($1,$2,$3,$4,$5,2.5,0,2.5,78000,'USD','CUP','Rcpt','+5355550100',$6,$7,$8)`,
      [id, actors.customerId, typeId, amount, rate, status, offerId, discount]
    );
    remittances.push(id);
    return id;
  };

  const read = async (id) => (await admin.query('SELECT * FROM public.remittances WHERE id = $1', [id])).rows[0];
  const overrideRows = async (id) =>
    (await admin.query(`SELECT * FROM ${TABLE} WHERE remittance_id = $1 ORDER BY id`, [id])).rows;
  const auditRows = async (id) =>
    (await admin.query(
      `SELECT column_name, old_value, new_value, changed_by, changed_by_role, via_function
         FROM public.financial_audit_log WHERE row_id = $1 ORDER BY id`, [id])).rows;

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
  });

  afterEach(async () => {
    await endAll(clients.splice(0));
    await admin.query(`UPDATE public.user_profiles SET role = 'admin', is_enabled = true WHERE id = $1`, [actors.adminId]);
    if (remittances.length) await admin.query('DELETE FROM public.remittances WHERE id = ANY($1)', [remittances.splice(0)]); // cascades to the overrides
    if (remittanceTypes.length) await admin.query('DELETE FROM public.remittance_types WHERE id = ANY($1)', [remittanceTypes.splice(0)]);
    if (offers.length) await admin.query('DELETE FROM public.offers WHERE id = ANY($1)', [offers.splice(0)]);
  });

  afterAll(async () => {
    await admin.end();
  });

  describe('rejections', () => {
    it('the owner (customer) cannot call it', async () => {
      const rid = await seedRemittance(await seedType());
      const c = await as(actors.customerId);
      expect((await failure(c.query(SET, [rid, 1, REASON]))).code).toBe('42501');
    });

    it('anon cannot execute it; a disabled admin is refused', async () => {
      const rid = await seedRemittance(await seedType());
      const anon = await connectAnon();
      clients.push(anon);
      expect((await failure(anon.query(SET, [rid, 1, REASON]))).code).toBe('42501');
      await admin.query(`UPDATE public.user_profiles SET is_enabled = false WHERE id = $1`, [actors.adminId]);
      const c = await as(actors.adminId);
      expect((await failure(c.query(SET, [rid, 1, REASON]))).code).toBe('42501');
    });

    it('unknown remittance => P0002', async () => {
      const c = await as(actors.adminId);
      expect((await failure(c.query(SET, [randomUUID(), 1, REASON]))).code).toBe('P0002');
    });

    it.each(['processing', 'completed', 'payment_proof_uploaded', 'cancelled'])('status %s is refused (22023)', async (status) => {
      const rid = await seedRemittance(await seedType(), { status });
      const c = await as(actors.adminId);
      const err = await failure(c.query(SET, [rid, 1, REASON]));
      expect(err.code).toBe('22023');
      expect(err.message).toMatch(/invalid_status/);
    });

    it.each([
      ['empty', ''],
      ['whitespace only', '          '],
      ['NULL', null],
      ['shorter than 10 characters', 'too short'],
      ['longer than 500 characters', 'x'.repeat(501)]
    ])('reason %s is refused', async (_label, reason) => {
      const rid = await seedRemittance(await seedType());
      const c = await as(actors.adminId);
      const err = await failure(c.query(SET, [rid, 1, reason]));
      expect(err.code).toBe('22023');
      expect(err.message).toMatch(/invalid_reason/);
    });

    it.each([
      ['negative', -0.01],
      ['equal to the amount sent', 100],
      ['above the amount sent', 150],
      ['with more than 2 decimals', 1.005],
      ['NULL', null]
    ])('commission %s is refused', async (_label, value) => {
      const rid = await seedRemittance(await seedType());
      const c = await as(actors.adminId);
      const err = await failure(c.query(SET, [rid, value, REASON]));
      expect(err.code).toBe('22023');
      expect(err.message).toMatch(/invalid_commission/);
    });

    it('a refused call leaves the remittance and the history untouched', async () => {
      const rid = await seedRemittance(await seedType());
      const c = await as(actors.adminId);
      await failure(c.query(SET, [rid, 100, REASON]));
      expect(Number((await read(rid)).commission_total)).toBe(2.5);
      expect(await overrideRows(rid)).toEqual([]);
    });
  });

  describe('happy path', () => {
    it('stores the final commission on the remittance and who / why / the standard in the history table', async () => {
      const rid = await seedRemittance(await seedType());
      const c = await as(actors.adminId);
      const { rows } = await c.query(SET, [rid, 5, `  ${REASON}  `]);
      expect(rows[0].id).toBe(rid);
      const row = await read(rid);
      expect(Number(row.commission_total)).toBe(5);
      expect(Number(row.discount_amount)).toBe(0);
      expect(Number(row.amount_to_deliver)).toBe(76000);
      const hist = await overrideRows(rid);
      expect(hist).toHaveLength(1);
      expect(hist[0]).toMatchObject({ reason: REASON, set_by: actors.adminId });
      expect([Number(hist[0].commission), Number(hist[0].standard_commission)]).toEqual([5, 2.5]);
      expect(hist[0].set_at).not.toBeNull();
      const inv = await admin.query(
        'SELECT amount_to_deliver = round((amount_sent - commission_total) * exchange_rate, 2) AS ok FROM public.remittances WHERE id = $1', [rid]);
      expect(inv.rows[0].ok).toBe(true);
    });

    it('remittances gets NO override column (nothing for the owner to read)', async () => {
      const { rows } = await admin.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'remittances' AND column_name LIKE 'commission\\_%'
          ORDER BY column_name`);
      expect(rows.map((r) => r.column_name)).toEqual(['commission_fixed', 'commission_percentage', 'commission_total']);
    });

    it('allows an override below and above the standard commission (ND-4), and 0', async () => {
      const rid = await seedRemittance(await seedType());
      const c = await as(actors.adminId);
      expect(Number((await c.query(SET, [rid, 1, REASON])).rows[0].amount_to_deliver)).toBe(79200);
      expect(Number((await c.query(SET, [rid, 0, REASON])).rows[0].amount_to_deliver)).toBe(80000);
      expect(Number((await c.query(SET, [rid, 99.99, REASON])).rows[0].amount_to_deliver)).toBe(8);
    });

    it('keeps the history: a second override appends a row and recomputes the standard', async () => {
      const typeId = await seedType();
      const rid = await seedRemittance(typeId);
      const c = await as(actors.adminId);
      await c.query(SET, [rid, 5, REASON]);
      await admin.query('UPDATE public.remittance_types SET commission_percentage = 4 WHERE id = $1', [typeId]);
      await c.query(SET, [rid, 3, 'Second adjustment agreed with the customer']);
      const hist = await overrideRows(rid);
      expect(hist.map((h) => [Number(h.commission), Number(h.standard_commission)])).toEqual([[5, 2.5], [3, 4]]);
      expect(Number((await read(rid)).commission_total)).toBe(3);
    });

    it('the override is the final commission: the offer discount is zeroed (ND-3) and the standard already reflects the offer', async () => {
      const offerId = await seedOffer('percentage', 20);
      const rid = await seedRemittance(await seedType(), { offerId, discount: 0.5 });
      const c = await as(actors.adminId);
      await c.query(SET, [rid, 4, REASON]);
      const row = await read(rid);
      expect(Number(row.discount_amount)).toBe(0);
      expect(Number(row.commission_total)).toBe(4);
      expect(Number((await overrideRows(rid))[0].standard_commission)).toBe(2); // 2.50 gross minus 20% = 2.00
      expect(row.offer_id).toBe(offerId);
    });

    it('a super_admin may also set it; payment_rejected works too', async () => {
      await admin.query(`UPDATE public.user_profiles SET role = 'super_admin' WHERE id = $1`, [actors.adminId]);
      const rid = await seedRemittance(await seedType(), { status: 'payment_rejected' });
      const c = await as(actors.adminId);
      expect(Number((await c.query(SET, [rid, 3, REASON])).rows[0].commission_total)).toBe(3);
    });

    it('the stored delivery equals the JS preview for a rate with more than 4 decimals (same rate4 rule)', async () => {
      const rid = await seedRemittance(await seedType(), { rate: 800.12345 }); // numeric(12,4) stores 800.1235
      const c = await as(actors.adminId);
      const { rows } = await c.query(SET, [rid, 3.33, REASON]);
      const preview = calcCommissionOverride({ amountSent: 100, exchangeRate: 800.12345, commission: 3.33, standardCommission: 2.5 });
      expect(Number(rows[0].exchange_rate)).toBe(800.1235);
      expect(Number(rows[0].amount_to_deliver)).toBe(preview.amountToDeliver);
    });
  });

  describe('privacy of the reason (ND-5)', () => {
    it('the owner reads nothing from the history table (RLS) even when an override exists, but still reads the remittance', async () => {
      const rid = await seedRemittance(await seedType());
      const adm = await as(actors.adminId);
      await adm.query(SET, [rid, 5, REASON]);
      const cust = await as(actors.customerId);
      expect((await cust.query(`SELECT * FROM ${TABLE}`)).rows).toEqual([]);
      expect((await cust.query(`SELECT reason, set_by FROM ${TABLE} WHERE remittance_id = $1`, [rid])).rows).toEqual([]);
      const own = await cust.query('SELECT * FROM public.remittances WHERE id = $1', [rid]);
      expect(own.rows).toHaveLength(1);
      expect(JSON.stringify(own.rows[0])).not.toContain(REASON);
      expect(Object.keys(own.rows[0]).filter((k) => /override|reason_|standard/.test(k))).toEqual([]);
    });

    it('an admin reads the history', async () => {
      const rid = await seedRemittance(await seedType());
      const adm = await as(actors.adminId);
      await adm.query(SET, [rid, 5, REASON]);
      const { rows } = await adm.query(`SELECT reason, set_by, commission FROM ${TABLE} WHERE remittance_id = $1`, [rid]);
      expect(rows).toEqual([{ reason: REASON, set_by: actors.adminId, commission: '5.00' }]);
    });

    it('anon has no access; nobody can write the table directly, not even an admin (only the RPC does)', async () => {
      const rid = await seedRemittance(await seedType());
      const anon = await connectAnon();
      clients.push(anon);
      expect((await failure(anon.query(`SELECT * FROM ${TABLE}`))).code).toBe('42501');
      const adm = await as(actors.adminId);
      await adm.query(SET, [rid, 5, REASON]);
      for (const sql of [
        `INSERT INTO ${TABLE} (remittance_id, commission, standard_commission, reason, set_by) VALUES ('${rid}', 1, 1, '${REASON}', '${actors.adminId}')`,
        `UPDATE ${TABLE} SET reason = 'rewritten history here'`,
        `DELETE FROM ${TABLE}`
      ]) {
        expect((await failure(adm.query(sql))).code, sql).toBe('42501');
      }
    });

    it('privileges: only SELECT for authenticated, no PUBLIC grant, RLS on', async () => {
      const { rows } = await admin.query(
        `SELECT c.relrowsecurity,
                has_table_privilege('authenticated', c.oid, 'SELECT') AS sel,
                has_table_privilege('authenticated', c.oid, 'INSERT') AS ins,
                has_table_privilege('authenticated', c.oid, 'UPDATE') AS upd,
                has_table_privilege('authenticated', c.oid, 'DELETE') AS del,
                has_table_privilege('anon', c.oid, 'SELECT') AS anon_sel
           FROM pg_class c WHERE c.oid = '${TABLE}'::regclass`);
      expect(rows[0]).toEqual({ relrowsecurity: true, sel: true, ins: false, upd: false, del: false, anon_sel: false });
    });
  });

  describe('audit trail', () => {
    it('records commission_total, amount_to_deliver and the discount reset, attributed to the RPC and the admin', async () => {
      const rid = await seedRemittance(await seedType(), { discount: 0.5 });
      const c = await as(actors.adminId);
      await c.query(SET, [rid, 5, REASON]);
      const rows = await auditRows(rid);
      expect(rows.map((r) => r.column_name).sort()).toEqual(['amount_to_deliver', 'commission_total', 'discount_amount']);
      expect(rows.every((r) => r.via_function === 'admin_set_remittance_commission' && r.changed_by === actors.adminId && r.changed_by_role === 'admin')).toBe(true);
      expect(rows.find((r) => r.column_name === 'commission_total')).toMatchObject({ old_value: '2.50', new_value: '5.00' });
    });

    it('offer_id is a monitored and guarded column', async () => {
      const { rows } = await admin.query(`SELECT public.financial_audit_columns('remittances') AS cols`);
      expect(rows[0].cols).toContain('offer_id');
      const def = (await admin.query(
        `SELECT pg_get_triggerdef(oid) AS d, tgenabled FROM pg_trigger
          WHERE tgrelid = 'public.remittances'::regclass AND tgname = 'audit_financial_update'`)).rows[0];
      expect(def.d).toMatch(/offer_id/);
      expect(def.tgenabled).toBe('A');
    });

    it('a direct PATCH of offer_id by an admin is rejected (money-columns guard); the audit records an offer_id change made by an RPC-like session', async () => {
      const offerId = await seedOffer('percentage', 10);
      const rid = await seedRemittance(await seedType());
      const c = await as(actors.adminId);
      const err = await failure(c.query('UPDATE public.remittances SET offer_id = $2 WHERE id = $1', [rid, offerId]));
      expect(err.code).toBe('42501');
      expect(err.message).toMatch(/remittance_money_columns_rpc_only/);
      await admin.query('UPDATE public.remittances SET offer_id = $2 WHERE id = $1', [rid, offerId]);
      expect((await auditRows(rid)).map((r) => r.column_name)).toEqual(['offer_id']);
    });
  });

  describe('recalculate_remittance_at_current_rate respects the override', () => {
    it('keeps the latest commission and refreshes the rate and the delivery amount', async () => {
      const typeId = await seedType();
      const rid = await seedRemittance(typeId);
      const adm = await as(actors.adminId);
      await adm.query(SET, [rid, 5, REASON]);
      await admin.query('UPDATE public.remittance_types SET exchange_rate = 900, commission_percentage = 3 WHERE id = $1', [typeId]);
      const cust = await as(actors.customerId);
      const { rows } = await cust.query('SELECT * FROM public.recalculate_remittance_at_current_rate($1)', [rid]);
      expect(Number(rows[0].commission_total)).toBe(5);
      expect(Number(rows[0].discount_amount)).toBe(0);
      expect(Number(rows[0].exchange_rate)).toBe(900);
      expect(Number(rows[0].amount_to_deliver)).toBe(85500);
      expect(await overrideRows(rid)).toHaveLength(1); // the history is not touched by a re-pricing
    });

    it('uses the LATEST override when there are several', async () => {
      const rid = await seedRemittance(await seedType());
      const adm = await as(actors.adminId);
      await adm.query(SET, [rid, 5, REASON]);
      await adm.query(SET, [rid, 1, REASON]);
      const { rows } = await adm.query('SELECT * FROM public.recalculate_remittance_at_current_rate($1)', [rid]);
      expect(Number(rows[0].commission_total)).toBe(1);
    });

    it('without an override pricing follows the type', async () => {
      const rid = await seedRemittance(await seedType({ pct: 4 }));
      const cust = await as(actors.customerId);
      const { rows } = await cust.query('SELECT * FROM public.recalculate_remittance_at_current_rate($1)', [rid]);
      expect(Number(rows[0].commission_total)).toBe(4);
    });
  });

  describe('structure', () => {
    it('history CHECKs: reason 10..500, commission and standard >= 0; deleting the remittance cascades', async () => {
      const rid = await seedRemittance(await seedType());
      const ins = (reason, commission = 1, standard = 1) => admin.query(
        `INSERT INTO ${TABLE} (remittance_id, commission, standard_commission, reason, set_by) VALUES ($1, $2, $3, $4, $5)`,
        [rid, commission, standard, reason, actors.adminId]);
      expect((await failure(ins('short'))).code).toBe('23514');
      expect((await failure(ins(REASON, -1))).code).toBe('23514');
      expect((await failure(ins(REASON, 1, -1))).code).toBe('23514');
      await ins(REASON);
      await admin.query('DELETE FROM public.remittances WHERE id = $1', [rid]);
      expect(await overrideRows(rid)).toEqual([]);
    });

    it('SECURITY DEFINER hygiene: pinned search_path, no PUBLIC / anon grant, authenticated only', async () => {
      const { rows } = await admin.query(
        `SELECT p.prosecdef, p.proconfig,
                has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
                (SELECT coalesce(bool_or(a.grantee = 0), false) FROM aclexplode(p.proacl) a) AS public_grant
           FROM pg_proc p WHERE p.oid = 'public.admin_set_remittance_commission(uuid, numeric, text)'::regprocedure`);
      expect(rows[0]).toMatchObject({ prosecdef: true, anon: false, authenticated: true, public_grant: false });
      expect(rows[0].proconfig).toContain('search_path=public, pg_temp');
    });
  });

  describe('concurrency', () => {
    it('two simultaneous overrides on the same remittance serialize and leave a consistent row and history', async () => {
      const rid = await seedRemittance(await seedType());
      const a = await as(actors.adminId);
      const b = await as(actors.adminId);
      const results = await fireTogether([
        { client: a, sql: 'public.admin_set_remittance_commission($1::uuid, 3::numeric, $2::text)', params: [rid, REASON] },
        { client: b, sql: 'public.admin_set_remittance_commission($1::uuid, 7::numeric, $2::text)', params: [rid, REASON] }
      ]);
      expect(results.filter((r) => r.error)).toEqual([]);
      const row = await read(rid);
      const hist = await overrideRows(rid);
      expect(hist).toHaveLength(2);
      expect(Number(row.commission_total)).toBe(Number(hist[1].commission)); // the last writer wins, consistently
      expect(Number(row.amount_to_deliver)).toBe(Math.round((100 - Number(row.commission_total)) * 800 * 100) / 100);
      expect((await auditRows(rid)).filter((r) => r.column_name === 'commission_total')).toHaveLength(2);
    });
  });

  describe('migration file properties', () => {
    it('has a header with the rollback, a transaction and no new column on remittances; the rollback script drops the table', () => {
      const sql = readFileSync(MIGRATION, 'utf8');
      expect(sql.split('\n').slice(0, 40).join('\n')).toMatch(/ROLLBACK/);
      expect(sql).toMatch(/^BEGIN;/m);
      expect(sql).toMatch(/^COMMIT;/m);
      expect(sql).not.toMatch(/ALTER TABLE public\.remittances\s+ADD COLUMN/i);
      const down = readFileSync(ROLLBACK, 'utf8');
      expect(down).toMatch(/DROP FUNCTION IF EXISTS public\.admin_set_remittance_commission/);
      expect(down).toMatch(/DROP TABLE IF EXISTS public\.remittance_commission_overrides/);
    });
  });
});
