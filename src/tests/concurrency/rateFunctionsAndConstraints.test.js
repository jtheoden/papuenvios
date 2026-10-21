/**
 * Fix of two broken SECURITY DEFINER functions + hardening of exchange_rates.
 *
 * Migration under test:
 *   20261016140000_fix_rate_functions_and_exchange_rates_constraints.sql
 *
 *   * get_remittance_bank_accounts_admin referenced remittances.delivery_amount (the column is amount_to_deliver).
 *   * recalculate_remittance_at_current_rate referenced the dropped table official_currency_rates.
 *   * exchange_rates gets CHECK rate > 0, CHECK from <> to (NOT VALID: a legacy inactive USD->USD row exists in
 *     production) and a partial UNIQUE index: at most one ACTIVE row per directed pair.
 *
 * Runs against the LOCAL scratch database built by `npm run test:db:bootstrap`. The suite deliberately does NOT
 * list the new objects in `needs`, so a missing migration fails loudly (red phase) instead of skipping.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dbSuiteSkipReason, connectAdmin, connectAs, connectAnon, endAll } from './db';
import { loadActors } from './fixtures';

const MIGRATION = 'supabase/migrations/20261016140000_fix_rate_functions_and_exchange_rates_constraints.sql';
const UNIQUE_ACTIVE_INDEX = 'exchange_rates_one_active_per_pair';

const skipReason = await dbSuiteSkipReason({
  functions: ['is_admin_user', 'is_super_admin', 'recalculate_remittance_at_current_rate',
    'get_remittance_bank_accounts_admin'],
  tables: ['exchange_rates', 'remittances', 'remittance_types', 'currencies']
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

describeDb('rate functions fix + exchange_rates constraints', () => {
  let admin;
  let actors;
  let ids;
  const clients = [];
  const remittances = [];
  const remittanceTypes = [];
  const extra = { transfers: [], recipientAccounts: [], bankAccounts: [], recipients: [], banks: [], accountTypes: [] };

  const as = async (userId, role = 'authenticated') => {
    const c = await connectAs(userId, role);
    clients.push(c);
    return c;
  };
  const asAnon = async () => {
    const c = await connectAnon();
    clients.push(c);
    return c;
  };

  const setRate = (from, to, rate, { active = true, daysAgo = 0 } = {}) =>
    admin.query(
      `INSERT INTO public.exchange_rates (from_currency_id, to_currency_id, rate, is_active, effective_date)
       VALUES ($1, $2, $3, $4, CURRENT_DATE - $5::int) RETURNING *`,
      [from, to, rate, active, daysAgo]
    ).then((r) => r.rows[0]);

  const seedType = async ({ rate = 0, pct = 0, fixed = 0 } = {}) => {
    const { rows } = await admin.query(
      `INSERT INTO public.remittance_types (name, currency_code, delivery_currency, exchange_rate,
                                            commission_percentage, commission_fixed, min_amount, delivery_method)
       VALUES ($1, 'USD', 'CUP', $2, $3, $4, 1, 'cash') RETURNING id`,
      [`rf-${randomUUID().slice(0, 8)}`, rate, pct, fixed]
    );
    remittanceTypes.push(rows[0].id);
    return rows[0].id;
  };

  const seedRemittance = async (typeId, { owner = actors.customerId, amount = 100, sent = 'USD',
    delivered = 'CUP', status = 'payment_pending' } = {}) => {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO public.remittances (id, user_id, remittance_type_id, amount_sent, exchange_rate,
         commission_percentage, commission_fixed, commission_total, amount_to_deliver, currency_sent,
         currency_delivered, recipient_name, recipient_phone, status)
       VALUES ($1,$2,$3,$4,1,0,0,0,$4,$5,$6,'Rcpt','+5355550100',$7)`,
      [id, owner, typeId, amount, sent, delivered, status]
    );
    remittances.push(id);
    return id;
  };

  const recalc = (client, id) =>
    client.query(`SELECT * FROM public.recalculate_remittance_at_current_rate($1)`, [id]);
  const readRemittance = async (id) =>
    (await admin.query(`SELECT * FROM public.remittances WHERE id = $1`, [id])).rows[0];

  /** recipient + bank account + transfer for a remittance, so the admin RPC has a full join to return. */
  const seedBankTransfer = async (remittanceId) => {
    const bank = (await admin.query(`INSERT INTO public.banks (name) VALUES ($1) RETURNING id`, [`Bank ${randomUUID().slice(0, 6)}`])).rows[0].id;
    const type = (await admin.query(`INSERT INTO public.account_types (name) VALUES ($1) RETURNING id`, [`Type ${randomUUID().slice(0, 6)}`])).rows[0].id;
    const recipient = (await admin.query(
      `INSERT INTO public.recipients (user_id, full_name, phone) VALUES ($1, 'Rec Name', '+5355550101') RETURNING id`,
      [actors.customerId])).rows[0].id;
    await admin.query(`UPDATE public.remittances SET recipient_id = $1 WHERE id = $2`, [recipient, remittanceId]);
    const account = (await admin.query(
      `INSERT INTO public.bank_accounts (user_id, bank_id, account_type_id, currency_id, account_number_last4,
                                         account_number_hash, account_holder_name, account_number_full)
       VALUES ($1,$2,$3,$4,'1234',$5,'Holder Name','9999888877771234') RETURNING id`,
      [actors.customerId, bank, type, ids.cup, randomUUID()])).rows[0].id;
    const rba = (await admin.query(
      `INSERT INTO public.recipient_bank_accounts (recipient_id, bank_account_id) VALUES ($1,$2) RETURNING id`,
      [recipient, account])).rows[0].id;
    const rbt = (await admin.query(
      `INSERT INTO public.remittance_bank_transfers (remittance_id, recipient_bank_account_id) VALUES ($1,$2) RETURNING id`,
      [remittanceId, rba])).rows[0].id;
    extra.transfers.push(rbt);
    extra.recipientAccounts.push(rba);
    extra.bankAccounts.push(account);
    extra.recipients.push(recipient);
    extra.banks.push(bank);
    extra.accountTypes.push(type);
  };

  const fnPrivileges = async (signature) =>
    (await admin.query(
      `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', $1, 'EXECUTE') AS authenticated,
              (SELECT bool_or(a.grantee = 0) FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = $1::regprocedure) AS public_grant,
              (SELECT prosecdef FROM pg_proc WHERE oid = $1::regprocedure) AS secdef,
              (SELECT proconfig FROM pg_proc WHERE oid = $1::regprocedure) AS config`,
      [signature]
    )).rows[0];

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
    const { rows } = await admin.query(`SELECT code, id FROM public.currencies WHERE code IN ('USD', 'EUR', 'CUP')`);
    const byCode = Object.fromEntries(rows.map((r) => [r.code, r.id]));
    ids = { usd: byCode.USD, eur: byCode.EUR, cup: byCode.CUP };
  });

  afterEach(async () => {
    await endAll(clients.splice(0));
    await admin.query(`UPDATE public.user_profiles SET role = 'admin', is_enabled = true WHERE id = $1`, [actors.adminId]);
    if (extra.transfers.length) await admin.query(`DELETE FROM public.remittance_bank_transfers WHERE id = ANY($1)`, [extra.transfers.splice(0)]);
    if (remittances.length) await admin.query(`DELETE FROM public.remittances WHERE id = ANY($1)`, [remittances.splice(0)]);
    if (extra.recipientAccounts.length) await admin.query(`DELETE FROM public.recipient_bank_accounts WHERE id = ANY($1)`, [extra.recipientAccounts.splice(0)]);
    if (extra.bankAccounts.length) await admin.query(`DELETE FROM public.bank_accounts WHERE id = ANY($1)`, [extra.bankAccounts.splice(0)]);
    if (extra.recipients.length) await admin.query(`DELETE FROM public.recipients WHERE id = ANY($1)`, [extra.recipients.splice(0)]);
    if (extra.banks.length) await admin.query(`DELETE FROM public.banks WHERE id = ANY($1)`, [extra.banks.splice(0)]);
    if (extra.accountTypes.length) await admin.query(`DELETE FROM public.account_types WHERE id = ANY($1)`, [extra.accountTypes.splice(0)]);
    if (remittanceTypes.length) await admin.query(`DELETE FROM public.remittance_types WHERE id = ANY($1)`, [remittanceTypes.splice(0)]);
    await admin.query(`DELETE FROM public.exchange_rates WHERE from_currency_id = ANY($1::uuid[]) OR to_currency_id = ANY($1::uuid[])`,
      [[ids.usd, ids.eur, ids.cup]]);
  });

  afterAll(async () => {
    await admin.end();
  });

  // --------------------------------------------------------------------------------------------
  describe('get_remittance_bank_accounts_admin', () => {
    it('runs for an admin and returns the joined bank data with delivery_amount = amount_to_deliver', async () => {
      const rid = await seedRemittance(await seedType(), { amount: 250 });
      await seedBankTransfer(rid);
      const c = await as(actors.adminId);
      const { rows } = await c.query(`SELECT * FROM public.get_remittance_bank_accounts_admin($1)`, [rid]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        remittance_id: rid,
        recipient_name: 'Rec Name',
        recipient_phone: '+5355550101',
        currency_code: 'CUP',
        account_holder_name: 'Holder Name',
        account_number_full: '9999888877771234',
        account_number_last4: '1234'
      });
      expect(Number(rows[0].delivery_amount)).toBe(250);
    });

    it('denies a customer and anon; keeps the signature, SECURITY DEFINER hygiene and grants', async () => {
      const rid = await seedRemittance(await seedType());
      const customer = await as(actors.customerId);
      const err = await failure(customer.query(`SELECT * FROM public.get_remittance_bank_accounts_admin($1)`, [rid]));
      expect(err.message).toMatch(/Access denied/);
      const anon = await asAnon();
      const anonErr = await failure(anon.query(`SELECT * FROM public.get_remittance_bank_accounts_admin($1)`, [rid]));
      expect(anonErr.code).toBe('42501');

      const p = await fnPrivileges('public.get_remittance_bank_accounts_admin(uuid)');
      expect(p).toMatchObject({ anon: false, authenticated: true, secdef: true });
      expect(p.public_grant).toBeFalsy();
      expect(p.config).toContain('search_path=public, pg_temp');
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('recalculate_remittance_at_current_rate', () => {
    it('uses the active direct exchange_rates pair and seals the amounts (owner call)', async () => {
      await setRate(ids.usd, ids.cup, 790);
      const rid = await seedRemittance(await seedType({ pct: 2, fixed: 1 }), { amount: 100 });
      const c = await as(actors.customerId);
      const { rows } = await recalc(c, rid);
      expect(Number(rows[0].exchange_rate)).toBe(790);
      expect(Number(rows[0].commission_total)).toBe(3);
      expect(Number(rows[0].amount_to_deliver)).toBe(97 * 790);
      const stored = await readRemittance(rid);
      expect(Number(stored.exchange_rate)).toBe(790);
      expect(stored.id).toBe(rid);
    });

    it('allows an admin on a remittance it does not own', async () => {
      await setRate(ids.usd, ids.cup, 500);
      const rid = await seedRemittance(await seedType(), { amount: 10 });
      const c = await as(actors.adminId);
      const { rows } = await recalc(c, rid);
      expect(Number(rows[0].amount_to_deliver)).toBe(5000);
    });

    it('denies a customer that does not own the remittance, and anon', async () => {
      await setRate(ids.usd, ids.cup, 790);
      const rid = await seedRemittance(await seedType(), { owner: actors.adminId });
      const customer = await as(actors.customerId);
      expect((await failure(recalc(customer, rid))).code).toBe('42501');
      const anon = await asAnon();
      expect((await failure(recalc(anon, rid))).code).toBe('42501');
    });

    it('rejects statuses other than payment_pending / payment_rejected', async () => {
      await setRate(ids.usd, ids.cup, 790);
      const rid = await seedRemittance(await seedType(), { status: 'completed' });
      const c = await as(actors.customerId);
      expect((await failure(recalc(c, rid))).code).toBe('22023');
    });

    it('fails closed (exchange_rate_unavailable) when there is no active direct pair, and leaves the row untouched', async () => {
      const rid = await seedRemittance(await seedType(), { amount: 100 });
      const c = await as(actors.customerId);
      const err = await failure(recalc(c, rid));
      expect(err.message).toMatch(/exchange_rate_unavailable/);
      expect(Number((await readRemittance(rid)).exchange_rate)).toBe(1);
    });

    it('does not fall back to an inactive row, to the inverse pair or to hardcoded defaults', async () => {
      await setRate(ids.usd, ids.cup, 790, { active: false });
      await setRate(ids.cup, ids.usd, 0.001266); // inverse only
      const rid = await seedRemittance(await seedType());
      const c = await as(actors.customerId);
      expect((await failure(recalc(c, rid))).message).toMatch(/exchange_rate_unavailable/);
    });

    it('keeps the legacy shortcuts: same currency => 1, a fixed type rate wins over exchange_rates', async () => {
      const c = await as(actors.customerId);
      const same = await seedRemittance(await seedType(), { sent: 'USD', delivered: 'USD', amount: 40 });
      expect(Number((await recalc(c, same)).rows[0].exchange_rate)).toBe(1);

      await setRate(ids.usd, ids.cup, 790);
      const fixed = await seedRemittance(await seedType({ rate: 300 }), { amount: 10 });
      expect(Number((await recalc(c, fixed)).rows[0].amount_to_deliver)).toBe(3000);
    });

    it('keeps its return type (remittances row), SECURITY DEFINER hygiene and grants', async () => {
      const { rows } = await admin.query(
        `SELECT pg_get_function_result('public.recalculate_remittance_at_current_rate(uuid)'::regprocedure) AS res`
      );
      expect(rows[0].res).toBe('remittances');
      const p = await fnPrivileges('public.recalculate_remittance_at_current_rate(uuid)');
      expect(p).toMatchObject({ anon: false, authenticated: true, secdef: true });
      expect(p.public_grant).toBeFalsy();
      expect(p.config).toContain('search_path=public, pg_temp');
      const service = await admin.query(
        `SELECT has_function_privilege('service_role', 'public.recalculate_remittance_at_current_rate(uuid)', 'EXECUTE') AS ok`
      );
      expect(service.rows[0].ok).toBe(true);
    });

    it('no longer references the dropped official_currency_rates table', async () => {
      const { rows } = await admin.query(
        `SELECT prosrc FROM pg_proc WHERE oid = 'public.recalculate_remittance_at_current_rate(uuid)'::regprocedure`
      );
      expect(rows[0].prosrc).not.toMatch(/official_currency_rates/);
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('exchange_rates constraints', () => {
    it('rejects rate <= 0', async () => {
      for (const bad of [0, -1, -0.000001]) {
        const err = await failure(setRate(ids.usd, ids.cup, bad));
        expect(err.code).toBe('23514');
      }
    });

    it('rejects from = to, also when inactive (new rows only)', async () => {
      expect((await failure(setRate(ids.usd, ids.usd, 1))).code).toBe('23514');
      expect((await failure(setRate(ids.usd, ids.usd, 1, { active: false }))).code).toBe('23514');
    });

    it('rejects a second ACTIVE row for the same directed pair, whatever its date', async () => {
      await setRate(ids.usd, ids.cup, 790);
      const sameDay = await failure(setRate(ids.usd, ids.cup, 800));
      expect(sameDay.code).toBe('23505');
      const otherDay = await failure(setRate(ids.usd, ids.cup, 800, { daysAgo: 3 }));
      expect(otherDay.code).toBe('23505');
      expect(otherDay.constraint).toBe(UNIQUE_ACTIVE_INDEX);
    });

    it('accepts the opposite direction and other pairs active at the same time', async () => {
      await setRate(ids.usd, ids.cup, 790);
      await setRate(ids.cup, ids.usd, 0.001266);
      await setRate(ids.usd, ids.eur, 0.89);
      const { rows } = await admin.query(`SELECT count(*)::int AS n FROM public.exchange_rates WHERE is_active`);
      expect(rows[0].n).toBe(3);
    });

    it('accepts any number of INACTIVE historical rows for a pair, next to one active row', async () => {
      await setRate(ids.usd, ids.cup, 790);
      for (const days of [1, 2, 3]) await setRate(ids.usd, ids.cup, 0.0025 * days, { active: false, daysAgo: days });
      const { rows } = await admin.query(
        `SELECT count(*)::int AS n FROM public.exchange_rates WHERE from_currency_id = $1 AND to_currency_id = $2`,
        [ids.usd, ids.cup]
      );
      expect(rows[0].n).toBe(4);
    });

    it('has the index as a partial unique on (from, to) WHERE is_active, and the checks registered', async () => {
      const idx = await admin.query(`SELECT indexdef FROM pg_indexes WHERE indexname = $1`, [UNIQUE_ACTIVE_INDEX]);
      expect(idx.rows[0].indexdef).toMatch(/UNIQUE INDEX .*\(from_currency_id, to_currency_id\) WHERE/);
      const cons = await admin.query(
        `SELECT conname, convalidated FROM pg_constraint
          WHERE conrelid = 'public.exchange_rates'::regclass AND contype = 'c' ORDER BY conname`
      );
      expect(Object.fromEntries(cons.rows.map((r) => [r.conname, r.convalidated]))).toEqual({
        exchange_rates_distinct_currencies_chk: expect.any(Boolean),
        exchange_rates_rate_positive_chk: true
      });
    });

    // ---- front-end write paths (src/lib/currencyService.js) against the partial unique index -------------
    describe('front-end paths (saveExchangeRate / updateExchangeRatePair / deleteExchangeRate*)', () => {
      it('updateExchangeRatePair: UPDATE of the active row (rate + today) never collides with the active-pair index', async () => {
        const direct = await setRate(ids.usd, ids.cup, 790, { daysAgo: 5 });
        const inverse = await setRate(ids.cup, ids.usd, 0.001266, { daysAgo: 5 });
        for (const rate of [800, 810]) {
          const r1 = await admin.query(
            `UPDATE public.exchange_rates SET rate = $1, effective_date = CURRENT_DATE
              WHERE from_currency_id = $2 AND to_currency_id = $3 AND is_active = true RETURNING id`,
            [rate, ids.usd, ids.cup]);
          const r2 = await admin.query(
            `UPDATE public.exchange_rates SET rate = $1, effective_date = CURRENT_DATE
              WHERE from_currency_id = $2 AND to_currency_id = $3 AND is_active = true RETURNING id`,
            [1 / rate, ids.cup, ids.usd]);
          expect(r1.rows[0].id).toBe(direct.id);
          expect(r2.rows[0].id).toBe(inverse.id);
        }
      });

      it('updateExchangeRatePair: an inactive same-day leftover still hits the OLD unique (23505) and the front clears it, then retries', async () => {
        await setRate(ids.usd, ids.cup, 790, { daysAgo: 2 });
        await setRate(ids.usd, ids.cup, 400, { active: false }); // inactive leftover dated today
        const first = await failure(admin.query(
          `UPDATE public.exchange_rates SET rate = 800, effective_date = CURRENT_DATE
            WHERE from_currency_id = $1 AND to_currency_id = $2 AND is_active = true`, [ids.usd, ids.cup]));
        expect(first.code).toBe('23505');
        expect(first.constraint).toBe('unique_currency_pair_date');
        await admin.query(
          `DELETE FROM public.exchange_rates WHERE from_currency_id = $1 AND to_currency_id = $2
              AND effective_date = CURRENT_DATE AND is_active = false`, [ids.usd, ids.cup]);
        const retry = await admin.query(
          `UPDATE public.exchange_rates SET rate = 800, effective_date = CURRENT_DATE
            WHERE from_currency_id = $1 AND to_currency_id = $2 AND is_active = true RETURNING id`, [ids.usd, ids.cup]);
        expect(retry.rowCount).toBe(1);
      });

      it('deleteExchangeRate / deleteExchangeRatePair (is_active = false) then saveExchangeRate (upsert) works the same day', async () => {
        const row = await setRate(ids.usd, ids.cup, 790);
        await admin.query(`UPDATE public.exchange_rates SET is_active = false WHERE id = $1`, [row.id]);
        const upsert = await admin.query(
          `INSERT INTO public.exchange_rates (from_currency_id, to_currency_id, rate, effective_date, is_active)
           VALUES ($1,$2,$3,CURRENT_DATE,true)
           ON CONFLICT (from_currency_id, to_currency_id, effective_date)
           DO UPDATE SET rate = EXCLUDED.rate, is_active = EXCLUDED.is_active RETURNING id, is_active`,
          [ids.usd, ids.cup, 805]);
        expect(upsert.rows[0]).toEqual({ id: row.id, is_active: true });
      });

      it('saveExchangeRate (upsert) of an older day while another row is active is now rejected instead of creating a second active row', async () => {
        await setRate(ids.usd, ids.cup, 790);
        const err = await failure(admin.query(
          `INSERT INTO public.exchange_rates (from_currency_id, to_currency_id, rate, effective_date, is_active)
           VALUES ($1,$2,$3,CURRENT_DATE - 1,true)
           ON CONFLICT (from_currency_id, to_currency_id, effective_date)
           DO UPDATE SET rate = EXCLUDED.rate, is_active = EXCLUDED.is_active`,
          [ids.usd, ids.cup, 805]));
        expect(err.code).toBe('23505');
        expect(err.constraint).toBe(UNIQUE_ACTIVE_INDEX);
      });

      it('replacing the pair the supported way (deactivate, then create the new one) works; reactivating an old row over an active one is rejected', async () => {
        const old = await setRate(ids.usd, ids.cup, 790, { daysAgo: 4 });
        await admin.query(`UPDATE public.exchange_rates SET is_active = false WHERE id = $1`, [old.id]);
        const fresh = await setRate(ids.usd, ids.cup, 800);
        const err = await failure(admin.query(`UPDATE public.exchange_rates SET is_active = true WHERE id = $1`, [old.id]));
        expect(err.code).toBe('23505');
        await admin.query(`UPDATE public.exchange_rates SET is_active = false WHERE id = $1`, [fresh.id]);
        await admin.query(`UPDATE public.exchange_rates SET is_active = true WHERE id = $1`, [old.id]);
      });

      it('an admin through RLS (authenticated role) can still do the in-place edit', async () => {
        await setRate(ids.usd, ids.cup, 790, { daysAgo: 3 });
        const c = await as(actors.adminId);
        const res = await c.query(
          `UPDATE public.exchange_rates SET rate = 795, effective_date = CURRENT_DATE
            WHERE from_currency_id = $1 AND to_currency_id = $2 AND is_active = true RETURNING rate`, [ids.usd, ids.cup]);
        expect(Number(res.rows[0].rate)).toBe(795);
      });
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('migration file properties', () => {
    const readMigration = () => readFileSync(MIGRATION, 'utf8');

    it('exists in the migration folder and carries the PREPARED, NOT APPLIED header', () => {
      // It used to assert "newest migration"; any later migration (e.g. Phase 0b A) legitimately breaks that,
      // so the check is now that no LATER migration touches the objects this file owns.
      const files = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort();
      const own = MIGRATION.split('/').pop();
      expect(files).toContain(own);
      // phase 1.5 S2 only READS exchange_rates (rate resolution inside its BEFORE INSERT guard); it redefines none of these objects
      const later = files.filter((f) => f > own && f !== '20261017110000_phase15_s2_remittance_pricing_guard.sql'
        // the financial audit trail only observes exchange_rates (AFTER UPDATE/DELETE audit trigger); it redefines none of them
        && f !== '20261020100000_financial_audit_log.sql'
        // wave 4 deliberately redefines recalculate_remittance_at_current_rate (rounding contract, then the commission
        // override); its rate resolution is a verbatim copy and is covered by this suite + remittanceQuote/commissionOverride
        && f !== '20261023100000_remittance_quote_and_recalculate.sql'
        && f !== '20261023120000_remittance_commission_override.sql'
        // the money-columns guard only NAMES the RPC in its comments (it lets the SECURITY DEFINER RPCs through)
        && f !== '20261023110000_remittance_money_columns_guard.sql');
      later.forEach((f) => {
        expect(readFileSync(`supabase/migrations/${f}`, 'utf8'), f)
          .not.toMatch(/exchange_rates|recalculate_remittance_at_current_rate|get_remittance_bank_accounts_admin/);
      });
      expect(readMigration().split('\n').slice(0, 12).join('\n')).toMatch(/PREPARED, NOT APPLIED/);
    });

    it('is idempotent and tolerates legacy invalid INACTIVE rows (re-applied inside a rolled-back transaction)', async () => {
      const sql = readMigration();
      await admin.query('BEGIN');
      try {
        await admin.query(sql);
        await admin.query(sql); // twice in a row
        // Production shape: the self-pair constraint is NOT VALID and a legacy inactive USD->USD row exists.
        await admin.query(`ALTER TABLE public.exchange_rates DROP CONSTRAINT exchange_rates_distinct_currencies_chk`);
        await admin.query(
          `INSERT INTO public.exchange_rates (from_currency_id, to_currency_id, rate, is_active, effective_date)
           VALUES ($1, $1, 1, false, DATE '2025-10-01')`, [ids.usd]);
        await admin.query(sql); // must not fail because of the legacy row
        const { rows } = await admin.query(
          `SELECT convalidated FROM pg_constraint WHERE conname = 'exchange_rates_distinct_currencies_chk'`);
        expect(rows[0].convalidated).toBe(false);
        const legacy = await admin.query(
          `SELECT count(*)::int AS n FROM public.exchange_rates WHERE from_currency_id = to_currency_id`);
        expect(legacy.rows[0].n).toBe(1);
      } finally {
        await admin.query('ROLLBACK');
      }
    });

    it('does not delete or modify exchange_rates data (no DML on the table)', () => {
      const executable = readMigration().split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
      expect(executable).not.toMatch(/\b(DELETE\s+FROM|UPDATE|INSERT\s+INTO|TRUNCATE)\s+(public\.)?exchange_rates/i);
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('stale migration headers', () => {
    const APPLIED = [
      '20261015120000_bizum_s3_currency_settings_fx_rates.sql',
      '20261015130000_bizum_s4_accounts.sql',
      '20261015150000_bizum_s5a_quotes_and_order_sealing.sql',
      '20261015150100_bizum_s5a_orders_checks.sql',
      '20261016120000_bizum_central_fx_rate.sql'
    ];
    it.each(APPLIED)('%s no longer claims it is NOT APPLIED', (file) => {
      const header = readFileSync(`supabase/migrations/${file}`, 'utf8').split('\n').slice(0, 12).join('\n');
      expect(header).not.toMatch(/NOT APPLIED/);
      expect(header).toMatch(/APPLIED to the hosted project/);
    });
  });
});
