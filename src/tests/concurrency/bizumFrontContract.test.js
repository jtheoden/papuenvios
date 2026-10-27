/**
 * Contract between the Bizum admin FRONT (src/lib/bizumService.js, paymentFxService.js,
 * bizumErrors.js) and the REAL S3/S4 SQL, on the local scratch database.
 *
 * It checks what the unit tests can only mirror: the settings keys / defaults / ranges the form
 * hard-codes, the RPC parameter names, and that the errors Postgres really raises (PostgREST
 * exposes message / detail / code as message / details / code) are classified by toBizumError
 * without leaking the phone that Postgres echoes in its own details.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { dbSuiteSkipReason, connectAdmin, connectAs, endAll } from './db';
import { loadActors } from './fixtures';
import { BIZUM_SETTING_FIELDS } from '../../lib/bizumService.js';
import { toBizumError } from '../../lib/bizumErrors.js';

// The services import the real client, which refuses to load without env vars; nothing here calls it.
vi.mock('@/lib/supabase', () => ({ supabase: {} }));

const skipReason = await dbSuiteSkipReason({
  functions: ['get_bizum_settings', 'set_bizum_settings', 'get_payment_fx_status', 'set_payment_fx_rate'],
  tables: ['bizum_settings', 'bizum_accounts', 'payment_fx_rates']
});
const describeDb = skipReason ? describe.skip : describe;

/** What PostgREST would hand to supabase-js for a failed statement. */
const asPostgrest = (error) => ({ code: error.code, message: error.message, details: error.detail ?? null, hint: error.hint ?? null });
const failure = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return asPostgrest(error);
  }
  throw new Error('expected the statement to fail');
};

describeDb('Bizum front contract against the real SQL', () => {
  let owner;
  let actors;
  let client;
  const clients = [];
  const accountIds = [];
  const centralRateIds = [];

  const ownerBypass = async (sql, params = []) => {
    await owner.query('BEGIN');
    try {
      await owner.query(`SET LOCAL session_replication_role = 'replica'`);
      await owner.query(sql, params);
      await owner.query('COMMIT');
    } catch (error) {
      await owner.query('ROLLBACK');
      throw error;
    }
  };

  beforeAll(async () => {
    owner = await connectAdmin();
    clients.push(owner);
    actors = await loadActors(owner);
    client = await connectAs(actors.adminId);
    clients.push(client);
  });

  afterAll(async () => {
    if (centralRateIds.length) await owner.query(`DELETE FROM public.exchange_rates WHERE id = ANY($1::uuid[])`, [centralRateIds]);
    if (accountIds.length) await ownerBypass(`DELETE FROM public.bizum_accounts WHERE id = ANY($1::uuid[])`, [accountIds]);
    await endAll(clients);
  });

  it('get_bizum_settings returns exactly the keys the form edits, and the form defaults equal the column DEFAULTs', async () => {
    const { rows } = await client.query('SELECT public.get_bizum_settings() AS s');
    const keys = Object.keys(rows[0].s);
    for (const { key } of BIZUM_SETTING_FIELDS) expect(keys, key).toContain(key);

    const defaults = await owner.query(
      `SELECT column_name, column_default FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'bizum_settings'`
    );
    const byColumn = Object.fromEntries(defaults.rows.map((r) => [r.column_name, r.column_default]));
    for (const { key, default: value } of BIZUM_SETTING_FIELDS) {
      expect(Number(String(byColumn[key]).replace(/[^0-9.]/g, '')), key).toBe(value);
    }
  });

  it('values just outside each form range are rejected with bizum_settings_out_of_range and the offending key', async () => {
    for (const field of BIZUM_SETTING_FIELDS) {
      const step = field.decimals > 0 ? 0.01 : 1;
      const outside = [Number((field.min - step).toFixed(2)), Number((field.max + step).toFixed(2))];
      for (const value of outside) {
        const raw = await failure(client.query('SELECT public.set_bizum_settings($1::jsonb)', [JSON.stringify({ [field.key]: value })]));
        const mapped = toBizumError(raw);
        expect(mapped.token, `${field.key}=${value}`).toBe('bizum_settings_out_of_range');
        expect(mapped.field, `${field.key}=${value}`).toBe(field.key);
        expect(mapped.i18nKey).toBe('settings.bizum.errors.outOfRange');
      }
    }
  });

  it('the window-order CHECKs are reported on the key the form shows the error on', async () => {
    const raw = await failure(client.query('SELECT public.set_bizum_settings($1::jsonb)', [JSON.stringify({ fx_warn_hours: 100, fx_block_hours: 96 })]));
    const mapped = toBizumError(raw);
    expect(mapped.token).toBe('bizum_settings_out_of_range');
    expect(['fx_warn_hours', 'fx_block_hours']).toContain(mapped.field);
  });

  it('get_payment_fx_status exposes the fields and thresholds the FX card reads', async () => {
    const { rows } = await client.query('SELECT public.get_payment_fx_status() AS s');
    const keys = Object.keys(rows[0].s);
    for (const key of ['id', 'mid_rate', 'spread_pct', 'effective_rate', 'source', 'created_by', 'created_at', 'age_hours', 'state', 'fx_warn_hours', 'fx_block_hours']) {
      expect(keys, key).toContain(key);
    }
    expect(['none', 'ok', 'warn', 'blocked']).toContain(rows[0].s.state);
  });

  it('the retired set_payment_fx_rate answers with a token the front maps to a managed-centrally message, and writes nothing', async () => {
    const before = await owner.query('SELECT count(*)::int AS n FROM public.payment_fx_rates');
    const raw = await failure(
      client.query(
        `SELECT public.set_payment_fx_rate(p_mid => $1::numeric, p_spread => $2::numeric, p_source => $3::text,
                                           p_note => $4::text, p_confirm_large_change => $5::boolean) AS r`,
        [0.92, 1.5, 'manual', null, false]
      )
    );
    expect(raw.message).toBe('payment_fx_managed_centrally');
    const mapped = toBizumError(raw);
    expect(mapped.token).toBe('payment_fx_managed_centrally');
    expect(mapped.i18nKey).toMatch(/managedCentrally$/);
    const after = await owner.query('SELECT count(*)::int AS n FROM public.payment_fx_rates');
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('get_payment_fx_status reports the central row: constant source exchange_rates, no author', async () => {
    const { rows: cur } = await owner.query(`SELECT code, id FROM public.currencies WHERE code IN ('USD', 'EUR')`);
    const byCode = Object.fromEntries(cur.map((r) => [r.code, r.id]));
    // DEC-10: only a super_admin writes exchange_rates; promoted for this write only.
    await owner.query(`UPDATE public.user_profiles SET role = 'super_admin' WHERE id = $1`, [actors.adminId]);
    let rows;
    try {
      ({ rows } = await client.query(
        `INSERT INTO public.exchange_rates (from_currency_id, to_currency_id, rate, is_active, effective_date)
         VALUES ($1, $2, 0.92, true, CURRENT_DATE) RETURNING id`,
        [byCode.USD, byCode.EUR]
      ));
    } finally {
      await owner.query(`UPDATE public.user_profiles SET role = 'admin' WHERE id = $1`, [actors.adminId]);
    }
    centralRateIds.push(rows[0].id);
    const status = (await client.query('SELECT public.get_payment_fx_status() AS s')).rows[0].s;
    expect(status).toMatchObject({ id: rows[0].id, source: 'exchange_rates', created_by: null, state: 'ok' });
    expect(Number(status.mid_rate)).toBe(0.92);
    for (const key of ['spread_pct', 'effective_rate', 'age_hours', 'fx_warn_hours', 'fx_block_hours']) {
      expect(Object.keys(status), key).toContain(key);
    }
  });

  it('classifies the real account errors and never carries the phone Postgres echoes', async () => {
    const phone = '+34699111222';
    const insert = (value) =>
      client.query(
        `INSERT INTO public.bizum_accounts (account_name, holder_name, phone, per_operation_limit)
         VALUES ('contract', 'holder', $1, 0) RETURNING id`,
        [value]
      );
    const created = await insert(phone);
    accountIds.push(created.rows[0].id);

    // Postgres echoes the key in DETAIL when the role may read the row (the owner does; PostgREST
    // forwards it as `details`): the mapper must drop it whichever role produced the error.
    const echoed = await failure(
      owner.query(`INSERT INTO public.bizum_accounts (account_name, holder_name, phone, per_operation_limit) VALUES ('c', 'h', $1, 0)`, [phone])
    );
    expect(JSON.stringify(echoed)).toContain('699111222');
    expect(JSON.stringify({ ...toBizumError(echoed) })).not.toContain('699111222');

    const duplicate = await failure(insert(phone));
    const mappedDuplicate = toBizumError(duplicate);
    expect(mappedDuplicate).toMatchObject({ field: 'phone', i18nKey: 'settings.bizum.errors.phoneDuplicate' });
    expect(JSON.stringify({ ...mappedDuplicate, message: mappedDuplicate.message, stack: mappedDuplicate.stack })).not.toContain('699111222');

    const malformed = await failure(insert('612345678'));
    expect(toBizumError(malformed)).toMatchObject({ field: 'phone', i18nKey: 'settings.bizum.errors.phoneInvalid' });

    const negative = await failure(
      client.query(`INSERT INTO public.bizum_accounts (account_name, holder_name, phone, per_operation_limit) VALUES ('c', 'h', '+34699111333', -1)`)
    );
    expect(toBizumError(negative)).toMatchObject({ field: 'per_operation_limit' });

    const noDelete = await failure(client.query(`DELETE FROM public.bizum_accounts WHERE id = $1`, [created.rows[0].id]));
    expect(['forbidden', 'bizum_accounts_no_delete']).toContain(toBizumError(noDelete).token);
  });

  it('a non-admin reads zero accounts and cannot write (the front reads an empty UPDATE result as forbidden)', async () => {
    const customer = await connectAs(actors.customerId);
    clients.push(customer);
    const { rows } = await customer.query('SELECT id FROM public.bizum_accounts');
    expect(rows).toHaveLength(0);
    const update = await customer.query(`UPDATE public.bizum_accounts SET is_active = false RETURNING id`);
    expect(update.rowCount).toBe(0);
    const raw = await failure(customer.query('SELECT public.get_bizum_settings()'));
    expect(toBizumError(raw).i18nKey).toBe('settings.bizum.errors.forbidden');
  });
});
