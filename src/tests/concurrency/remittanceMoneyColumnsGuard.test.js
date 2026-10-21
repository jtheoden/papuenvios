/**
 * Money columns of remittances can only change through SECURITY DEFINER RPCs, never through a direct PATCH.
 *
 * Migration under test: 20261023110000_remittance_money_columns_guard.sql
 *   trigger guard_remittance_money_columns (BEFORE UPDATE, SECURITY INVOKER): rejects with 42501 /
 *   remittance_money_columns_rpc_only when current_user = 'authenticated' and a column of
 *   financial_audit_columns('remittances') changes. SECURITY DEFINER RPCs run as the function owner, so they pass.
 *
 * The suite does not list the new objects in `needs`: a missing migration fails loudly (red phase).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dbSuiteSkipReason, connectAdmin, connectAs, endAll } from './db';
import { loadActors } from './fixtures';

const MIGRATION = 'supabase/migrations/20261023110000_remittance_money_columns_guard.sql';

const skipReason = await dbSuiteSkipReason({
  functions: ['is_admin_user', 'is_super_admin', 'recalculate_remittance_at_current_rate', 'financial_audit_columns'],
  tables: ['remittances', 'remittance_types', 'shipping_zones']
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

describeDb('guard_remittance_money_columns', () => {
  let admin;
  let actors;
  const clients = [];
  const remittances = [];
  const remittanceTypes = [];
  const zones = [];

  const as = async (userId) => {
    const c = await connectAs(userId);
    clients.push(c);
    return c;
  };

  const seedType = async () => {
    const { rows } = await admin.query(
      `INSERT INTO public.remittance_types (name, currency_code, delivery_currency, exchange_rate,
                                            commission_percentage, commission_fixed, min_amount, delivery_method)
       VALUES ($1, 'USD', 'CUP', 800, 2.5, 0, 0.01, 'transfer') RETURNING id`,
      [`mg-${randomUUID().slice(0, 8)}`]
    );
    remittanceTypes.push(rows[0].id);
    return rows[0].id;
  };

  const seedRemittance = async (typeId, { status = 'payment_pending', zoneId = null } = {}) => {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO public.remittances (id, user_id, remittance_type_id, amount_sent, exchange_rate,
         commission_percentage, commission_fixed, commission_total, amount_to_deliver, currency_sent,
         currency_delivered, recipient_name, recipient_phone, status, shipping_zone_id)
       VALUES ($1,$2,$3,100,800,2.5,0,2.5,78000,'USD','CUP','Rcpt','+5355550100',$4,$5)`,
      [id, actors.customerId, typeId, status, zoneId]
    );
    remittances.push(id);
    return id;
  };

  const read = async (id) => (await admin.query('SELECT * FROM public.remittances WHERE id = $1', [id])).rows[0];

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
  });

  afterEach(async () => {
    await endAll(clients.splice(0));
    await admin.query(`UPDATE public.user_profiles SET role = 'admin', is_enabled = true WHERE id = $1`, [actors.adminId]);
    if (remittances.length) await admin.query('DELETE FROM public.remittances WHERE id = ANY($1)', [remittances.splice(0)]);
    if (zones.length) await admin.query('DELETE FROM public.shipping_zones WHERE id = ANY($1)', [zones.splice(0)]);
    if (remittanceTypes.length) await admin.query('DELETE FROM public.remittance_types WHERE id = ANY($1)', [remittanceTypes.splice(0)]);
  });

  afterAll(async () => {
    await admin.end();
  });

  const MONEY_PATCHES = [
    ['commission_total', 'commission_total = 0.01'],
    ['amount_to_deliver', 'amount_to_deliver = 99999'],
    ['amount_sent', 'amount_sent = 1000'],
    ['exchange_rate', 'exchange_rate = 900'],
    ['discount_amount', 'discount_amount = 5'],
    ['delivery_cost', 'delivery_cost = 9'],
    ['commission_percentage', 'commission_percentage = 1'],
    ['commission_fixed', 'commission_fixed = 1'],
    ['currency_delivered', `currency_delivered = 'EUR'`]
  ];

  describe('direct PATCH as authenticated', () => {
    it.each(MONEY_PATCHES)('an admin cannot change %s', async (_col, setClause) => {
      const rid = await seedRemittance(await seedType());
      const c = await as(actors.adminId);
      const err = await failure(c.query(`UPDATE public.remittances SET ${setClause} WHERE id = $1`, [rid]));
      expect(err.code).toBe('42501');
      expect(err.message).toMatch(/remittance_money_columns_rpc_only/);
    });

    it('a super_admin cannot either', async () => {
      await admin.query(`UPDATE public.user_profiles SET role = 'super_admin' WHERE id = $1`, [actors.adminId]);
      const rid = await seedRemittance(await seedType());
      const c = await as(actors.adminId);
      const err = await failure(c.query('UPDATE public.remittances SET commission_total = 0.01 WHERE id = $1', [rid]));
      expect(err.message).toMatch(/remittance_money_columns_rpc_only/);
    });

    it('the owner cannot (also covered by the owner guard)', async () => {
      const rid = await seedRemittance(await seedType());
      const c = await as(actors.customerId);
      const err = await failure(c.query('UPDATE public.remittances SET amount_to_deliver = 99999 WHERE id = $1', [rid]));
      expect(err.code).toBe('42501');
    });

    it('changing the type of a remittance is a money change too', async () => {
      const t1 = await seedType();
      const t2 = await seedType();
      const rid = await seedRemittance(t1);
      const c = await as(actors.adminId);
      const err = await failure(c.query('UPDATE public.remittances SET remittance_type_id = $1 WHERE id = $2', [t2, rid]));
      expect(err.message).toMatch(/remittance_money_columns_rpc_only/);
    });

    it('leaves the row untouched after a rejected PATCH', async () => {
      const rid = await seedRemittance(await seedType());
      const c = await as(actors.adminId);
      await failure(c.query('UPDATE public.remittances SET commission_total = 0.01, status = $2 WHERE id = $1', [rid, 'cancelled']));
      const row = await read(rid);
      expect([Number(row.commission_total), row.status]).toEqual([2.5, 'payment_pending']);
    });

    it('a no-op write of the same money value is allowed (column listed, value unchanged)', async () => {
      const rid = await seedRemittance(await seedType());
      const c = await as(actors.adminId);
      await c.query('UPDATE public.remittances SET commission_total = 2.5, status = $2 WHERE id = $1', [rid, 'payment_proof_uploaded']);
      expect((await read(rid)).status).toBe('payment_proof_uploaded');
    });
  });

  describe('flows that must keep working', () => {
    it('an admin can still change status, delivery proof and admin notes by PATCH', async () => {
      const rid = await seedRemittance(await seedType(), { status: 'processing' });
      const c = await as(actors.adminId);
      await c.query(
        `UPDATE public.remittances SET delivery_proof_url = 'p/x.png', delivery_notes_admin = 'ok', status = 'delivered',
                delivered_at = now(), updated_at = now() WHERE id = $1`, [rid]);
      const row = await read(rid);
      expect([row.status, row.delivery_proof_url]).toEqual(['delivered', 'p/x.png']);
    });

    it('the owner can still cancel and upload a payment proof', async () => {
      const rid = await seedRemittance(await seedType());
      const c = await as(actors.customerId);
      await c.query(
        `UPDATE public.remittances SET payment_proof_url = 'u/p.png', payment_reference = 'ref', status = 'payment_proof_uploaded',
                payment_proof_uploaded_at = now(), updated_at = now() WHERE id = $1`, [rid]);
      await c.query(`UPDATE public.remittances SET status = 'cancelled', cancelled_at = now(), cancellation_reason = 'x' WHERE id = $1`, [rid]);
      expect((await read(rid)).status).toBe('cancelled');
    });

    it.each(['customerId', 'adminId'])('recalculate_remittance_at_current_rate still works for %s (SECURITY DEFINER)', async (who) => {
      const rid = await seedRemittance(await seedType());
      const c = await as(actors[who]);
      const { rows } = await c.query('SELECT * FROM public.recalculate_remittance_at_current_rate($1)', [rid]);
      expect(Number(rows[0].commission_total)).toBe(2.5);
      expect(Number(rows[0].amount_to_deliver)).toBe(78000);
    });

    it('postgres (maintenance) can still change money columns', async () => {
      const rid = await seedRemittance(await seedType());
      await admin.query('UPDATE public.remittances SET commission_total = 3, amount_to_deliver = 77600 WHERE id = $1', [rid]);
      expect(Number((await read(rid)).commission_total)).toBe(3);
    });

    it('deleting a shipping zone (FK ON DELETE SET NULL) is not blocked for an admin', async () => {
      const zone = (await admin.query(
        `INSERT INTO public.shipping_zones (province_name, shipping_cost) VALUES ($1, 5) RETURNING id`, [`Z-${randomUUID().slice(0, 6)}`])).rows[0].id;
      zones.push(zone);
      const rid = await seedRemittance(await seedType(), { zoneId: zone });
      const c = await as(actors.adminId);
      await c.query('DELETE FROM public.shipping_zones WHERE id = $1', [zone]);
      expect((await read(rid)).shipping_zone_id).toBeNull();
    });
  });

  describe('trigger metadata', () => {
    it('is a BEFORE UPDATE row trigger on remittances backed by a SECURITY INVOKER function that reads financial_audit_columns', async () => {
      const { rows } = await admin.query(
        `SELECT t.tgenabled, (t.tgtype & 2) <> 0 AS is_before, (t.tgtype & 16) <> 0 AS is_update, p.prosecdef, p.prosrc
           FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
          WHERE t.tgrelid = 'public.remittances'::regclass AND t.tgname = 'guard_remittance_money_columns'`
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ is_before: true, is_update: true, prosecdef: false });
      expect(rows[0].tgenabled).toBe('A'); // ENABLE ALWAYS: also under session_replication_role = replica
      expect(rows[0].prosrc).toMatch(/remittance_money_columns\(\)/);
      // the wrapper is the single bridge to financial_audit_columns(), which itself stays closed to API roles
      const wrapper = await admin.query(
        `SELECT prosrc, has_function_privilege('authenticated', 'public.financial_audit_columns(text)', 'EXECUTE') AS direct
           FROM pg_proc WHERE oid = 'public.remittance_money_columns()'::regprocedure`
      );
      expect(wrapper.rows[0].prosrc).toMatch(/financial_audit_columns\('remittances'\)/);
      expect(wrapper.rows[0].direct).toBe(false);
      expect(rows[0].prosrc).toMatch(/current_user NOT IN \('authenticated', 'anon'\)/);
    });

    it('migration documents its rollback, runs in a transaction and ships a one-line rollback script', () => {
      const sql = readFileSync(MIGRATION, 'utf8');
      expect(sql.split('\n').slice(0, 40).join('\n')).toMatch(/ROLLBACK/);
      expect(sql).toMatch(/^BEGIN;/m);
      expect(sql).toMatch(/^COMMIT;/m);
      expect(readFileSync('supabase/rollbacks/20261023110000_remittance_money_columns_guard_down.sql', 'utf8'))
        .toMatch(/DROP TRIGGER IF EXISTS guard_remittance_money_columns/);
    });
  });
});
