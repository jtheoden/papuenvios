/**
 * RB-01 R1 + R2: owner (user_id) and payment-routing columns of orders / remittances can only change through
 * SECURITY DEFINER RPCs, never through a direct PATCH by authenticated / anon (admins included).
 *
 * Migrations under test:
 *   20261103130000_orders_remittances_user_id_immutable.sql
 *   20261103130100_orders_remittances_payment_routing_columns_guard.sql
 *
 * The suite does not list the new objects in `needs`: a missing migration fails loudly (red phase).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dbSuiteSkipReason, connectAdmin, connectAs, connectAnon, endAll } from './db';
import { loadActors, createTracker, seedOrder, cleanup } from './fixtures';

const M1 = 'supabase/migrations/20261103130000_orders_remittances_user_id_immutable.sql';
const M2 = 'supabase/migrations/20261103130100_orders_remittances_payment_routing_columns_guard.sql';
const R1 = 'supabase/rollbacks/20261103130000_orders_remittances_user_id_immutable_down.sql';
const R2 = 'supabase/rollbacks/20261103130100_orders_remittances_payment_routing_columns_guard_down.sql';

const skipReason = await dbSuiteSkipReason({
  functions: ['is_admin_user', 'is_super_admin', 'order_validate_payment', 'order_submit_proof', 'remittance_submit_proof',
    'remittance_validate_payment'],
  tables: ['orders', 'remittances', 'remittance_types', 'zelle_accounts', 'user_profiles']
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

const UNTOUCHED_FUNCTIONS = ['_order_transition', '_remittance_transition', 'guard_orders_money_columns',
  'guard_remittance_money_columns', 'guard_orders_owner_update', 'guard_remittance_owner_update',
  'guard_bizum_quote_immutable', 'guard_status_via_rpc', 'order_money_columns', 'remittance_money_columns'];

describeDb('RB-01: user_id and payment-routing columns are RPC-only', () => {
  let admin;
  let actors;
  let zelleId;
  const tracker = createTracker();
  const clients = [];
  const remittances = [];
  const types = [];

  const as = async (userId) => {
    const c = await connectAs(userId);
    clients.push(c);
    return c;
  };
  const asRole = async (label) => {
    if (label === 'anon') {
      const c = await connectAnon();
      clients.push(c);
      return c;
    }
    if (label === 'super_admin') await admin.query(`UPDATE public.user_profiles SET role = 'super_admin' WHERE id = $1`, [actors.adminId]);
    if (label === 'other user') await admin.query(`UPDATE public.user_profiles SET role = 'user' WHERE id = $1`, [actors.adminId]);
    return as(label === 'owner' ? actors.customerId : actors.adminId);
  };

  const seedType = async () => {
    const { rows } = await admin.query(
      `INSERT INTO public.remittance_types (name, currency_code, delivery_currency, exchange_rate,
                                            commission_percentage, commission_fixed, min_amount, delivery_method)
       -- cash: these tests are about payment-routing columns; a non-cash customer INSERT also needs a linked recipient
       -- bank account (guard_remittance_bank_account), which is covered in remittanceBankAccountGuard.test.js
       VALUES ($1, 'USD', 'CUP', 800, 2.5, 0, 0.01, 'cash') RETURNING id`, [`rb01-${randomUUID().slice(0, 8)}`]);
    types.push(rows[0].id);
    return rows[0].id;
  };
  const seedRemittance = async (status = 'payment_pending', userId = actors.customerId) => {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO public.remittances (id, user_id, remittance_type_id, amount_sent, exchange_rate, commission_percentage,
         commission_fixed, commission_total, amount_to_deliver, currency_sent, currency_delivered, recipient_name,
         recipient_phone, status, payment_method)
       VALUES ($1,$2,$3,100,800,2.5,0,2.5,78000,'USD','CUP','Rcpt','+5355550100',$4,'zelle')`,
      [id, userId, await seedType(), status]);
    remittances.push(id);
    return id;
  };
  const seedOrderRow = (extra = {}) => seedOrder(admin, actors, tracker, [], { stockManaged: false, ...extra });

  // table -> seeding, and one direct PATCH per guarded column: [set clause, params]
  const TABLES = () => ({
    orders: {
      seed: seedOrderRow,
      userMsg: /orders_user_id_immutable/,
      routeMsg: /order_payment_routing_columns_rpc_only/,
      patches: {
        user_id: ['user_id = $2', [actors.adminId]],
        payment_method: [`payment_method = 'bizum'`, []],
        zelle_account_id: ['zelle_account_id = $2', [zelleId]],
        bizum_account_id: ['bizum_account_id = $2', [randomUUID()]],
        payment_quote_id: ['payment_quote_id = $2', [randomUUID()]]
      }
    },
    remittances: {
      seed: seedRemittance,
      userMsg: /remittances_user_id_immutable/,
      routeMsg: /remittance_payment_routing_columns_rpc_only/,
      patches: {
        user_id: ['user_id = $2', [actors.adminId]],
        payment_method: [`payment_method = 'bizum'`, []],
        zelle_account_id: ['zelle_account_id = $2', [zelleId]],
        zelle_transaction_id: ['zelle_transaction_id = $2', [randomUUID()]],
        recipient_bank_account_id: ['recipient_bank_account_id = $2', [randomUUID()]]
      }
    }
  });

  const snapshot = async (table, id) =>
    (await admin.query(
      `SELECT to_jsonb(t) - 'updated_at' AS j FROM public.${table} t WHERE id = $1`, [id])).rows[0].j;

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
    zelleId = (await admin.query(
      `INSERT INTO public.zelle_accounts (account_name, email) VALUES ('rb01', $1) RETURNING id`,
      [`rb01-${randomUUID().slice(0, 8)}@example.test`])).rows[0].id;
    await admin.query(`
      CREATE OR REPLACE FUNCTION public.__rb01_reassign(p_table text, p_id uuid, p_user uuid, p_zelle uuid)
      RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
      BEGIN
        IF p_table = 'orders' THEN UPDATE public.orders SET user_id = p_user, zelle_account_id = p_zelle WHERE id = p_id;
        ELSE UPDATE public.remittances SET user_id = p_user, zelle_account_id = p_zelle WHERE id = p_id; END IF;
      END $f$`);
    await admin.query('GRANT EXECUTE ON FUNCTION public.__rb01_reassign(text, uuid, uuid, uuid) TO authenticated');
  });

  afterEach(async () => {
    await endAll(clients.splice(0));
    await admin.query(`UPDATE public.user_profiles SET role = 'admin', is_enabled = true WHERE id = $1`, [actors.adminId]);
    if (remittances.length) await admin.query('DELETE FROM public.remittances WHERE id = ANY($1)', [remittances.splice(0)]);
    if (types.length) await admin.query('DELETE FROM public.remittance_types WHERE id = ANY($1)', [types.splice(0)]);
    await cleanup(admin, tracker);
  });

  afterAll(async () => {
    await admin.query('DROP FUNCTION IF EXISTS public.__rb01_reassign(text, uuid, uuid, uuid)');
    await admin.query('DELETE FROM public.zelle_accounts WHERE id = $1', [zelleId]);
    await admin.end();
  });

  describe.each(['orders', 'remittances'])('direct PATCH on %s', (table) => {
    const cols = () => Object.keys(TABLES()[table].patches);

    describe.each(['admin', 'super_admin', 'owner'])('as %s', (label) => {
      it.each(['user_id', 'payment_method', 'zelle_account_id', 'bizum_account_id', 'payment_quote_id',
        'zelle_transaction_id', 'recipient_bank_account_id'])('cannot change %s', async (col) => {
        const spec = TABLES()[table];
        if (!spec.patches[col]) return; // column does not exist on this table
        const id = await spec.seed();
        const before = await snapshot(table, id);
        const [set, params] = spec.patches[col];
        const c = await asRole(label);
        const err = await failure(c.query(`UPDATE public.${table} SET ${set} WHERE id = $1`, [id, ...params]));
        expect(err.code).toBe('42501');
        const mine = col === 'user_id' ? spec.userMsg : spec.routeMsg;
        // the owner may be stopped first by the sibling owner guard; admins must hit the new guard
        expect(err.message).toMatch(label === 'owner' ? new RegExp(`${mine.source}|owner_update_forbidden`) : mine);
        expect(await snapshot(table, id)).toEqual(before);
      });
    });

    it('a user who is neither owner nor admin touches 0 rows (RLS) and nothing changes', async () => {
      const spec = TABLES()[table];
      const id = await spec.seed();
      const before = await snapshot(table, id);
      const c = await asRole('other user');
      for (const col of cols()) {
        const [set, params] = spec.patches[col];
        const res = await c.query(`UPDATE public.${table} SET ${set} WHERE id = $1`, [id, ...params]).catch((e) => e);
        expect(res.rowCount === 0 || res.code === '42501').toBe(true);
      }
      expect(await snapshot(table, id)).toEqual(before);
    });

    it('anon cannot change any guarded column', async () => {
      const spec = TABLES()[table];
      const id = await spec.seed();
      const before = await snapshot(table, id);
      const c = await asRole('anon');
      for (const col of cols()) {
        const [set, params] = spec.patches[col];
        const res = await c.query(`UPDATE public.${table} SET ${set} WHERE id = $1`, [id, ...params]).catch((e) => e);
        expect(res.rowCount === 0 || res.code === '42501').toBe(true);
      }
      expect(await snapshot(table, id)).toEqual(before);
    });

    it('postgres (maintenance / migrations) can still change them', async () => {
      const id = await TABLES()[table].seed();
      await admin.query(`UPDATE public.${table} SET user_id = $2, zelle_account_id = $3 WHERE id = $1`, [id, actors.adminId, zelleId]);
      expect(await snapshot(table, id)).toMatchObject({ user_id: actors.adminId, zelle_account_id: zelleId });
    });

    it('a SECURITY DEFINER RPC (function owner) can still reassign them, called by an admin', async () => {
      const id = await TABLES()[table].seed();
      const c = await as(actors.adminId);
      await c.query('SELECT public.__rb01_reassign($1, $2, $3, $4)', [table, id, actors.adminId, zelleId]);
      expect(await snapshot(table, id)).toMatchObject({ user_id: actors.adminId, zelle_account_id: zelleId });
    });

    it('service_role can still change them (guard only targets authenticated/anon)', async () => {
      const id = await TABLES()[table].seed();
      // The clone may not give service_role UPDATE on the table: grant it inside a transaction that is rolled back.
      await admin.query('BEGIN');
      try {
        await admin.query(`GRANT SELECT, UPDATE ON public.${table} TO service_role`);
        await admin.query('SET LOCAL ROLE service_role'); // BYPASSRLS, like PostgREST with the service key
        const res = await admin.query(
          `UPDATE public.${table} SET user_id = $2, payment_method = payment_method, zelle_account_id = $3 WHERE id = $1`,
          [id, actors.adminId, zelleId]);
        expect(res.rowCount).toBe(1);
      } finally {
        await admin.query('ROLLBACK');
      }
    });

    it('no-op writes of the same value (a client re-sending the full row) are allowed, even for the owner', async () => {
      const spec = TABLES()[table];
      const id = await spec.seed();
      const adminC = await asRole('admin');
      await adminC.query(
        `UPDATE public.${table} SET user_id = user_id, payment_method = payment_method, zelle_account_id = zelle_account_id WHERE id = $1`, [id]);
      const owner = await as(actors.customerId);
      await owner.query(`UPDATE public.${table} SET user_id = user_id, payment_method = payment_method WHERE id = $1`, [id])
        .catch((e) => { throw new Error(`no-op write rejected: ${e.message}`); });
    });

    it('an admin can still PATCH non-guarded columns', async () => {
      const id = await TABLES()[table].seed();
      const c = await asRole('admin');
      const col = table === 'orders' ? 'admin_notes' : 'delivery_notes_admin';
      await c.query(`UPDATE public.${table} SET ${col} = 'n' WHERE id = $1`, [id]);
      expect((await snapshot(table, id))[col]).toBe('n');
    });
  });

  describe('legitimate flows keep working', () => {
    it('orders: owner submits proof through the RPC, admin validates through the RPC, admin cancels', async () => {
      const id = await seedOrderRow();
      const owner = await as(actors.customerId);
      await owner.query('SELECT * FROM public.order_submit_proof($1, $2, $3)', [id, 'payment-proofs/p.png', 'REF-1']);
      const c = await as(actors.adminId);
      await c.query('SELECT public.order_validate_payment($1)', [id]);
      expect(await snapshot('orders', id)).toMatchObject({ status: 'processing', payment_status: 'validated', user_id: actors.customerId });
    });

    it('remittances: owner submits proof, admin validates, through the RPCs', async () => {
      const id = await seedRemittance();
      const owner = await as(actors.customerId);
      await owner.query('SELECT * FROM public.remittance_submit_proof($1, $2, $3, $4, $5)',
        [id, 'user-id/REM-1.jpg', 'Payer Ref', null, '+13055550100']);
      const c = await as(actors.adminId);
      await c.query('SELECT * FROM public.remittance_validate_payment($1)', [id]);
      expect(await snapshot('remittances', id)).toMatchObject({ status: 'payment_validated', user_id: actors.customerId });
    });

    it('orders: the customer can INSERT an order with payment_method / zelle_account_id (guards are UPDATE-only)', async () => {
      const c = await as(actors.customerId);
      const { rows } = await c.query(
        `INSERT INTO public.orders (user_id, order_type, status, subtotal, total_amount, currency_id, payment_status,
                                    payment_method, zelle_account_id, order_number)
         VALUES ($1, 'product', 'pending', 10, 10, $2, 'pending', 'zelle', $3, $4) RETURNING id`,
        [actors.customerId, actors.currencyId, zelleId, `RB1-${randomUUID().slice(0, 12)}`]);
      tracker.orders.push(rows[0].id);
      expect(await snapshot('orders', rows[0].id)).toMatchObject({ payment_method: 'zelle', zelle_account_id: zelleId });
    });

    it('remittances: the customer can INSERT a remittance with payment_method / zelle_account_id', async () => {
      const id = randomUUID();
      const c = await as(actors.customerId);
      await c.query(
        `INSERT INTO public.remittances (id, user_id, remittance_type_id, amount_sent, exchange_rate, commission_percentage,
           commission_fixed, commission_total, amount_to_deliver, currency_sent, currency_delivered, recipient_name,
           recipient_phone, status, payment_method, zelle_account_id)
         VALUES ($1,$2,$3,100,800,2.5,0,2.5,78000,'USD','CUP','Rcpt','+5355550100','payment_pending','zelle',$4)`,
        [id, actors.customerId, await seedType(), zelleId]).catch((e) => { remittances.push(id); throw e; });
      remittances.push(id);
      expect(await snapshot('remittances', id)).toMatchObject({ payment_method: 'zelle', zelle_account_id: zelleId });
    });
  });

  describe('R3 exploratory (characterization, no code change): admin INSERTs an order for himself with an arbitrary price', () => {
    it('records the observed outcome', async () => {
      const c = await as(actors.adminId);
      const res = await c.query(
        `INSERT INTO public.orders (user_id, order_type, status, subtotal, total_amount, currency_id, payment_status,
                                    payment_method, order_number)
         VALUES ($1, 'product', 'pending', 0.01, 0.01, $2, 'pending', 'zelle', $3) RETURNING id`,
        [actors.adminId, actors.currencyId, `RB1-${randomUUID().slice(0, 12)}`]).catch((e) => e);
      if (res.rows) tracker.orders.push(res.rows[0].id);
      // OPEN GAP (R3, out of scope for RB-01): the INSERT is allowed. When it gets closed, flip this expectation.
      expect(res.rows ? 'allowed' : res.code).toBe('allowed');
    });
  });

  describe('migrations are additive', () => {
    it('do not redefine live functions nor write / drop data, run in a transaction and ship rollbacks', () => {
      for (const f of [M1, M2]) {
        const sql = readFileSync(f, 'utf8').replace(/--.*$/gm, '');
        for (const name of UNTOUCHED_FUNCTIONS) {
          expect(sql).not.toMatch(new RegExp(`CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION\\s+(public\\.)?${name}\\b`, 'i'));
        }
        expect(sql).not.toMatch(/\b(DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|INSERT\s+INTO|UPDATE\s+public\.|ALTER\s+TABLE\s+\S+\s+(ADD|DROP|ALTER)\s+COLUMN)/i);
        expect(readFileSync(f, 'utf8')).toMatch(/^BEGIN;/m);
        expect(readFileSync(f, 'utf8')).toMatch(/^COMMIT;/m);
        expect(readFileSync(f, 'utf8').split('\n').slice(0, 50).join('\n')).toMatch(/ROLLBACK/);
      }
      expect(readFileSync(R1, 'utf8')).toMatch(/DROP TRIGGER IF EXISTS \w+ ON public\.orders/);
      expect(readFileSync(R2, 'utf8')).toMatch(/DROP TRIGGER IF EXISTS \w+ ON public\.remittances/);
    });

    it('triggers are ENABLE ALWAYS BEFORE UPDATE row triggers on SECURITY INVOKER functions', async () => {
      const { rows } = await admin.query(
        `SELECT c.relname, t.tgname, t.tgenabled, (t.tgtype & 2) <> 0 AS is_before, (t.tgtype & 16) <> 0 AS is_update,
                p.prosecdef, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
           FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid JOIN pg_class c ON c.oid = t.tgrelid
          WHERE t.tgname IN ('guard_orders_user_id_immutable', 'guard_remittances_user_id_immutable',
                             'guard_orders_payment_routing_columns', 'guard_remittances_payment_routing_columns')`);
      expect(rows).toHaveLength(4);
      for (const r of rows) {
        expect(r).toMatchObject({ tgenabled: 'A', is_before: true, is_update: true, prosecdef: false, auth_exec: false });
      }
    });
  });
});
