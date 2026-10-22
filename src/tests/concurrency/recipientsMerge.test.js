/**
 * Duplicate recipients (W6b): the one-off MERGE script and the UNIQUE index migration. Two separate deliverables:
 *
 *   (a) supabase/maintenance/20261026_merge_duplicate_recipients.sql   (psql script, NOT a migration)
 *       dry-run by default (read only, rolled back); `-v apply=1` commits.
 *   (b) supabase/migrations/20261026100000_recipients_unique_identity.sql
 *       APPLY ONLY AFTER the merge ran in prod: it aborts with a readable message while duplicates exist.
 *
 * The suite does not list the new objects in `needs`: missing files fail loudly (red phase).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dbSuiteSkipReason, connectAdmin, DB_URL } from './db';
import { loadActors } from './fixtures';

const MERGE_SCRIPT = 'supabase/maintenance/20261026_merge_duplicate_recipients.sql';
const MIGRATION = 'supabase/migrations/20261026100000_recipients_unique_identity.sql';
const ROLLBACK = 'supabase/rollbacks/20261026100000_recipients_unique_identity_down.sql';
const INDEX = 'recipients_user_name_phone_uniq';

const skipReason = await dbSuiteSkipReason({ tables: ['recipients', 'recipient_addresses', 'recipient_bank_accounts', 'remittances'] });
const describeDb = skipReason ? describe.skip : describe;

const psql = (file, vars = {}) =>
  execFileSync(
    'psql',
    [DB_URL, '-X', '-v', 'ON_ERROR_STOP=1', ...Object.entries(vars).flatMap(([k, v]) => ['-v', `${k}=${v}`]), '-f', file],
    { encoding: 'utf8', env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' } }
  );

const failure = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the statement to fail, but it succeeded');
};

describeDb('merge duplicate recipients + unique identity index', () => {
  let admin;
  let actors;
  const recipients = [];
  const remittances = [];
  let typeId;
  let bankId;
  let accountTypeId;
  let currencyId;
  const bankAccounts = [];

  const insertRecipient = async (userId, name, phone, { createdAt = null, favorite = false, idNumber = null, email = null, notes = null } = {}) => {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO public.recipients (id, user_id, full_name, phone, is_favorite, created_at, id_number, email, notes)
       VALUES ($1,$2,$3,$4,$5, COALESCE($6::timestamptz, now()), $7, $8, $9)`,
      [id, userId, name, phone, favorite, createdAt, idNumber, email, notes]
    );
    recipients.push(id);
    return id;
  };
  const insertAddress = async (recipientId, { municipality = 'Colón', line = 'Calle 1', isDefault = true, createdAt = null } = {}) => {
    const { rows } = await admin.query(
      `INSERT INTO public.recipient_addresses (recipient_id, province, municipality, address_line_1, is_default, created_at)
       VALUES ($1,'Matanzas',$2,$3,$4, COALESCE($5::timestamptz, now())) RETURNING id`,
      [recipientId, municipality, line, isDefault, createdAt]
    );
    return rows[0].id;
  };
  const insertBankAccount = async (hash) => {
    const { rows } = await admin.query(
      `INSERT INTO public.bank_accounts (user_id, bank_id, account_type_id, currency_id, account_number_last4,
                                         account_number_hash, account_holder_name)
       VALUES ($1,$2,$3,$4,'1234',$5,'Holder') RETURNING id`,
      [actors.customerId, bankId, accountTypeId, currencyId, hash]
    );
    bankAccounts.push(rows[0].id);
    return rows[0].id;
  };
  const insertLink = async (recipientId, bankAccountId, { isDefault = true } = {}) => {
    const { rows } = await admin.query(
      `INSERT INTO public.recipient_bank_accounts (recipient_id, bank_account_id, is_default) VALUES ($1,$2,$3) RETURNING id`,
      [recipientId, bankAccountId, isDefault]
    );
    return rows[0].id;
  };
  const insertRemittance = async (recipientId, { addressId = null, linkId = null } = {}) => {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO public.remittances (id, user_id, remittance_type_id, amount_sent, exchange_rate,
         commission_percentage, commission_fixed, commission_total, amount_to_deliver, currency_sent,
         currency_delivered, recipient_name, recipient_phone, status, recipient_id, recipient_address_id,
         recipient_bank_account_id)
       VALUES ($1,$2,$3,100,800,2.5,0,2.5,78000,'USD','CUP','Rcpt','+5355550100','payment_pending',$4,$5,$6)`,
      [id, actors.customerId, typeId, recipientId, addressId, linkId]
    );
    remittances.push(id);
    return id;
  };
  const insertTransfer = async (remittanceId, linkId) => {
    const { rows } = await admin.query(
      `INSERT INTO public.remittance_bank_transfers (remittance_id, recipient_bank_account_id) VALUES ($1,$2) RETURNING id`,
      [remittanceId, linkId]
    );
    return rows[0].id;
  };

  /** One group with remittances, addresses and links on the duplicates; plus groups that must NOT merge. */
  const seedScenario = async () => {
    const hash = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
    const b1 = await insertBankAccount(hash.slice(0, 64));

    // G1: survivor S has the most remittances (2) although it is the newest, with neither address nor links.
    // Corrected data lives on the duplicates: it must reach the survivor (first non-empty value, oldest duplicate first).
    const d1 = await insertRecipient(actors.customerId, 'Ana Pérez', '+53 5555 5555', { createdAt: '2026-01-01', idNumber: '11111111111', email: 'ana@d1.test', notes: '   ' });
    const d2 = await insertRecipient(actors.customerId, '  ana   PÉREZ ', '53 5555-5555', { createdAt: '2026-02-01', favorite: true, idNumber: '22222222222', notes: 'note from d2' });
    const s = await insertRecipient(actors.customerId, 'ANA PÉREZ', '5355555555', { createdAt: '2026-03-01', idNumber: '' });
    const a1 = await insertAddress(d1);
    const a2 = await insertAddress(d2, { municipality: ' colón ', line: 'calle  1' }); // equivalent to a1
    const l1 = await insertLink(d1, b1);
    const l2 = await insertLink(d2, b1); // same bank account as l1
    const r1 = await insertRemittance(d1, { addressId: a1, linkId: l1 });
    const r2 = await insertRemittance(d2, { addressId: a2, linkId: l2 });
    const r3 = await insertRemittance(s);
    const r4 = await insertRemittance(s);
    const t1 = await insertTransfer(r1, l1);
    const t2 = await insertTransfer(r2, l2);

    // G2: no remittances; the NEWER row has an address, so it wins over the older one.
    // The survivor already has an email: it must never be overwritten by the duplicate's.
    const oldNoAddr = await insertRecipient(actors.customerId, 'Luis Gómez', '5300000002', { createdAt: '2026-01-01', email: 'old@luis.test' });
    const newWithAddr = await insertRecipient(actors.customerId, 'Luis Gómez', '5300000002', { createdAt: '2026-02-01', email: 'keep@luis.test' });
    await insertAddress(newWithAddr, { municipality: 'Perico' });

    // Must not merge: family (same phone, other name), another user (same identity), a single.
    const family1 = await insertRecipient(actors.customerId, 'Marta Díaz', '5300000003');
    const family2 = await insertRecipient(actors.customerId, 'Pedro Díaz', '5300000003');
    const otherUser = await insertRecipient(actors.adminId, 'Ana Pérez', '+53 5555 5555');
    return { d1, d2, s, a1, a2, l1, l2, r1, r2, r3, r4, t1, t2, b1, oldNoAddr, newWithAddr, family1, family2, otherUser };
  };

  const snapshot = async () => {
    const q = async (sql) => (await admin.query(sql)).rows;
    return {
      recipients: await q(`SELECT id, user_id, is_favorite FROM public.recipients WHERE id = ANY('{${recipients.join(',')}}') ORDER BY id`),
      addresses: await q(`SELECT id, recipient_id, is_default FROM public.recipient_addresses ORDER BY id`),
      links: await q(`SELECT id, recipient_id, is_default FROM public.recipient_bank_accounts ORDER BY id`),
      remittances: await q(`SELECT id, recipient_id, recipient_address_id, recipient_bank_account_id FROM public.remittances WHERE id = ANY('{${remittances.join(',')}}') ORDER BY id`),
      transfers: await q(`SELECT id, recipient_bank_account_id FROM public.remittance_bank_transfers ORDER BY id`)
    };
  };

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
    // Make sure the unique index does not get in the way of seeding the duplicates.
    await admin.query(`DROP INDEX IF EXISTS public.${INDEX}`);
    typeId = (await admin.query(
      `INSERT INTO public.remittance_types (name, currency_code, delivery_currency, exchange_rate, commission_percentage,
                                            commission_fixed, min_amount, delivery_method)
       VALUES ($1,'USD','CUP',800,2.5,0,0.01,'transfer') RETURNING id`,
      [`mrg-${randomUUID().slice(0, 8)}`]
    )).rows[0].id;
    bankId = (await admin.query(`INSERT INTO public.banks (name) VALUES ($1) RETURNING id`, [`bank-${randomUUID().slice(0, 8)}`])).rows[0].id;
    accountTypeId = (await admin.query(`INSERT INTO public.account_types (name) VALUES ($1) RETURNING id`, [`t-${randomUUID().slice(0, 8)}`])).rows[0].id;
    currencyId = (await admin.query(`SELECT id FROM public.currencies LIMIT 1`)).rows[0].id;
  });

  beforeEach(async () => {
    await admin.query(`DROP INDEX IF EXISTS public.${INDEX}`);
  });

  afterEach(async () => {
    await admin.query(`DROP INDEX IF EXISTS public.${INDEX}`);
    await admin.query('DELETE FROM public.remittance_bank_transfers WHERE remittance_id = ANY($1)', [remittances]);
    await admin.query('DELETE FROM public.remittances WHERE id = ANY($1)', [remittances.splice(0)]);
    await admin.query('DELETE FROM public.recipients WHERE id = ANY($1)', [recipients.splice(0)]);
    await admin.query('DELETE FROM public.bank_accounts WHERE id = ANY($1)', [bankAccounts.splice(0)]);
  });

  afterAll(async () => {
    await admin.query('DELETE FROM public.remittance_types WHERE id = $1', [typeId]);
    await admin.query('DELETE FROM public.banks WHERE id = $1', [bankId]);
    await admin.query('DELETE FROM public.account_types WHERE id = $1', [accountTypeId]);
    // leave the scratch DB in the migrated state for the other suites
    await admin.query(readFileSync(MIGRATION, 'utf8'));
    await admin.end();
  });

  describe('merge script', () => {
    it('is a dry-run by default: reports counts and changes nothing', async () => {
      await seedScenario();
      const before = await snapshot();

      const out = psql(MERGE_SCRIPT);

      expect(out).toMatch(/DRY-RUN/);
      expect(out).toMatch(/groups_with_duplicates/);
      // id_number + email + notes of the Ana group would be completed; Luis keeps his own email
      expect(out).toMatch(/survivor_fields_completed\s*\|\s*3/);
      // conflicting duplicate values that would be dropped: Ana's d2 id_number and Luis' older email
      expect(out).toMatch(/duplicate_values_lost_in_conflict\s*\|\s*2/);
      expect(await snapshot()).toEqual(before);
    });

    it('apply=1 merges each group into the best row and re-points every reference', async () => {
      const x = await seedScenario();

      const out = psql(MERGE_SCRIPT, { apply: 1 });
      expect(out).toMatch(/APPLIED/);

      // G1: survivor = most remittances
      const g1 = await admin.query(`SELECT id, is_favorite FROM public.recipients WHERE id = ANY($1)`, [[x.d1, x.d2, x.s]]);
      expect(g1.rows.map((r) => r.id)).toEqual([x.s]);
      expect(g1.rows[0].is_favorite).toBe(true); // OR of the group

      // non-destructive field merge: blank survivor fields are completed from the duplicates, in a deterministic order
      const ana = await admin.query(`SELECT id_number, email, notes FROM public.recipients WHERE id = $1`, [x.s]);
      expect(ana.rows[0]).toEqual({ id_number: '11111111111', email: 'ana@d1.test', notes: 'note from d2' });

      const rem = await admin.query(`SELECT id, recipient_id, recipient_address_id, recipient_bank_account_id FROM public.remittances WHERE id = ANY($1)`, [[x.r1, x.r2, x.r3, x.r4]]);
      expect(rem.rows.every((r) => r.recipient_id === x.s)).toBe(true);

      // addresses: a1 moved to S, a2 (equivalent) merged into a1 and gone; the remittances follow
      const addrs = await admin.query(`SELECT id, recipient_id FROM public.recipient_addresses WHERE id = ANY($1)`, [[x.a1, x.a2]]);
      expect(addrs.rows).toEqual([{ id: x.a1, recipient_id: x.s }]);
      const byId = Object.fromEntries(rem.rows.map((r) => [r.id, r]));
      expect(byId[x.r1].recipient_address_id).toBe(x.a1);
      expect(byId[x.r2].recipient_address_id).toBe(x.a1);

      // bank links: l1 moved to S, l2 (same bank account) merged into l1; remittances and transfers follow
      const links = await admin.query(`SELECT id, recipient_id FROM public.recipient_bank_accounts WHERE id = ANY($1)`, [[x.l1, x.l2]]);
      expect(links.rows).toEqual([{ id: x.l1, recipient_id: x.s }]);
      expect(byId[x.r1].recipient_bank_account_id).toBe(x.l1);
      expect(byId[x.r2].recipient_bank_account_id).toBe(x.l1);
      const transfers = await admin.query(`SELECT recipient_bank_account_id FROM public.remittance_bank_transfers WHERE id = ANY($1)`, [[x.t1, x.t2]]);
      expect(transfers.rows.map((r) => r.recipient_bank_account_id)).toEqual([x.l1, x.l1]);

      // G2: no remittances, the row with an address wins over the older one
      const g2 = await admin.query(`SELECT id FROM public.recipients WHERE id = ANY($1)`, [[x.oldNoAddr, x.newWithAddr]]);
      expect(g2.rows.map((r) => r.id)).toEqual([x.newWithAddr]);
      const luis = await admin.query(`SELECT email FROM public.recipients WHERE id = $1`, [x.newWithAddr]);
      expect(luis.rows[0].email).toBe('keep@luis.test');

      // untouched: family sharing a phone, another user with the same identity
      const kept = await admin.query(`SELECT id FROM public.recipients WHERE id = ANY($1)`, [[x.family1, x.family2, x.otherUser]]);
      expect(kept.rowCount).toBe(3);
    });

    it.each([
      ['remittances', (c, ids) => c.query(
        `INSERT INTO public.remittances (user_id, remittance_type_id, amount_sent, exchange_rate, commission_percentage,
           commission_fixed, commission_total, amount_to_deliver, currency_sent, currency_delivered, recipient_name,
           recipient_phone, status, recipient_id)
         VALUES ($1,$2,100,800,2.5,0,2.5,78000,'USD','CUP','Rcpt','+5355550100','payment_pending',$3) RETURNING id`,
        [actors.customerId, typeId, ids.recipient]).then((r) => remittances.push(r.rows[0].id))],
      ['recipient_addresses', (c, ids) => c.query(
        `INSERT INTO public.recipient_addresses (recipient_id, province, municipality, address_line_1, is_default)
         VALUES ($1,'Matanzas','Colón','Calle 9',true)`, [ids.recipient])],
      ['recipient_bank_accounts', (c, ids) => c.query(
        `INSERT INTO public.recipient_bank_accounts (recipient_id, bank_account_id, is_default) VALUES ($1,$2,true)`,
        [ids.recipient, ids.bank])]
    ])('apply waits for / refuses concurrent writers on %s (lock timeout instead of a silent race)', async (_table, write) => {
      const recipient = await insertRecipient(actors.customerId, 'Writer Probe', '5300000077');
      const bank = await insertBankAccount(randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, ''));
      const writer = await connectAdmin();
      try {
        await writer.query('BEGIN');
        await write(writer, { recipient, bank }); // uncommitted write holds ROW EXCLUSIVE on the table

        let stderr = '';
        try {
          psql(MERGE_SCRIPT, { apply: 1 });
        } catch (error) {
          stderr = String(error.stderr ?? error.message);
        }
        expect(stderr).toMatch(/lock timeout/i);
      } finally {
        await writer.query('ROLLBACK');
        await writer.end();
      }
    }, 30000);

    it('is idempotent: a second apply finds nothing to merge', async () => {
      await seedScenario();
      psql(MERGE_SCRIPT, { apply: 1 });
      const before = await snapshot();

      const out = psql(MERGE_SCRIPT, { apply: 1 });

      expect(out).toMatch(/groups_with_duplicates\s*\|\s*0/);
      expect(await snapshot()).toEqual(before);
    });
  });

  describe('unique identity index migration', () => {
    it('aborts with a readable message while duplicates exist and creates nothing', async () => {
      await seedScenario();

      const err = await failure(admin.query(readFileSync(MIGRATION, 'utf8')));
      await admin.query('ROLLBACK');

      expect(err.message).toMatch(/duplicate/i);
      expect(err.message).toMatch(/merge_duplicate_recipients/);
      const { rows } = await admin.query(`SELECT to_regclass('public.${INDEX}') AS idx`);
      expect(rows[0].idx).toBeNull();
    });

    it('takes a write-blocking lock on recipients before the duplicate guard (no raw 23505 between guard and index)', () => {
      const sql = readFileSync(MIGRATION, 'utf8');
      const lock = sql.search(/LOCK TABLE public\.recipients IN SHARE ROW EXCLUSIVE MODE/);
      expect(lock).toBeGreaterThan(-1);
      expect(lock).toBeLessThan(sql.indexOf('DO $guard$'));
    });

    it('after the merge it creates the index: same user+name+phone is rejected, family and other users are not', async () => {
      const x = await seedScenario();
      psql(MERGE_SCRIPT, { apply: 1 });
      await admin.query(readFileSync(MIGRATION, 'utf8'));

      const err = await failure(insertRecipient(actors.customerId, ' ana  pérez', '(53) 5555 5555'));
      expect(err.code).toBe('23505');
      expect(err.constraint ?? err.message).toMatch(new RegExp(INDEX));

      await insertRecipient(actors.customerId, 'Hermano Pérez', '+53 5555 5555'); // family: same phone, other name
      await insertRecipient(actors.customerId, 'Ana Pérez', '5300009999'); // same name, other phone
      expect(x.otherUser).toBeTruthy(); // other user with the same identity already coexists
    });

    it('the rollback drops the index and the migration can be applied again', async () => {
      await admin.query(readFileSync(MIGRATION, 'utf8'));
      await admin.query(readFileSync(ROLLBACK, 'utf8'));
      expect((await admin.query(`SELECT to_regclass('public.${INDEX}') AS idx`)).rows[0].idx).toBeNull();
      await admin.query(readFileSync(MIGRATION, 'utf8'));
      expect((await admin.query(`SELECT to_regclass('public.${INDEX}') AS idx`)).rows[0].idx).not.toBeNull();
    });
  });
});
