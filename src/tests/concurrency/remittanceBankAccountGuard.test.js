/**
 * Remittance bank account guard. Migration under test (PREPARED, NOT APPLIED in prod):
 *   20261111130000_remittance_bank_account_guard.sql   (rollback: supabase/rollbacks/<same name>_down.sql)
 *
 * A customer INSERT of a non-cash remittance must carry a recipient_bank_account_id whose link belongs to THAT
 * recipient, is active, and whose bank account is active, not deleted and in the type's delivery currency.
 * Cash, admins, service roles and sessionless inserts are not affected; stored rows are never touched.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dbSuiteSkipReason, connectAdmin, connectAs, endAll } from './db';
import { loadActors } from './fixtures';

const NAME = '20261111130000_remittance_bank_account_guard';
const MIGRATION = `supabase/migrations/${NAME}.sql`;
const ROLLBACK = `supabase/rollbacks/${NAME}_down.sql`;

const skipReason = await dbSuiteSkipReason({
  functions: ['is_admin_user', 'is_super_admin'],
  tables: ['remittances', 'remittance_types', 'recipients', 'recipient_bank_accounts', 'bank_accounts', 'currencies', 'zelle_accounts']
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

describeDb('remittance bank account guard (local Postgres)', () => {
  let admin;
  let actors;
  let cur;
  let bankId;
  let accountTypeId;
  let zelleId;
  let recipientId;
  let otherRecipientId;
  let cashTypeId;
  let cardTypeId;
  const clients = [];
  const remittances = [];
  const links = {};
  const accounts = [];

  const as = async (userId) => {
    const c = await connectAs(userId);
    clients.push(c);
    return c;
  };
  const seedType = async (method) =>
    (await admin.query(
      `INSERT INTO public.remittance_types (name, currency_code, delivery_currency, exchange_rate, commission_percentage,
                                            commission_fixed, min_amount, delivery_method)
       VALUES ($1, 'USD', 'CUP', 800, 2.5, 0, 0.01, $2) RETURNING id`,
      [`bag-${method}-${randomUUID().slice(0, 8)}`, method]
    )).rows[0].id;
  const seedLink = async (ownerRecipientId, { currencyId = cur.CUP, accountActive = true, deleted = false, linkActive = true } = {}) => {
    const account = (await admin.query(
      `INSERT INTO public.bank_accounts (user_id, bank_id, account_type_id, currency_id, account_number_last4, account_number_hash,
                                         account_holder_name, is_active, deleted_at)
       VALUES ($1,$2,$3,$4,'1234',$5,'Holder',$6,$7) RETURNING id`,
      [actors.customerId, bankId, accountTypeId, currencyId, randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, ''),
        accountActive, deleted ? new Date() : null]
    )).rows[0].id;
    accounts.push(account);
    return (await admin.query(
      `INSERT INTO public.recipient_bank_accounts (recipient_id, bank_account_id, is_active) VALUES ($1,$2,$3) RETURNING id`,
      [ownerRecipientId, account, linkActive]
    )).rows[0].id;
  };
  const insertRemittance = async (client, userId, typeId, { recipient = null, link = null } = {}) => {
    const id = randomUUID();
    remittances.push(id);
    await client.query(
      `INSERT INTO public.remittances (id, user_id, remittance_type_id, amount_sent, exchange_rate, commission_percentage,
         commission_fixed, commission_total, amount_to_deliver, currency_sent, currency_delivered, recipient_name,
         recipient_phone, status, payment_method, zelle_account_id, recipient_id, recipient_bank_account_id)
       VALUES ($1,$2,$3,100,800,2.5,0,2.5,78000,'USD','CUP','Rcpt','+5355550100','payment_pending','zelle',$4,$5,$6)`,
      [id, userId, typeId, zelleId, recipient, link]
    );
    return id;
  };

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
    cur = Object.fromEntries((await admin.query(`SELECT code, id FROM public.currencies WHERE code IN ('USD','CUP')`)).rows.map((r) => [r.code, r.id]));
    // the migration may already be in the scratch DB (bootstrap replay); applying it again is part of what is tested
    await admin.query(readFileSync(MIGRATION, 'utf8'));
    bankId = (await admin.query(`INSERT INTO public.banks (name) VALUES ($1) RETURNING id`, [`bag-bank-${randomUUID().slice(0, 8)}`])).rows[0].id;
    accountTypeId = (await admin.query(`INSERT INTO public.account_types (name) VALUES ($1) RETURNING id`, [`bag-${randomUUID().slice(0, 8)}`])).rows[0].id;
    zelleId = (await admin.query(
      `INSERT INTO public.zelle_accounts (account_name, email) VALUES ('bag', $1) RETURNING id`,
      [`bag-${randomUUID().slice(0, 8)}@example.test`]
    )).rows[0].id;
    recipientId = (await admin.query(`INSERT INTO public.recipients (user_id, full_name, phone) VALUES ($1,'Bag One','+5355550201') RETURNING id`, [actors.customerId])).rows[0].id;
    otherRecipientId = (await admin.query(`INSERT INTO public.recipients (user_id, full_name, phone) VALUES ($1,'Bag Two','+5355550202') RETURNING id`, [actors.customerId])).rows[0].id;
    cashTypeId = await seedType('cash');
    cardTypeId = await seedType('card');
    links.good = await seedLink(recipientId);
    links.otherRecipients = await seedLink(otherRecipientId);
    links.wrongCurrency = await seedLink(recipientId, { currencyId: cur.USD });
    links.inactiveAccount = await seedLink(recipientId, { accountActive: false });
    links.deletedAccount = await seedLink(recipientId, { deleted: true });
    links.inactiveLink = await seedLink(recipientId, { linkActive: false });
  });

  afterAll(async () => {
    await admin.query('DELETE FROM public.remittances WHERE id = ANY($1)', [remittances]);
    await admin.query('DELETE FROM public.recipient_bank_accounts WHERE recipient_id = ANY($1)', [[recipientId, otherRecipientId]]);
    await admin.query('DELETE FROM public.bank_accounts WHERE id = ANY($1)', [accounts]);
    await admin.query('DELETE FROM public.recipients WHERE id = ANY($1)', [[recipientId, otherRecipientId]]);
    await admin.query('DELETE FROM public.remittance_types WHERE id = ANY($1)', [[cashTypeId, cardTypeId]]);
    await admin.query('DELETE FROM public.zelle_accounts WHERE id = $1', [zelleId]);
    await admin.query('DELETE FROM public.banks WHERE id = $1', [bankId]);
    await admin.query('DELETE FROM public.account_types WHERE id = $1', [accountTypeId]);
    // leave the scratch DB in the migrated state for the other suites
    await admin.query(readFileSync(MIGRATION, 'utf8'));
    await endAll([admin, ...clients]);
  });

  describe('customer INSERT of a non-cash remittance', () => {
    it('is accepted with an active link of the same recipient, in the delivery currency', async () => {
      const customer = await as(actors.customerId);
      const id = await insertRemittance(customer, actors.customerId, cardTypeId, { recipient: recipientId, link: links.good });
      expect((await admin.query('SELECT recipient_bank_account_id FROM public.remittances WHERE id = $1', [id])).rows[0].recipient_bank_account_id)
        .toBe(links.good);
    });

    it.each([
      ['no account and no recipient', () => ({})],
      ['a recipient without account', () => ({ recipient: recipientId })],
      ['an account without recipient', () => ({ link: links.good })],
      ['the link of ANOTHER recipient', () => ({ recipient: recipientId, link: links.otherRecipients })],
      ['an account in another currency', () => ({ recipient: recipientId, link: links.wrongCurrency })],
      ['an inactive bank account', () => ({ recipient: recipientId, link: links.inactiveAccount })],
      ['a deleted bank account', () => ({ recipient: recipientId, link: links.deletedAccount })],
      ['an inactive link', () => ({ recipient: recipientId, link: links.inactiveLink })]
    ])('is rejected with %s', async (_label, args) => {
      const customer = await as(actors.customerId);
      const error = await failure(insertRemittance(customer, actors.customerId, cardTypeId, args()));
      expect(error).toMatchObject({ code: '23514' });
      expect(error.message).toMatch(/remittance_bank_account_required/);
    });
  });

  describe('what it leaves alone', () => {
    it('cash needs no account', async () => {
      const customer = await as(actors.customerId);
      await expect(insertRemittance(customer, actors.customerId, cashTypeId)).resolves.toBeDefined();
    });

    it('admins and sessionless (service) inserts bypass it, like the pricing guard', async () => {
      const adminClient = await as(actors.adminId);
      await expect(insertRemittance(adminClient, actors.adminId, cardTypeId)).resolves.toBeDefined();
      await expect(insertRemittance(admin, actors.customerId, cardTypeId)).resolves.toBeDefined();
    });

    it('does not touch stored remittances: UPDATEs of an existing non-cash row without account still work', async () => {
      const id = await insertRemittance(admin, actors.customerId, cardTypeId);
      await expect(admin.query(`UPDATE public.remittances SET recipient_name = 'Edited' WHERE id = $1`, [id])).resolves.toBeDefined();
    });
  });

  describe('migration file properties', () => {
    it('is idempotent and its rollback removes only the trigger and the function', async () => {
      await admin.query(readFileSync(MIGRATION, 'utf8'));
      await admin.query(readFileSync(MIGRATION, 'utf8'));
      const objects = async () => (await admin.query(
        `SELECT (SELECT count(*) FROM pg_trigger WHERE tgname = 'guard_remittance_bank_account' AND NOT tgisinternal)::int AS triggers,
                (SELECT count(*) FROM pg_proc WHERE proname = 'guard_remittance_bank_account')::int AS functions`
      )).rows[0];
      expect(await objects()).toEqual({ triggers: 1, functions: 1 });

      await admin.query(readFileSync(ROLLBACK, 'utf8'));
      expect(await objects()).toEqual({ triggers: 0, functions: 0 });
      // without the guard the customer INSERT without account goes through again
      const customer = await as(actors.customerId);
      await expect(insertRemittance(customer, actors.customerId, cardTypeId)).resolves.toBeDefined();

      await admin.query(readFileSync(MIGRATION, 'utf8'));
      expect(await objects()).toEqual({ triggers: 1, functions: 1 });
      const error = await failure(insertRemittance(customer, actors.customerId, cardTypeId));
      expect(error).toMatchObject({ code: '23514' });
    });
  });
});
