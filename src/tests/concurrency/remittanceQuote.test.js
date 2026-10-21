/**
 * Remittance rounding contract in SQL: public._remittance_quote + recalculate_remittance_at_current_rate.
 *
 * Migration under test: 20261023100000_remittance_quote_and_recalculate.sql
 * The golden vectors are the SAME fixture the Vitest unit tests use for the JS twin
 * (src/lib/remittanceCalculations.js), so JS and SQL cannot drift apart silently.
 *
 * The suite deliberately does not list the new objects in `needs`: a missing migration fails loudly (red phase).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dbSuiteSkipReason, connectAdmin, connectAs, connectAnon, endAll } from './db';
import { loadActors } from './fixtures';
import golden from '../fixtures/remittanceGoldenVectors.json';

const MIGRATION = 'supabase/migrations/20261023100000_remittance_quote_and_recalculate.sql';

const skipReason = await dbSuiteSkipReason({
  functions: ['is_admin_user', 'recalculate_remittance_at_current_rate'],
  tables: ['exchange_rates', 'remittances', 'remittance_types', 'offers']
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

const QUOTE = 'SELECT * FROM public._remittance_quote($1::numeric, $2::numeric, $3::numeric, $4::numeric, $5::text, $6::numeric)';

describeDb('_remittance_quote and recalculate_remittance_at_current_rate (rounding contract)', () => {
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

  const seedType = async ({ rate = 800, pct = 0, fixed = 0 } = {}) => {
    const { rows } = await admin.query(
      `INSERT INTO public.remittance_types (name, currency_code, delivery_currency, exchange_rate,
                                            commission_percentage, commission_fixed, min_amount, delivery_method)
       VALUES ($1, 'USD', 'CUP', $2, $3, $4, 0.01, 'cash') RETURNING id`,
      [`rq-${randomUUID().slice(0, 8)}`, rate, pct, fixed]
    );
    remittanceTypes.push(rows[0].id);
    return rows[0].id;
  };

  const seedOffer = async (discountType, value) => {
    const { rows } = await admin.query(
      `INSERT INTO public.offers (name_es, name_en, discount_type, discount_value, start_date, end_date, applies_to, is_active, code)
       VALUES ('o','o',$1,$2, now() - interval '3 days', now() - interval '1 day', 'all', false, $3) RETURNING id`,
      [discountType, value, `RQ${randomUUID().slice(0, 8)}`]
    );
    offers.push(rows[0].id);
    return rows[0].id;
  };

  const seedRemittance = async (typeId, { amount = 100, status = 'payment_pending', offerId = null, discount = 0 } = {}) => {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO public.remittances (id, user_id, remittance_type_id, amount_sent, exchange_rate,
         commission_percentage, commission_fixed, commission_total, amount_to_deliver, currency_sent,
         currency_delivered, recipient_name, recipient_phone, status, offer_id, discount_amount)
       VALUES ($1,$2,$3,$4,1,0,0,0,$4,'USD','CUP','Rcpt','+5355550100',$5,$6,$7)`,
      [id, actors.customerId, typeId, amount, status, offerId, discount]
    );
    remittances.push(id);
    return id;
  };

  const recalc = (client, id) => client.query('SELECT * FROM public.recalculate_remittance_at_current_rate($1)', [id]);

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
  });

  afterEach(async () => {
    await endAll(clients.splice(0));
    if (remittances.length) await admin.query('DELETE FROM public.remittances WHERE id = ANY($1)', [remittances.splice(0)]);
    if (remittanceTypes.length) await admin.query('DELETE FROM public.remittance_types WHERE id = ANY($1)', [remittanceTypes.splice(0)]);
    if (offers.length) await admin.query('DELETE FROM public.offers WHERE id = ANY($1)', [offers.splice(0)]);
  });

  afterAll(async () => {
    await admin.end();
  });

  describe('_remittance_quote against the shared golden vectors', () => {
    it.each(golden.forward.map((v) => [v.name, v]))('%s', async (_name, v) => {
      const { rows } = await admin.query(QUOTE, [
        v.input.amount, v.input.pct, v.input.fixed, v.input.rate,
        v.input.offer?.discount_type ?? null, v.input.offer?.discount_value ?? null
      ]);
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].amount_sent)).toBe(v.expected.amountSent);
      expect(Number(rows[0].gross)).toBe(v.expected.gross);
      expect(Number(rows[0].discount)).toBe(v.expected.discount);
      expect(Number(rows[0].commission_total)).toBe(v.expected.commission);
      expect(Number(rows[0].amount_to_deliver)).toBe(v.expected.amountToDeliver);
    });

    it.each(golden.reverse.map((v) => [v.name, v]))('reverse vector delivers at least D, checked in SQL: %s', async (_name, v) => {
      const { rows } = await admin.query(QUOTE, [v.expected.amountToSend, v.input.pct, v.input.fixed, v.input.rate, null, null]);
      expect(Number(rows[0].amount_to_deliver)).toBe(v.expected.amountToDeliver);
      expect(Number(rows[0].amount_to_deliver)).toBeGreaterThanOrEqual(v.input.desired);
      expect(Number(rows[0].commission_total)).toBe(v.expected.commission);
    });

    it('stored invariant: amount_to_deliver = round((amount_sent - commission_total) * rate4, 2)', async () => {
      for (const v of golden.forward) {
        const { rows } = await admin.query(QUOTE, [
          v.input.amount, v.input.pct, v.input.fixed, v.input.rate,
          v.input.offer?.discount_type ?? null, v.input.offer?.discount_value ?? null
        ]);
        const check = await admin.query(
          'SELECT round(($1::numeric - $2::numeric) * $3::numeric, 2) AS expected', [rows[0].amount_sent, rows[0].commission_total, rows[0].rate4]
        );
        expect(Number(rows[0].amount_to_deliver), v.name).toBe(Number(check.rows[0].expected));
      }
    });
  });

  describe('_remittance_quote hygiene', () => {
    it('is IMMUTABLE, pins its search_path and is not executable by PUBLIC / anon / authenticated', async () => {
      const { rows } = await admin.query(
        `SELECT p.provolatile AS vol, p.proconfig AS config,
                has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
                (SELECT coalesce(bool_or(a.grantee = 0), false) FROM aclexplode(p.proacl) a) AS public_grant
           FROM pg_proc p WHERE p.proname = '_remittance_quote' AND p.pronamespace = 'public'::regnamespace`
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ vol: 'i', anon: false, authenticated: false, public_grant: false });
      expect(rows[0].config).toContain('search_path=public, pg_temp');
    });

    it('an authenticated client cannot call it', async () => {
      const c = await as(actors.customerId);
      expect((await failure(c.query(QUOTE, [100, 2.5, 0, 800, null, null]))).code).toBe('42501');
      const anon = await connectAnon();
      clients.push(anon);
      expect((await failure(anon.query(QUOTE, [100, 2.5, 0, 800, null, null]))).code).toBe('42501');
    });
  });

  describe('recalculate_remittance_at_current_rate rounds per step', () => {
    it('REM-2026-001125 case: 765 at 800 and 2.5% stores commission 19.13 and delivery 596696.00', async () => {
      const rid = await seedRemittance(await seedType({ rate: 800, pct: 2.5 }), { amount: 765 });
      const c = await as(actors.customerId);
      const { rows } = await recalc(c, rid);
      expect(Number(rows[0].commission_total)).toBe(19.13);
      expect(Number(rows[0].amount_to_deliver)).toBe(596696);
    });

    it('uses the full-precision percentage of the type and satisfies the stored invariant', async () => {
      const rid = await seedRemittance(await seedType({ rate: 820, pct: 2.4390243902 }), { amount: 100 });
      const c = await as(actors.adminId);
      const { rows } = await recalc(c, rid);
      expect(Number(rows[0].commission_total)).toBe(2.44);
      expect(Number(rows[0].amount_to_deliver)).toBe(79999.2);
      const inv = await admin.query(
        'SELECT amount_to_deliver = round((amount_sent - commission_total) * exchange_rate, 2) AS ok FROM public.remittances WHERE id = $1', [rid]
      );
      expect(inv.rows[0].ok).toBe(true);
    });

    it('keeps a percentage discount from the offer, even if the offer has expired (ND-2)', async () => {
      const offerId = await seedOffer('percentage', 15);
      const rid = await seedRemittance(await seedType({ rate: 800, pct: 2.5, fixed: 1 }), { amount: 100, offerId, discount: 0.53 });
      const c = await as(actors.customerId);
      const { rows } = await recalc(c, rid);
      expect(Number(rows[0].discount_amount)).toBe(0.53);
      expect(Number(rows[0].commission_total)).toBe(2.97);
      expect(Number(rows[0].amount_to_deliver)).toBe(77624);
    });

    it('re-derives the discount from the offer when the commission changes (offer is the source, not the stored value)', async () => {
      const offerId = await seedOffer('percentage', 50);
      const typeId = await seedType({ rate: 800, pct: 2.5 });
      const rid = await seedRemittance(typeId, { amount: 100, offerId, discount: 99 }); // stale stored value
      const c = await as(actors.customerId);
      const { rows } = await recalc(c, rid);
      expect(Number(rows[0].discount_amount)).toBe(1.25);
      expect(Number(rows[0].commission_total)).toBe(1.25);
    });

    it('fixed_amount offers are capped at the gross commission', async () => {
      const offerId = await seedOffer('fixed_amount', 50);
      const rid = await seedRemittance(await seedType({ rate: 800, pct: 2.5 }), { amount: 200, offerId });
      const c = await as(actors.customerId);
      const { rows } = await recalc(c, rid);
      expect(Number(rows[0].discount_amount)).toBe(5);
      expect(Number(rows[0].commission_total)).toBe(0);
      expect(Number(rows[0].amount_to_deliver)).toBe(160000);
    });

    it('without an offer row keeps the stored discount_amount, capped at the gross commission', async () => {
      const typeId = await seedType({ rate: 800, pct: 2.5 });
      const keep = await seedRemittance(typeId, { amount: 200, discount: 2 });
      const cap = await seedRemittance(typeId, { amount: 200, discount: 40 });
      const c = await as(actors.customerId);
      const a = (await recalc(c, keep)).rows[0];
      expect([Number(a.discount_amount), Number(a.commission_total)]).toEqual([2, 3]);
      const b = (await recalc(c, cap)).rows[0];
      expect([Number(b.discount_amount), Number(b.commission_total)]).toEqual([5, 0]);
      expect(Number(b.amount_to_deliver)).toBe(160000);
    });

    it('keeps the permission and status checks', async () => {
      const typeId = await seedType();
      const foreign = await seedRemittance(typeId);
      await admin.query('UPDATE public.remittances SET user_id = $1 WHERE id = $2', [actors.adminId, foreign]);
      const customer = await as(actors.customerId);
      expect((await failure(recalc(customer, foreign))).code).toBe('42501');
      const done = await seedRemittance(typeId, { status: 'completed' });
      expect((await failure(recalc(customer, done))).code).toBe('22023');
    });
  });

  describe('migration file properties', () => {
    it('documents its rollback, runs in a transaction and ships a rollback script', () => {
      const sql = readFileSync(MIGRATION, 'utf8');
      expect(sql.split('\n').slice(0, 40).join('\n')).toMatch(/ROLLBACK/);
      expect(sql).toMatch(/^BEGIN;/m);
      expect(sql).toMatch(/^COMMIT;/m);
      expect(readFileSync('supabase/rollbacks/20261023100000_remittance_quote_and_recalculate_down.sql', 'utf8'))
        .toMatch(/recalculate_remittance_at_current_rate/);
    });
  });
});
