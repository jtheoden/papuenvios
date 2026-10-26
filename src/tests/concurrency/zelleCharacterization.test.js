/**
 * Characterization tests of the LIVE Zelle / payment-method SQL behavior (no behavior change).
 *
 * These pin what production does TODAY so that the Bizum work (design v2) cannot silently alter it.
 * Where a test fails after a deliberate change, update it in the same PR and say why.
 * Expected values were cross-checked against the remote project with read-only catalog SELECTs
 * (function ACLs, table ACLs, policies, trigger names) on 2026-10-15.
 *
 * Runs against the LOCAL scratch database built by `npm run test:db:bootstrap`.
 * Skipped with a printed reason when the database is unreachable or lacks the live objects.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dbSuiteSkipReason, connectAdmin, connectAs, connectAnon, endAll } from './db';
import { loadActors } from './fixtures';

const skipReason = await dbSuiteSkipReason({
  functions: [
    'payment_method_allowed', 'set_payment_method_enabled', 'list_payment_methods_public',
    'guard_payment_method_enabled', 'list_zelle_accounts_public', 'zelle_account_usage',
    'zelle_account_capacity', 'get_zelle_accounts_usage', 'select_available_zelle_account',
    'guard_orders_owner_insert', 'guard_orders_owner_update', 'guard_remittance_owner_insert',
    'is_admin_user', 'is_super_admin'
  ],
  tables: ['payment_methods', 'zelle_accounts', 'zelle_transaction_history', 'orders', 'remittances',
    'remittance_types', 'currencies', 'activity_logs', 'user_profiles']
});
const describeDb = skipReason ? describe.skip : describe;

const ZELLE_SEED = { zelle: [true, true, true], bizum: [false, false, false] };

describeDb('live Zelle / payment-method behavior (characterization)', () => {
  let admin;
  let actors;
  const clients = [];
  const accounts = [];
  const orders = [];
  const remittances = [];
  const remittanceTypes = [];

  const as = async (userId) => {
    const c = await connectAs(userId);
    clients.push(c);
    return c;
  };
  const asCustomer = () => as(actors.customerId);
  const asAdmin = () => as(actors.adminId);

  const currencyId = async (code) => {
    const { rows } = await admin.query(`SELECT id FROM public.currencies WHERE code = $1`, [code]);
    return rows[0].id;
  };

  const seedAccount = async (overrides = {}) => {
    const a = {
      name: `zc-${randomUUID().slice(0, 8)}`,
      email: `zc-${randomUUID().slice(0, 8)}@example.test`,
      phone: '+1 555 0100',
      holder: 'Holder Test',
      bank: 'Secret Bank',
      isActive: true,
      forProducts: true,
      forRemittances: true,
      daily: null,
      monthly: null,
      security: null,
      priority: 0,
      showEmail: true,
      showPhone: true,
      ...overrides
    };
    const { rows } = await admin.query(
      `INSERT INTO public.zelle_accounts (account_name, email, phone, account_holder, bank_name, is_active,
         for_products, for_remittances, daily_limit, monthly_limit, security_limit, priority_order,
         show_email, show_phone, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'hidden-notes-marker') RETURNING id`,
      [a.name, a.email, a.phone, a.holder, a.bank, a.isActive, a.forProducts, a.forRemittances,
       a.daily, a.monthly, a.security, a.priority, a.showEmail, a.showPhone]
    );
    accounts.push(rows[0].id);
    return { id: rows[0].id, ...a };
  };

  const seedOrderForAccount = async (accountId, { amount, createdAt = null, status = 'pending',
    paymentStatus = 'pending', currency = 'USD' }) => {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO public.orders (id, user_id, order_type, status, subtotal, total_amount, currency_id,
                                  payment_status, payment_method, zelle_account_id, stock_managed,
                                  order_number, created_at)
       VALUES ($1,$2,'product',$3,$4,$4,$5,$6,'zelle',$7,false,$8, COALESCE($9::timestamptz, now()))`,
      [id, actors.customerId, status, amount, await currencyId(currency), paymentStatus, accountId,
       `ZC-${id.slice(0, 13)}`, createdAt]
    );
    orders.push(id);
    return id;
  };

  const seedRemittanceForAccount = async (accountId, { amountSent, deliveryCost = 0, status = 'payment_pending',
    createdAt = null, currency = 'USD' }) => {
    if (!remittanceTypes.length) {
      const { rows } = await admin.query(
        `INSERT INTO public.remittance_types (name, currency_code, delivery_currency, exchange_rate, min_amount, delivery_method)
         VALUES ('zc-type', 'USD', 'CUP', 300, 1, 'cash') RETURNING id`
      );
      remittanceTypes.push(rows[0].id);
    }
    const id = randomUUID();
    await admin.query(
      `INSERT INTO public.remittances (id, user_id, remittance_type_id, amount_sent, exchange_rate,
         commission_percentage, commission_fixed, commission_total, amount_to_deliver, currency_sent,
         currency_delivered, recipient_name, recipient_phone, status, delivery_cost, zelle_account_id, created_at)
       VALUES ($1,$2,$3,$4,300,0,0,0,$4,$5,'CUP','Rcpt','+5355550100',$6,$7,$8, COALESCE($9::timestamptz, now()))`,
      [id, actors.customerId, remittanceTypes[0], amountSent, currency, status, deliveryCost, accountId, createdAt]
    );
    remittances.push(id);
    return id;
  };

  const restorePaymentMethods = async () => {
    for (const [code, [available, o, r]] of Object.entries(ZELLE_SEED)) {
      await admin.query(
        `UPDATE public.payment_methods SET available=$2, enabled_for_orders=$3, enabled_for_remittances=$4,
                disabled_reason=NULL WHERE code=$1`,
        [code, available, o, r]
      );
    }
    await admin.query(`DELETE FROM public.activity_logs WHERE action = 'payment_method_toggled'`);
  };

  beforeAll(async () => {
    admin = await connectAdmin();
    actors = await loadActors(admin);
    await restorePaymentMethods();
  });

  afterEach(async () => {
    await endAll(clients.splice(0));
    if (remittances.length) await admin.query(`DELETE FROM public.remittances WHERE id = ANY($1)`, [remittances.splice(0)]);
    if (orders.length) await admin.query(`DELETE FROM public.orders WHERE id = ANY($1)`, [orders.splice(0)]);
    if (accounts.length) await admin.query(`DELETE FROM public.zelle_accounts WHERE id = ANY($1)`, [accounts.splice(0)]);
    if (remittanceTypes.length) await admin.query(`DELETE FROM public.remittance_types WHERE id = ANY($1)`, [remittanceTypes.splice(0)]);
    await restorePaymentMethods();
  });

  afterAll(async () => {
    await admin.end();
  });

  // --------------------------------------------------------------------------------------------
  describe('payment_method_allowed / set_payment_method_enabled / guard_payment_method_enabled', () => {
    const insertOrder = (client, method = 'zelle', userId = actors.customerId) =>
      client.query(
        `INSERT INTO public.orders (user_id, order_type, subtotal, total_amount, currency_id, payment_method)
         VALUES ($1, 'product', 10, 10, $2, $3) RETURNING id`,
        [userId, actors._usd, method]
      );

    beforeAll(async () => {
      actors._usd = await currencyId('USD');
    });

    it('payment_method_allowed fails closed and follows available AND the flow flag', async () => {
      const q = async (code, flow) =>
        (await admin.query(`SELECT public.payment_method_allowed($1, $2) AS ok`, [code, flow])).rows[0].ok;
      expect(await q('zelle', 'orders')).toBe(true);
      expect(await q('zelle', 'remittances')).toBe(true);
      expect(await q('bizum', 'orders')).toBe(false);
      expect(await q('bizum', 'remittances')).toBe(false);
      expect(await q('paypal', 'orders')).toBe(false);
      expect(await q(null, 'orders')).toBe(false);
      expect(await q('zelle', 'nonsense')).toBe(false);
      expect(await q('zelle', null)).toBe(false);
    });

    it('non-admins cannot toggle (42501 payment_method_forbidden)', async () => {
      const customer = await asCustomer();
      await expect(
        customer.query(`SELECT public.set_payment_method_enabled('zelle','orders',false,NULL,true)`)
      ).rejects.toMatchObject({ code: '42501', message: 'payment_method_forbidden' });
    });

    it('rejects an invalid flow, a NULL flag, an over-long reason and an unknown method (P0001)', async () => {
      const a = await asAdmin();
      const call = (...args) => a.query(`SELECT public.set_payment_method_enabled($1,$2,$3,$4,$5)`, args);
      await expect(call('zelle', 'products', false, null, true)).rejects.toMatchObject({ code: 'P0001', message: 'payment_method_invalid_flow' });
      await expect(call('zelle', 'orders', null, null, true)).rejects.toMatchObject({ code: 'P0001', message: 'payment_method_invalid_flow' });
      await expect(call('zelle', 'orders', false, 'x'.repeat(201), true)).rejects.toMatchObject({ code: 'P0001', message: 'payment_method_reason_too_long' });
      await expect(call('paypal', 'orders', false, null, true)).rejects.toMatchObject({ code: 'P0001', message: 'payment_method_not_found' });
    });

    it('an unavailable method (bizum) cannot be enabled', async () => {
      const a = await asAdmin();
      await expect(
        a.query(`SELECT public.set_payment_method_enabled('bizum','orders',true,NULL,false)`)
      ).rejects.toMatchObject({ code: 'P0001', message: 'payment_method_unavailable' });
    });

    it('toggling to the current state is idempotent: same row, no audit line', async () => {
      const a = await asAdmin();
      const { rows } = await a.query(`SELECT public.set_payment_method_enabled('bizum','orders',false,NULL,false) AS r`);
      expect(rows[0].r).toMatchObject({ code: 'bizum', available: false, enabled_for_orders: false });
      const log = await admin.query(`SELECT count(*)::int AS n FROM public.activity_logs WHERE action = 'payment_method_toggled'`);
      expect(log.rows[0].n).toBe(0);
    });

    it('the LAST enabled method of a flow needs p_confirm_last = true', async () => {
      const a = await asAdmin();
      await expect(
        a.query(`SELECT public.set_payment_method_enabled('zelle','orders',false,'maintenance',false)`)
      ).rejects.toMatchObject({ code: 'P0001', message: 'payment_method_last_enabled' });

      const { rows } = await a.query(
        `SELECT public.set_payment_method_enabled('zelle','orders',false,'maintenance',true) AS r`
      );
      expect(rows[0].r).toMatchObject({ code: 'zelle', enabled_for_orders: false, enabled_for_remittances: true, disabled_reason: 'maintenance' });

      const log = await admin.query(
        `SELECT performed_by, metadata FROM public.activity_logs WHERE action = 'payment_method_toggled'`
      );
      expect(log.rowCount).toBe(1);
      expect(log.rows[0].performed_by).toBe(actors.adminId);
      expect(log.rows[0].metadata).toMatchObject({ code: 'zelle', flow: 'orders', enabled: false, previous: true, confirm_last: true });
    });

    it('re-enabling every flow clears disabled_reason', async () => {
      const a = await asAdmin();
      await a.query(`SELECT public.set_payment_method_enabled('zelle','orders',false,'maintenance',true)`);
      const { rows } = await a.query(`SELECT public.set_payment_method_enabled('zelle','orders',true,NULL,false) AS r`);
      expect(rows[0].r).toMatchObject({ enabled_for_orders: true, enabled_for_remittances: true, disabled_reason: null });
    });

    it('a disabled flow blocks CREATION for customers only (P0001 payment_method_disabled); admin and postgres bypass', async () => {
      const a = await asAdmin();
      await a.query(`SELECT public.set_payment_method_enabled('zelle','orders',false,NULL,true)`);

      const customer = await asCustomer();
      await expect(insertOrder(customer)).rejects.toMatchObject({ code: 'P0001', message: 'payment_method_disabled' });

      const viaAdmin = await insertOrder(a, 'zelle', actors.adminId);
      orders.push(viaAdmin.rows[0].id);
      const viaSuper = await insertOrder(admin);
      orders.push(viaSuper.rows[0].id);
    });

    it('creation of an order with a method that is not available (bizum) is rejected for customers', async () => {
      const customer = await asCustomer();
      await expect(insertOrder(customer, 'bizum')).rejects.toMatchObject({ code: 'P0001', message: 'payment_method_disabled' });
      await expect(insertOrder(customer, 'paypal')).rejects.toMatchObject({ code: 'P0001', message: 'payment_method_disabled' });
    });

    it('an enabled zelle order insert passes the guard', async () => {
      const customer = await asCustomer();
      const { rows } = await insertOrder(customer);
      orders.push(rows[0].id);
      expect(rows[0].id).toBeTruthy();
    });

    it('shared-lock semantics: an insert waits for an in-flight toggle and then sees its result', async () => {
      const toggler = await asAdmin();
      await toggler.query('BEGIN');
      await toggler.query(`SELECT public.set_payment_method_enabled('zelle','orders',false,NULL,true)`);

      const customer = await asCustomer();
      let settled = false;
      const pending = insertOrder(customer).then(
        (v) => { settled = true; return { v }; },
        (e) => { settled = true; return { e }; }
      );

      const deadline = Date.now() + 5000;
      for (;;) {
        const { rows } = await admin.query(
          `SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND mode = 'ShareLock'
             AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`
        );
        if (rows[0].n >= 1) break;
        if (Date.now() > deadline) throw new Error('insert never parked on the payment_methods advisory lock');
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(settled).toBe(false);

      await toggler.query('COMMIT');
      const result = await pending;
      expect(result.e).toMatchObject({ code: 'P0001', message: 'payment_method_disabled' });
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('list_zelle_accounts_public', () => {
    const LIST_COLUMNS = ['id', 'account_name', 'account_holder', 'email', 'phone', 'priority_order',
      'for_products', 'for_remittances', 'available'];

    it('returns exactly the public columns and honours show_email / show_phone', async () => {
      const both = await seedAccount({ priority: 1 });
      const noEmail = await seedAccount({ priority: 2, showEmail: false });
      const noPhone = await seedAccount({ priority: 3, showPhone: false });
      const customer = await asCustomer();

      const res = await customer.query(`SELECT * FROM public.list_zelle_accounts_public()`);
      expect(res.fields.map((f) => f.name)).toEqual(LIST_COLUMNS);

      const byId = Object.fromEntries(res.rows.map((r) => [r.id, r]));
      expect(byId[both.id]).toMatchObject({ email: both.email, phone: both.phone });
      expect(byId[noEmail.id]).toMatchObject({ email: null, phone: noEmail.phone });
      expect(byId[noPhone.id]).toMatchObject({ email: noPhone.email, phone: null });
    });

    it('never leaks hidden contact data or internal columns', async () => {
      const acc = await seedAccount({ showEmail: false, showPhone: true, daily: 500, monthly: 5000, security: 900 });
      const customer = await asCustomer();
      const { rows } = await customer.query(`SELECT * FROM public.list_zelle_accounts_public()`);
      const mine = rows.filter((r) => r.id === acc.id);
      expect(mine).toHaveLength(1);
      expect(mine[0].email).toBeNull();
      expect(mine[0].phone).toBe(acc.phone);
      const text = JSON.stringify(mine);
      expect(text).not.toContain(acc.email);
      expect(text).not.toContain('Secret Bank');
      expect(text).not.toContain('hidden-notes-marker');
      for (const forbidden of ['bank_name', 'notes', 'daily_limit', 'monthly_limit', 'security_limit', 'show_email', 'is_active']) {
        expect(text).not.toContain(forbidden);
      }
    });

    it('lists only active accounts, ordered by priority_order then account_name, and filters by p_usage', async () => {
      const first = await seedAccount({ priority: 1, name: 'zc-b', forRemittances: false });
      const second = await seedAccount({ priority: 1, name: 'zc-c', forProducts: false });
      const third = await seedAccount({ priority: 2, name: 'zc-a' });
      const inactive = await seedAccount({ isActive: false, name: 'zc-inactive' });
      const mine = new Set([first.id, second.id, third.id, inactive.id]);
      const customer = await asCustomer();

      const ids = async (...args) =>
        (await customer.query(`SELECT id FROM public.list_zelle_accounts_public($1, $2)`, args)).rows
          .map((r) => r.id).filter((id) => mine.has(id));

      expect(await ids(null, null)).toEqual([first.id, second.id, third.id]);
      expect(await ids('products', null)).toEqual([first.id, third.id]);
      expect(await ids('remittances', null)).toEqual([second.id, third.id]);
    });

    it('rejects an invalid usage or a negative amount (22023)', async () => {
      const customer = await asCustomer();
      await expect(customer.query(`SELECT * FROM public.list_zelle_accounts_public('combos')`)).rejects.toMatchObject({ code: '22023' });
      await expect(customer.query(`SELECT * FROM public.list_zelle_accounts_public(NULL, -1)`)).rejects.toMatchObject({ code: '22023' });
    });

    it('`available` is advisory: false when the amount does not fit, the row stays listed', async () => {
      const acc = await seedAccount({ daily: 100, security: 0 });
      const customer = await asCustomer();
      const { rows } = await customer.query(`SELECT id, available FROM public.list_zelle_accounts_public(NULL, $1)`, [150]);
      expect(rows.find((r) => r.id === acc.id)).toMatchObject({ available: false });
    });

    it('anon cannot call it (42501)', async () => {
      const anon = await connectAnon();
      clients.push(anon);
      await expect(anon.query(`SELECT * FROM public.list_zelle_accounts_public()`)).rejects.toMatchObject({ code: '42501' });
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('zelle_account_usage / zelle_account_capacity', () => {
    const usageOf = async (id) =>
      (await admin.query(`SELECT daily_usage::float AS d, monthly_usage::float AS m FROM public.zelle_account_usage($1)`, [id])).rows[0];
    const fitsOf = async (id, amount) =>
      (await admin.query(`SELECT fits FROM public.zelle_account_capacity($1) WHERE account_id = $2`, [amount, id])).rows[0].fits;

    const nyBoundaries = async () => {
      const { rows } = await admin.query(
        `SELECT date_trunc('day', now() AT TIME ZONE 'America/New_York') AT TIME ZONE 'America/New_York' AS day0,
                date_trunc('month', now() AT TIME ZONE 'America/New_York') AT TIME ZONE 'America/New_York' AS month0`
      );
      return rows[0];
    };

    it('an account without movements has zero usage; unknown id returns no row', async () => {
      const acc = await seedAccount();
      expect(await usageOf(acc.id)).toEqual({ d: 0, m: 0 });
      const { rowCount } = await admin.query(`SELECT * FROM public.zelle_account_usage($1)`, [randomUUID()]);
      expect(rowCount).toBe(0);
    });

    it('sums USD orders; excludes cancelled, rejected and non-USD orders', async () => {
      const acc = await seedAccount();
      await seedOrderForAccount(acc.id, { amount: 10 });
      await seedOrderForAccount(acc.id, { amount: 20, status: 'processing', paymentStatus: 'validated' });
      await seedOrderForAccount(acc.id, { amount: 1000, status: 'cancelled', paymentStatus: 'rejected' });
      await seedOrderForAccount(acc.id, { amount: 2000, paymentStatus: 'rejected' });
      await seedOrderForAccount(acc.id, { amount: 3000, currency: 'EUR' });
      expect(await usageOf(acc.id)).toEqual({ d: 30, m: 30 });
    });

    it('remittances count amount_sent + delivery_cost; payment_rejected / cancelled / non-USD are excluded', async () => {
      const acc = await seedAccount();
      await seedRemittanceForAccount(acc.id, { amountSent: 100, deliveryCost: 5 });
      await seedRemittanceForAccount(acc.id, { amountSent: 50, status: 'processing' });
      await seedRemittanceForAccount(acc.id, { amountSent: 900, status: 'payment_rejected' });
      await seedRemittanceForAccount(acc.id, { amountSent: 800, status: 'cancelled' });
      await seedRemittanceForAccount(acc.id, { amountSent: 700, currency: 'EUR' });
      expect(await usageOf(acc.id)).toEqual({ d: 155, m: 155 });
    });

    it('windows are America/New_York: day start inclusive; the previous second is monthly only', async () => {
      const acc = await seedAccount();
      const { day0, month0 } = await nyBoundaries();
      await seedOrderForAccount(acc.id, { amount: 7, createdAt: day0 });
      const prevSecond = new Date(day0.getTime() - 1000);
      await seedOrderForAccount(acc.id, { amount: 11, createdAt: prevSecond });
      const beforeMonth = new Date(month0.getTime() - 1000);
      await seedOrderForAccount(acc.id, { amount: 13, createdAt: beforeMonth });

      const prevSecondInMonth = prevSecond.getTime() >= month0.getTime();
      expect(await usageOf(acc.id)).toEqual({ d: 7, m: 7 + (prevSecondInMonth ? 11 : 0) });
    });

    it('limits are advisory and 0 / NULL mean "no cap" (daily, monthly and security)', async () => {
      const unlimited = await seedAccount({ daily: 0, monthly: 0, security: 0 });
      const nulls = await seedAccount({ daily: null, monthly: null, security: null });
      expect(await fitsOf(unlimited.id, 1e9)).toBe(true);
      expect(await fitsOf(nulls.id, 1e9)).toBe(true);
    });

    it('daily / monthly caps compare usage + amount with <=; security_limit is compared against DAILY usage', async () => {
      const acc = await seedAccount({ daily: 100, monthly: 0, security: 0 });
      await seedOrderForAccount(acc.id, { amount: 60 });
      expect(await fitsOf(acc.id, 40)).toBe(true);
      expect(await fitsOf(acc.id, 40.01)).toBe(false);

      const monthly = await seedAccount({ daily: 0, monthly: 80, security: 0 });
      await seedOrderForAccount(monthly.id, { amount: 50 });
      expect(await fitsOf(monthly.id, 30)).toBe(true);
      expect(await fitsOf(monthly.id, 31)).toBe(false);

      const security = await seedAccount({ daily: 0, monthly: 0, security: 70 });
      await seedOrderForAccount(security.id, { amount: 60 });
      expect(await fitsOf(security.id, 10)).toBe(true);
      expect(await fitsOf(security.id, 11)).toBe(false);
    });

    it('a NULL amount always fits; a freshly inserted account keeps the 1000.00 default security limit', async () => {
      const { rows } = await admin.query(
        `INSERT INTO public.zelle_accounts (account_name, email) VALUES ($1, $2) RETURNING id, security_limit::float AS s`,
        [`zc-default-${randomUUID().slice(0, 6)}`, 'default@example.test']
      );
      accounts.push(rows[0].id);
      expect(rows[0].s).toBe(1000);
      expect(await fitsOf(rows[0].id, null)).toBe(true);
      expect(await fitsOf(rows[0].id, 1000)).toBe(true);
      expect(await fitsOf(rows[0].id, 1000.01)).toBe(false);
    });

    it('get_zelle_accounts_usage is admin-only (42501 for customers) and select_available_zelle_account validates input', async () => {
      const customer = await asCustomer();
      await expect(customer.query(`SELECT * FROM public.get_zelle_accounts_usage()`)).rejects.toMatchObject({ code: '42501' });
      const a = await asAdmin();
      const acc = await seedAccount();
      const { rows } = await a.query(`SELECT * FROM public.get_zelle_accounts_usage() WHERE id = $1`, [acc.id]);
      expect(rows).toHaveLength(1);

      await expect(customer.query(`SELECT public.select_available_zelle_account('product', 0)`)).rejects.toMatchObject({ code: '22023' });
      await expect(customer.query(`SELECT public.select_available_zelle_account('gift', 10)`)).rejects.toMatchObject({ code: '22023' });
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('orders owner guards (guard_orders_owner_insert / guard_orders_owner_update)', () => {
    const newOrder = async () => {
      const acc = await seedAccount();
      const id = await seedOrderForAccount(acc.id, { amount: 25 });
      return { id, accountId: acc.id };
    };

    it('owner UPDATE cannot change payment_method, zelle_account_id or total_amount (42501 naming the column)', async () => {
      const { id } = await newOrder();
      const other = await seedAccount();
      const owner = await asCustomer();

      await expect(owner.query(`UPDATE public.orders SET payment_method = 'bizum' WHERE id = $1`, [id]))
        .rejects.toMatchObject({ code: '42501', message: 'orders_owner_update_forbidden: column payment_method' });
      await expect(owner.query(`UPDATE public.orders SET zelle_account_id = $2 WHERE id = $1`, [id, other.id]))
        .rejects.toMatchObject({ code: '42501', message: 'orders_owner_update_forbidden: column zelle_account_id' });
      await expect(owner.query(`UPDATE public.orders SET total_amount = 1 WHERE id = $1`, [id]))
        .rejects.toMatchObject({ code: '42501', message: 'orders_owner_update_forbidden: column total_amount' });
    });

    it('owner can upload a proof: payment_proof_url + payment_reference + payment_status proof_uploaded', async () => {
      const { id } = await newOrder();
      const owner = await asCustomer();
      // E8: the status columns change only through the RPC, which stores the proof in the same statement
      const { rows } = await owner.query(
        'SELECT payment_status, payment_proof_url FROM public.order_submit_proof($1, $2, $3)',
        [id, 'payment-proofs/p.png', 'REF-1']
      );
      expect(rows[0]).toMatchObject({ payment_status: 'proof_uploaded', payment_proof_url: 'payment-proofs/p.png' });
    });

    it('owner cannot set the proof fields without moving to proof_uploaded, nor self-validate', async () => {
      const { id } = await newOrder();
      const owner = await asCustomer();
      await expect(owner.query(`UPDATE public.orders SET payment_proof_url = 'x' WHERE id = $1`, [id]))
        .rejects.toMatchObject({ code: '42501', message: 'orders_owner_update_forbidden: column payment_proof_url' });
      await expect(owner.query(`UPDATE public.orders SET payment_status = 'validated' WHERE id = $1`, [id]))
        .rejects.toMatchObject({ code: '42501', message: 'orders_owner_update_forbidden: column payment_status' });
      await expect(owner.query(`UPDATE public.orders SET status = 'processing' WHERE id = $1`, [id]))
        .rejects.toMatchObject({ code: '42501', message: 'orders_owner_update_forbidden: column status' });
    });

    it('owner can cancel a pending order (pending -> cancelled + rejected) and reopen it', async () => {
      const { id } = await newOrder();
      const owner = await asCustomer();
      const cancelled = await owner.query('SELECT status, payment_status FROM public.order_cancel($1, $2)', [id, 'changed my mind']);
      expect(cancelled.rows[0]).toEqual({ status: 'cancelled', payment_status: 'rejected' });
      const { rows } = await owner.query('SELECT status, payment_status FROM public.order_reopen($1)', [id]);
      expect(rows[0]).toEqual({ status: 'pending', payment_status: 'pending' });
    });

    // phase 1.5 S1: subtotal moves with the total, otherwise orders_money_total_identity_chk (applies to every writer) rejects it
    it('admin and postgres bypass the owner UPDATE guard', async () => {
      const { id } = await newOrder();
      const a = await asAdmin();
      const { rows } = await a.query(`UPDATE public.orders SET subtotal = 26, total_amount = 26 WHERE id = $1 RETURNING total_amount::float AS t`, [id]);
      expect(rows[0].t).toBe(26);
    });

    it('owner INSERT: only for self, status/payment_status pending, no staff-only fields', async () => {
      const usd = await currencyId('USD');
      const owner = await asCustomer();
      const base = (extra = '', value = '') => owner.query(
        `INSERT INTO public.orders (user_id, order_type, subtotal, total_amount, currency_id, payment_method${extra})
         VALUES ($1,'product',10,10,$2,'zelle'${value}) RETURNING id`,
        [actors.customerId, usd]
      );
      const ok = await base();
      orders.push(ok.rows[0].id);

      await expect(owner.query(
        `INSERT INTO public.orders (user_id, order_type, subtotal, total_amount, currency_id, payment_method)
         VALUES ($1,'product',10,10,$2,'zelle')`, [actors.adminId, usd]
      )).rejects.toMatchObject({ code: '42501', message: 'orders_owner_insert_forbidden: user_id' });
      await expect(base(', status', ", 'processing'")).rejects.toMatchObject({ code: '42501', message: 'orders_owner_insert_forbidden: status' });
      await expect(base(', payment_status', ", 'validated'")).rejects.toMatchObject({ code: '42501', message: 'orders_owner_insert_forbidden: payment_status' });
      await expect(base(', admin_notes', ", 'note'")).rejects.toMatchObject({ code: '42501', message: 'orders_owner_insert_forbidden: admin_notes' });
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('grants on the Zelle and payment_methods objects', () => {
    const fnPriv = async (role, signature) =>
      (await admin.query(`SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok`, [role, signature])).rows[0].ok;
    const tblPriv = async (role, table, priv) =>
      (await admin.query(`SELECT has_table_privilege($1, $2, $3) AS ok`, [role, `public.${table}`, priv])).rows[0].ok;

    // [signature, anon, authenticated, service_role | undefined = not pinned]
    const FUNCTIONS = [
      ['public.get_zelle_accounts_usage()', false, true, true],
      ['public.list_payment_methods_public()', false, true, true],
      ['public.list_zelle_accounts_public(text,numeric)', false, true, true],
      ['public.payment_method_allowed(text,text)', false, true, true],
      ['public.select_available_zelle_account(character varying,numeric)', false, true, true],
      ['public.set_payment_method_enabled(text,text,boolean,text,boolean)', false, true, true],
      ['public.zelle_account_capacity(numeric)', false, false, true],
      ['public.zelle_account_usage(uuid)', false, false, true],
      ['public.guard_payment_method_enabled()', false, false, undefined],
      ['public.guard_orders_owner_insert()', false, false, undefined],
      ['public.guard_orders_owner_update()', false, false, undefined],
      ['public.guard_orders_stock_columns()', false, false, undefined]
    ];

    it.each(FUNCTIONS)('EXECUTE on %s: anon=%s authenticated=%s service_role=%s', async (sig, anon, auth, service) => {
      expect(await fnPriv('anon', sig)).toBe(anon);
      expect(await fnPriv('authenticated', sig)).toBe(auth);
      if (service !== undefined) expect(await fnPriv('service_role', sig)).toBe(service);
    });

    it('payment_methods: authenticated can only SELECT (RLS limits it to admins); anon has nothing', async () => {
      for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        expect(await tblPriv('anon', 'payment_methods', p)).toBe(false);
        expect(await tblPriv('authenticated', 'payment_methods', p)).toBe(p === 'SELECT');
      }
      const { rows } = await admin.query(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public.payment_methods'::regclass`);
      expect(rows[0].relrowsecurity).toBe(true);
    });

    it('payment_methods rows are invisible to customers and visible to admins', async () => {
      const customer = await asCustomer();
      expect((await customer.query(`SELECT code FROM public.payment_methods`)).rowCount).toBe(0);
      const a = await asAdmin();
      expect((await a.query(`SELECT code FROM public.payment_methods ORDER BY code`)).rows.map((r) => r.code)).toEqual(['bizum', 'zelle']);
    });

    it.each(['zelle_accounts', 'zelle_transaction_history'])('%s: anon has nothing, authenticated has DML (RLS decides rows)', async (table) => {
      for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        expect(await tblPriv('anon', table, p)).toBe(false);
        expect(await tblPriv('authenticated', table, p)).toBe(true);
      }
    });

    it('zelle_accounts policies: only admin manage remains (customers read via RPC since 20261014140000)', async () => {
      const { rows } = await admin.query(
        `SELECT policyname, cmd FROM pg_policies WHERE schemaname='public' AND tablename='zelle_accounts' ORDER BY policyname`
      );
      expect(rows).toEqual([
        { policyname: 'zelle_accounts_manage', cmd: 'ALL' }
      ]);
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('trigger firing order on orders and remittances', () => {
    // Postgres fires same-timing row triggers of one event alphabetically by name.
    const EVENT = { insert: 4, update: 16 };
    const triggers = async (table, timing, event) => {
      const { rows } = await admin.query(
        `SELECT tgname FROM pg_trigger
          WHERE tgrelid = $1::regclass AND NOT tgisinternal AND tgenabled IN ('O', 'A') -- A = ENABLE ALWAYS (financial audit trail)
            AND (tgtype & 1) = 1 AND (tgtype & $2) = $2
            AND ((tgtype & 2) = 2) = $3
          ORDER BY tgname COLLATE "C"`,
        [`public.${table}`, EVENT[event], timing === 'before']
      );
      return rows.map((r) => r.tgname);
    };

    it('orders BEFORE INSERT', async () => {
      expect(await triggers('orders', 'before', 'insert')).toEqual([
        'guard_order_offer_id',
        'guard_orders_owner_insert',
        'guard_orders_stock_columns',
        'guard_payment_method_enabled',
        'guard_reset_lock_orders',
        'seal_bizum_payment',
        'trigger_set_order_number'
      ]);
    });

    it('orders BEFORE UPDATE', async () => {
      expect(await triggers('orders', 'before', 'update')).toEqual([
        'guard_bizum_quote_immutable',
        'guard_orders_owner_update',
        'guard_status_via_rpc', // E8 (20261024120000): status columns only through the transition RPCs
        'trg_orders_admin_self_dealing', // separation of duties (20261101100100); acts only for an admin acting on his own order
        'trigger_update_orders_updated_at'
      ]);
    });

    it('orders AFTER UPDATE', async () => {
      expect(await triggers('orders', 'after', 'update')).toEqual([
        'audit_financial_update', // financial audit trail (20261020100000)
        'audit_order_status',
        'courier_accrual_on_delivered', // courier accrual on delivery (20261031110000); never blocks the delivery
        'release_stock_on_order_cancel',
        'trg_refund_request_on_cancel', // refunds queue (20261029100200)
        'trg_refund_request_on_reopen'
      ]);
    });

    it('remittances BEFORE INSERT: the payment-method check runs BEFORE the owner guard (phase 1.5 S2 adds guard_remittance_pricing after it; S4 adds guard_remittance_offer_id before the owner guard)', async () => {
      expect(await triggers('remittances', 'before', 'insert')).toEqual([
        'guard_payment_method_enabled',
        'guard_remittance_offer_id',
        'guard_remittance_owner_insert',
        'guard_remittance_pricing',
        'guard_reset_lock_remittances',
        'trigger_generate_remittance_number'
      ]);
    });

    it('remittances BEFORE UPDATE and AFTER UPDATE', async () => {
      // + money-columns guard (20261023110000), fires first (alphabetical order)
      expect(await triggers('remittances', 'before', 'update')).toEqual(['guard_commission_acceptance', 'guard_remittance_money_columns', 'guard_remittance_owner_update', 'guard_status_via_rpc', 'trg_remittances_admin_self_dealing']); // + commission acceptance guard (20261028100200), separation of duties (20261101100200)
      expect(await triggers('remittances', 'after', 'update')).toEqual(['audit_financial_update', 'audit_remittance_status', 'courier_accrual_on_delivered', 'trg_refund_request_on_cancel', 'trg_refund_request_on_reopen']); // + financial audit trail (20261020100000), courier accrual on delivery (20261031110000), refunds queue (20261029100200)
    });
  });

  // --------------------------------------------------------------------------------------------
  describe('remittances flow, bypass roles, public listings, table privileges, seed parity', () => {
    const ensureRemittanceType = async () => {
      if (!remittanceTypes.length) {
        const { rows } = await admin.query(
          `INSERT INTO public.remittance_types (name, currency_code, delivery_currency, exchange_rate, min_amount, delivery_method)
           VALUES ('zc-type', 'USD', 'CUP', 300, 1, 'cash') RETURNING id`
        );
        remittanceTypes.push(rows[0].id);
      }
      return remittanceTypes[0];
    };
    const insertRemittance = async (client, { method = 'zelle', userId = actors.customerId, extraCols = '', extraVals = '' } = {}) => {
      const typeId = await ensureRemittanceType();
      const res = await client.query(
        `INSERT INTO public.remittances (user_id, remittance_type_id, amount_sent, exchange_rate, commission_percentage,
           commission_fixed, commission_total, amount_to_deliver, currency_sent, currency_delivered, recipient_name,
           recipient_phone, payment_method${extraCols})
         VALUES ($1,$2,100,300,0,0,0,100,'USD','CUP','Rcpt','+5355550100',$3${extraVals}) RETURNING id`,
        [userId, typeId, method]
      );
      remittances.push(res.rows[0].id);
      return res;
    };
    const insertOrderRow = async (client, userId = actors.customerId) => {
      const res = await client.query(
        `INSERT INTO public.orders (user_id, order_type, subtotal, total_amount, currency_id, payment_method)
         VALUES ($1,'product',10,10,$2,'zelle') RETURNING id`,
        [userId, await currencyId('USD')]
      );
      orders.push(res.rows[0].id);
      return res;
    };

    it('the remittances flow is toggled independently: it blocks remittance creation, not order creation', async () => {
      const a = await asAdmin();
      await a.query(`SELECT public.set_payment_method_enabled('zelle','remittances',false,NULL,true)`);
      const customer = await asCustomer();

      await expect(insertRemittance(customer)).rejects.toMatchObject({ code: 'P0001', message: 'payment_method_disabled' });
      await insertOrderRow(customer);

      await a.query(`SELECT public.set_payment_method_enabled('zelle','remittances',true,NULL,false)`);
      const ok = await insertRemittance(customer);
      expect(ok.rows[0].id).toBeTruthy();
    });

    it('a remittance with an unavailable or unknown method is rejected for customers; the column defaults to zelle', async () => {
      const customer = await asCustomer();
      await expect(insertRemittance(customer, { method: 'bizum' })).rejects.toMatchObject({ code: 'P0001', message: 'payment_method_disabled' });
      await expect(insertRemittance(customer, { method: 'paypal' })).rejects.toMatchObject({ code: 'P0001', message: 'payment_method_disabled' });
      const typeId = await ensureRemittanceType();
      const { rows } = await customer.query(
        `INSERT INTO public.remittances (user_id, remittance_type_id, amount_sent, exchange_rate, commission_percentage,
           commission_fixed, commission_total, amount_to_deliver, currency_sent, currency_delivered, recipient_name, recipient_phone)
         VALUES ($1,$2,100,300,0,0,0,100,'USD','CUP','Rcpt','+5355550100') RETURNING id, payment_method`,
        [actors.customerId, typeId]
      );
      remittances.push(rows[0].id);
      expect(rows[0].payment_method).toBe('zelle');
    });

    describe('guard bypass paths while the orders flow is disabled', () => {
      beforeAll(async () => {
        await restorePaymentMethods();
      });
      const disableOrders = async () => {
        const a = await asAdmin();
        await a.query(`SELECT public.set_payment_method_enabled('zelle','orders',false,NULL,true)`);
      };

      it('auth.uid() IS NULL passes the creation guard (the insert then dies on RLS, not on payment_method_disabled)', async () => {
        await disableOrders();
        const noJwt = await as(null);
        const err = await insertOrderRow(noJwt).then(() => null, (e) => e);
        expect(err).not.toBeNull();
        expect(err.message).not.toBe('payment_method_disabled');
        expect(err.message).toMatch(/row-level security/);
      });

      it('supabase_admin passes the creation guard', async (ctx) => {
        await disableOrders();
        const su = await connectAdmin();
        clients.push(su);
        try {
          await su.query('BEGIN');
          await su.query('SET LOCAL ROLE supabase_admin');
        } catch (error) {
          await su.query('ROLLBACK').catch(() => {});
          process.stderr.write(`[zelleCharacterization] supabase_admin bypass NOT verified: ${error.message}\n`);
          ctx.skip();
          return;
        }
        try {
          const res = await su.query(
            `INSERT INTO public.orders (user_id, order_type, subtotal, total_amount, currency_id, payment_method, order_number)
             VALUES ($1,'product',10,10,$2,'zelle','ZC-SUPERADM') RETURNING id`,
            [actors.customerId, await currencyId('USD')]
          );
          expect(res.rows[0].id).toBeTruthy();
        } finally {
          await su.query('ROLLBACK');
        }
      });
    });

    it('list_payment_methods_public returns the catalog (explicit columns, ordered by code) to authenticated; anon is denied', async () => {
      const customer = await asCustomer();
      const res = await customer.query(`SELECT * FROM public.list_payment_methods_public()`);
      expect(res.fields.map((f) => f.name)).toEqual(['code', 'available', 'enabled_for_orders', 'enabled_for_remittances']);
      expect(res.rows).toEqual([
        { code: 'bizum', available: false, enabled_for_orders: false, enabled_for_remittances: false },
        { code: 'zelle', available: true, enabled_for_orders: true, enabled_for_remittances: true }
      ]);
      const anon = await connectAnon();
      clients.push(anon);
      await expect(anon.query(`SELECT * FROM public.list_payment_methods_public()`)).rejects.toMatchObject({ code: '42501' });
    });

    it('select_available_zelle_account picks by priority among accounts that fit and match the transaction type', async () => {
      const capped = await seedAccount({ priority: 1, daily: 50, security: 0, name: 'zc-capped' });
      const open = await seedAccount({ priority: 2, daily: 0, security: 0, name: 'zc-open' });
      const customer = await asCustomer();
      const pick = async (type, amount) =>
        (await customer.query(`SELECT public.select_available_zelle_account($1, $2) AS id`, [type, amount])).rows[0].id;

      expect(await pick('product', 40)).toBe(capped.id);
      expect(await pick('combo', 40)).toBe(capped.id);
      expect(await pick('product', 60)).toBe(open.id);

      await admin.query(`UPDATE public.zelle_accounts SET for_remittances = false WHERE id = $1`, [capped.id]);
      expect(await pick('remittance', 40)).toBe(open.id);

      await admin.query(`UPDATE public.zelle_accounts SET is_active = false WHERE id = ANY($1)`, [[capped.id, open.id]]);
      expect(await pick('product', 40)).toBeNull();
    });

    it('remittances.delivery_cost is NOT NULL (default 0): usage = amount_sent when omitted, NULL is rejected', async () => {
      const acc = await seedAccount();
      const typeId = await ensureRemittanceType();
      const res = await admin.query(
        `INSERT INTO public.remittances (user_id, remittance_type_id, amount_sent, exchange_rate, commission_percentage,
           commission_fixed, commission_total, amount_to_deliver, currency_sent, currency_delivered, recipient_name,
           recipient_phone, zelle_account_id)
         VALUES ($1,$2,42,300,0,0,0,42,'USD','CUP','Rcpt','+5355550100',$3) RETURNING id, delivery_cost::float AS dc`,
        [actors.customerId, typeId, acc.id]
      );
      remittances.push(res.rows[0].id);
      expect(res.rows[0].dc).toBe(0);
      const u = await admin.query(`SELECT daily_usage::float AS d FROM public.zelle_account_usage($1)`, [acc.id]);
      expect(u.rows[0].d).toBe(42);
      await expect(
        admin.query(`UPDATE public.remittances SET delivery_cost = NULL WHERE id = $1`, [res.rows[0].id])
      ).rejects.toMatchObject({ code: '23502' });
    });

    it.each([
      ['orders', ['SELECT', 'INSERT', 'UPDATE', 'DELETE']],
      ['remittances', ['SELECT', 'INSERT', 'UPDATE', 'DELETE']]
    ])('%s: table privileges pinned (authenticated DML only; anon and service_role nothing; no TRUNCATE/REFERENCES/TRIGGER)', async (table, granted) => {
      const priv = async (role, p) =>
        (await admin.query(`SELECT has_table_privilege($1, $2, $3) AS ok`, [role, `public.${table}`, p])).rows[0].ok;
      for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
        expect(await priv('anon', p)).toBe(false);
        // service_role has NO table privilege on these tables in production (its guard bypass is unreachable by direct DML).
        expect(await priv('service_role', p)).toBe(false);
        expect(await priv('authenticated', p)).toBe(granted.includes(p));
      }
    });

    it('the fixture seed for payment_methods equals what migration 20261014170000 inserts', async () => {
      const tuples = (sql) => {
        const out = {};
        for (const m of sql.matchAll(/\(\s*'(zelle|bizum)'\s*,\s*(true|false)\s*,\s*(true|false)\s*,\s*(true|false)\s*\)/g)) {
          out[m[1]] = [m[2] === 'true', m[3] === 'true', m[4] === 'true'];
        }
        return out;
      };
      const root = new URL('../../../', import.meta.url);
      const migration = readFileSync(new URL('supabase/migrations/20261014170000_payment_methods_toggle.sql', root), 'utf8');
      const seed = readFileSync(new URL('scripts/test-db-seed.sql', root), 'utf8');
      expect(tuples(migration)).toEqual(ZELLE_SEED);
      expect(tuples(seed)).toEqual(ZELLE_SEED);
    });
  });
});
