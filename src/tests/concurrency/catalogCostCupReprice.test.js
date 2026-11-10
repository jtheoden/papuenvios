/**
 * Real PostgreSQL contract for the CUP-cost catalog repricing migration (products.cost_cup, backfill,
 * preview/apply RPCs, history). Uses the guarded local pg harness, or EXRATE_TEST_PG_BIN=/path/to/postgresql/bin
 * for an isolated, disposable standalone backend (no sockets, no remote connections). Every scenario runs in a
 * transaction that is rolled back, inside a throw-away schema with stubs for auth/roles.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { connectAdmin, dbSuiteSkipReason } from './db';

const pgBin = process.env.EXRATE_TEST_PG_BIN;
const skipReason = pgBin ? null : await dbSuiteSkipReason();
const describeDb = skipReason ? describe.skip : describe;
const S = 'cup_reprice_test';
const read = (file) => readFileSync(resolve(process.cwd(), file), 'utf8')
  .replaceAll('public', S).replaceAll('auth.uid()', `${S}.test_uid()`).replace(/^\s*(BEGIN|COMMIT);\s*$/gm, '');
const up = () => read('supabase/migrations/20261110100000_catalog_cost_cup_reprice.sql');
const down = () => read('supabase/rollbacks/20261110100000_catalog_cost_cup_reprice_down.sql');

const assertSql = (condition, message) => `DO $assert$ BEGIN
  IF NOT COALESCE((${condition}), false) THEN RAISE EXCEPTION '${message.replaceAll('%', '%%')}'; END IF;
END $assert$;`;
// Calls an expression returning jsonb into `r` and checks `cond` (which may reference r).
const assertResult = (call, cond, message) => `DO $res$ DECLARE r jsonb; BEGIN
  r := ${call};
  IF NOT COALESCE((${cond}), false) THEN RAISE EXCEPTION '${message.replaceAll('%', '%%')}: %', r; END IF;
END $res$;`;
const expectError = (call, fragment, stmt = `PERFORM ${call};`) => `DO $err$ DECLARE ok boolean := false; BEGIN
  BEGIN ${stmt}
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%${fragment}%' THEN ok := true; ELSE RAISE; END IF;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'expected error ${fragment}'; END IF;
END $err$;`;

const expectStatement = (sql, fragment) => expectError('', fragment, `EXECUTE $q$${sql}$q$;`);

const u = (n) => `'00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}'::uuid`;
const USD = u(1); const CUP = u(2); const EUR = u(3);
const [P1, P2, P3, P4, P5, P6] = [11, 12, 13, 14, 15, 16].map(u);
const [C1, C2, C3] = [21, 22, 23].map(u);
const t = (name) => `${S}.${name}`;
const price = (table, id, col = 'base_price') => `(SELECT ${col} FROM ${t(table)} WHERE id = ${id})`;
const count = (table, where = 'true') => `(SELECT count(*) FROM ${t(table)} WHERE ${where})`;
const setRate = (rate) => `UPDATE ${t('exchange_rates')} SET rate = ${rate} WHERE from_currency_id = ${USD} AND to_currency_id = ${CUP};`;
const asUser = (superAdmin) => `SELECT set_config('test.super', '${superAdmin ? 'on' : 'off'}', true);`;

const setup = ({ legacy = true } = {}) => `
  CREATE SCHEMA ${S};
  DO $roles$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
  END $roles$;
  GRANT USAGE ON SCHEMA ${S} TO authenticated, anon;
  CREATE FUNCTION ${S}.test_uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;
  CREATE FUNCTION ${S}.is_super_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT COALESCE(current_setting('test.super', true), 'off') = 'on' $$;
  CREATE FUNCTION ${S}.is_admin_user() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT COALESCE(current_setting('test.admin', true), 'off') = 'on' OR ${S}.is_super_admin() $$;
  CREATE TABLE ${t('currencies')} (id uuid PRIMARY KEY, code text NOT NULL UNIQUE);
  CREATE TABLE ${t('exchange_rates')} (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    from_currency_id uuid NOT NULL, to_currency_id uuid NOT NULL,
    rate numeric(20,6) NOT NULL, market_rate numeric NOT NULL, rate_type text DEFAULT 'general',
    is_active boolean DEFAULT true, effective_date date NOT NULL DEFAULT CURRENT_DATE
  );
  CREATE TABLE ${t('products')} (
    id uuid PRIMARY KEY, name_es text NOT NULL,
    base_price numeric(15,2) NOT NULL CHECK (base_price >= 0),
    base_currency_id uuid NOT NULL,
    profit_margin numeric(5,2) DEFAULT 40.00,
    final_price numeric(15,2) GENERATED ALWAYS AS (round(base_price * (1 + profit_margin / 100), 2)) STORED,
    updated_at timestamptz DEFAULT now()
  );
  CREATE TABLE ${t('combo_products')} (
    id uuid PRIMARY KEY, name_es text NOT NULL,
    base_total_price numeric(15,2) NOT NULL CHECK (base_total_price >= 0),
    profit_margin numeric(5,2) DEFAULT 40.00,
    final_price numeric(15,2) GENERATED ALWAYS AS (round(base_total_price * (1 + profit_margin / 100), 2)) STORED,
    updated_at timestamptz DEFAULT now()
  );
  CREATE TABLE ${t('combo_items')} (combo_id uuid NOT NULL, product_id uuid NOT NULL, quantity integer NOT NULL DEFAULT 1);
  CREATE TABLE ${t('orders')} (id uuid PRIMARY KEY, total_amount numeric(15,2) NOT NULL);
  CREATE TABLE ${t('order_items')} (id uuid PRIMARY KEY, order_id uuid NOT NULL, product_id uuid NOT NULL, unit_price numeric(15,2) NOT NULL);
  ${legacy ? `CREATE FUNCTION ${S}.admin_list_product_costs(p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_ids uuid[] DEFAULT NULL)
    RETURNS TABLE (id uuid, base_price numeric, profit_margin numeric) LANGUAGE sql STABLE AS $$ SELECT NULL::uuid, NULL::numeric, NULL::numeric WHERE false $$;
  REVOKE ALL ON FUNCTION ${S}.admin_list_product_costs(integer, integer, uuid[]) FROM PUBLIC;` : ''}
  ${asUser(true)}
`;

// rate = owner rate (market_rate is deliberately different); the inverse CUP->USD row is active too.
const seed = ({ rate = 900, withRate = true } = {}) => `
  INSERT INTO ${t('currencies')} VALUES (${USD}, 'USD'), (${CUP}, 'CUP'), (${EUR}, 'EUR');
  ${withRate ? `INSERT INTO ${t('exchange_rates')} (from_currency_id, to_currency_id, rate, market_rate)
    VALUES (${USD}, ${CUP}, ${rate}, 1100), (${CUP}, ${USD}, 0.001111, 0.0009);` : ''}
  INSERT INTO ${t('products')} (id, name_es, base_price, base_currency_id, profit_margin) VALUES
    (${P1}, 'P1', 3.28, ${USD}, 45), (${P2}, 'P2', 10.00, ${USD}, 40), (${P3}, 'P3 eur', 7.77, ${EUR}, 40),
    (${P4}, 'P4', 5.55, ${USD}, 40), (${P5}, 'P5', 0.01, ${USD}, 40), (${P6}, 'P6', 123.45, ${USD}, 40);
  INSERT INTO ${t('combo_products')} (id, name_es, base_total_price, profit_margin) VALUES
    (${C1}, 'C1', 77.36, 40), (${C2}, 'C2', 8.83, 40), (${C3}, 'C3 zero', 0, 40);
  INSERT INTO ${t('combo_items')} VALUES (${C1}, ${P1}, 2), (${C1}, ${P2}, 1), (${C2}, ${P1}, 1), (${C2}, ${P4}, 1);
  INSERT INTO ${t('orders')} VALUES (${u(31)}, 99.99);
  INSERT INTO ${t('order_items')} VALUES (${u(32)}, ${u(31)}, ${P1}, 4.76);
`;
// a direct base_price edit would NULL cost_cup (sync trigger); fixtures bypass it with the RPC flag
const rawBase = (id, value) => `SELECT set_config('app.catalog_reprice', 'on', true); UPDATE ${t('products')} SET base_price = ${value} WHERE id = ${id}; SELECT set_config('app.catalog_reprice', 'off', true);`;
const nullCost = (id) => `UPDATE ${t('products')} SET cost_cup = NULL WHERE id = ${id};`;
const apply = (confirm = false, expected = 'NULL') => `${t('apply_catalog_reprice')}(${confirm}, ${expected})`;
const preview = (rate = 'NULL') => `${t('preview_catalog_reprice')}(${rate})`;
const snapshot = `(SELECT string_agg(id::text || ':' || base_price || ':' || final_price, ',' ORDER BY id) FROM ${t('products')})
  || '|' || (SELECT string_agg(id::text || ':' || base_total_price || ':' || final_price, ',' ORDER BY id) FROM ${t('combo_products')})`;

describeDb('catalog cost_cup repricing against real PostgreSQL', () => {
  let client;
  let dataDir;
  const executeStandalone = (sql, database = 'papuenvios_test_cup') => {
    const inputFile = join(dataDir, 'scenario.sql');
    writeFileSync(inputFile, `${sql.split('\n').filter((line) => line.trim()).join('\n')}\n\n`);
    const fd = openSync(inputFile, 'r');
    try {
      return spawnSync(join(pgBin, 'postgres'), ['--single', '-j', '-D', dataDir, database], {
        stdio: [fd, 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 30000,
        env: { ...process.env, LC_ALL: 'C' }
      });
    } finally { closeSync(fd); }
  };
  const standalone = (sql, database) => {
    const result = executeStandalone(sql, database);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.stderr).not.toMatch(/(?:ERROR|FATAL|PANIC):/);
  };
  // Returns the stderr of a block that is expected to fail (standalone backend only).
  const executeBlock = (sql) => {
    if (!pgBin) return 'admin_list_product_costs';
    const result = executeStandalone(`BEGIN;\n${sql}\nROLLBACK;`);
    expect(result.stderr).toMatch(/ERROR:/);
    return result.stderr;
  };
  const run = async (sql) => {
    const transaction = `BEGIN;\n${sql}\nROLLBACK;`;
    if (pgBin) standalone(transaction);
    else {
      try { await client.query(transaction); }
      finally { await client.query('ROLLBACK'); }
    }
  };

  beforeAll(async () => {
    if (!pgBin) { client = await connectAdmin(); return; }
    dataDir = mkdtempSync(join(tmpdir(), 'papuenvios-cup-sql-'));
    const init = spawnSync(join(pgBin, 'initdb'), ['-D', dataDir, '-U', 'postgres', '-A', 'trust', '--no-locale'], { encoding: 'utf8' });
    expect(init.status, init.stderr).toBe(0);
    standalone('CREATE DATABASE papuenvios_test_cup;', 'postgres');
  });
  afterAll(async () => {
    if (client) await client.end();
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  it('backfill fills only NULL costs of USD products, keeps existing ones, skips non-USD and is a no-op when rerun', async () => {
    await run(`${setup()} ${seed()} ${up()}
      ${assertSql(`${price('products', P1, 'cost_cup')} = 2952.00 AND ${price('products', P2, 'cost_cup')} = 9000.00 AND ${price('products', P6, 'cost_cup')} = 111105.00`, 'USD products get round(base*rate,2)')}
      ${assertSql(`${price('products', P3, 'cost_cup')} IS NULL`, 'non-USD product must not be touched')}
      ${assertSql(`${count('catalog_reprice_runs', "status = 'backfill' AND rate = 900 AND products_updated = 5")} = 1`, 'one backfill run records the rate')}
      UPDATE ${t('products')} SET cost_cup = 2950 WHERE id = ${P1};
      ${nullCost(P2)}
      ${up()}
      ${assertSql(`${price('products', P1, 'cost_cup')} = 2950.00`, 'existing cost_cup must not be overwritten')}
      ${assertSql(`${price('products', P2, 'cost_cup')} = 9000.00`, 'NULL cost is refilled')}
      ${assertSql(`${count('catalog_reprice_runs')} = 2`, 'second backfill filled one product and records a run')}
      ${up()}
      ${assertSql(`${count('catalog_reprice_runs')} = 2`, 'rerun with nothing to fill must not add runs')}
      ${assertSql(`${count('catalog_price_history')} = 0`, 'backfill never writes price history')}
    `);
  });

  it('cost_cup CHECK rejects 0, negatives and NaN; the backfill ignores products with base_price 0 without failing', async () => {
    await run(`${setup()} ${seed({ withRate: false })} ${up()}
      ${['0', '-1', "'NaN'::numeric"].map((v) => expectStatement(`UPDATE ${t('products')} SET cost_cup = ${v} WHERE id = ${P1}`, 'products_cost_cup_positive_chk')).join('\n')}
      ${assertSql(`${price('products', P1, 'cost_cup')} IS NULL`, 'rejected values leave cost_cup unchanged')}
      ${assertSql(`(SELECT count(*) FROM pg_constraint WHERE conrelid = '${t('products')}'::regclass AND conname = 'products_cost_cup_positive_chk') = 1`, 'named CHECK exists once')}
    `);
    await run(`${setup()} ${seed()}
      INSERT INTO ${t('products')} (id, name_es, base_price, base_currency_id) VALUES (${u(41)}, 'free', 0, ${USD});
      ${up()} ${up()}
      ${assertSql(`${price('products', u(41), 'cost_cup')} IS NULL AND ${price('products', P1, 'cost_cup')} = 2952`, 'base_price 0 is not backfilled, others are')}
      ${assertSql(`(SELECT count(*) FROM pg_constraint WHERE conrelid = '${t('products')}'::regclass AND conname = 'products_cost_cup_positive_chk') = 1`, 'CHECK stays single after a rerun')}
    `);
  });

  it('backfill is skipped without failing when there is no active USD->CUP pair', async () => {
    await run(`${setup()} ${seed({ withRate: false })} ${up()}
      ${assertSql(`(SELECT count(*) FROM ${t('products')} WHERE cost_cup IS NOT NULL) = 0 AND ${count('catalog_reprice_runs')} = 0`, 'no pair: nothing backfilled')}
    `);
  });

  it('the active rate prefers rate_type general, then the latest effective_date; several active rows are not an error', async () => {
    const extra = (rate, type, days) => `INSERT INTO ${t('exchange_rates')} (from_currency_id, to_currency_id, rate, market_rate, rate_type, effective_date)
      VALUES (${USD}, ${CUP}, ${rate}, ${rate}, ${type}, CURRENT_DATE + ${days});`;
    await run(`${setup()} ${seed()} ${extra(950, "'special'", 1)} ${up()}
      ${assertSql(`${price('products', P1, 'cost_cup')} = 2952.00`, 'backfill uses the general row (900) even if another active row is newer')}
      ${assertResult(preview(), `(r->>'rate')::numeric = 900`, 'preview uses the general row')}
    `);
    await run(`${setup()} ${seed({ withRate: false })} ${extra(900, "'special'", 0)} ${extra(950, "'other'", 1)} ${up()}
      ${assertSql(`${price('products', P1, 'cost_cup')} = round(3.28 * 950, 2)`, 'without a general row the latest effective_date wins')}
    `);
  });

  it('round trip: apply with the backfill rate changes no price, writes no history and combos keep their total', async () => {
    await run(`${setup()} ${seed({ rate: 912.345 })} ${up()}
      CREATE TEMP TABLE before AS SELECT ${snapshot} AS s;
      ${assertResult(apply(), `(r->>'products_updated')::int = 0 AND (r->>'combos_updated')::int = 0 AND (r->>'pct_change')::numeric = 0`, 'apply with the backfill rate must be a no-op')}
      ${assertSql(`${snapshot} = (SELECT s FROM before)`, 'base and final prices of products and combos unchanged')}
      ${assertSql(`${count('catalog_price_history')} = 0`, 'no history rows for unchanged items')}
    `);
  });

  it('preview writes nothing and reports the effect; it uses rate, not market_rate nor the inverse row', async () => {
    await run(`${setup()} ${seed()} ${up()}
      ${nullCost(P4)}
      UPDATE ${t('products')} SET cost_cup = 2950 WHERE id = ${P1};
      CREATE TEMP TABLE before AS SELECT ${snapshot} AS s, ${count('catalog_reprice_runs')} AS runs;
      ${assertResult(preview(850), `(r->>'rate')::numeric = 850 AND (r->>'previous_rate')::numeric = 900 AND (r->>'products_affected')::int = 3
        AND (r->>'combos_affected')::int = 2 AND jsonb_array_length(r->'skipped_products') = 0 AND (r->>'requires_extra_confirmation')::boolean = false
        AND jsonb_array_length(r->'sample') = 5 AND (r->>'max_abs_pct_change')::numeric > 0
        AND (r->>'rate_pct_change')::numeric = (r->>'pct_change')::numeric AND round((r->>'rate_pct_change')::numeric, 4) = -5.5556
        AND (r->>'combos_avg_pct_change')::numeric BETWEEN 5.8 AND 5.95 AND (r->>'combos_max_abs_pct_change')::numeric BETWEEN 5.8 AND 5.95`, 'preview content')}
      ${assertResult(preview(), `(r->>'rate')::numeric = 900`, 'default preview rate is exchange_rates.rate of USD->CUP')}
      ${assertResult(preview(1100), `(r->>'requires_extra_confirmation')::boolean`, 'preview flags a >10 % move')}
      ${assertSql(`${snapshot} = (SELECT s FROM before) AND ${count('catalog_reprice_runs')} = (SELECT runs FROM before) AND ${count('catalog_price_history')} = 0`, 'preview must not write')}
    `);
  });

  it('apply reprices products with cost: 2950 CUP at 45 % -> final 4.76 / 5.03 / 4.51 at 900 / 850 / 950 (cent-rounded base)', async () => {
    const case_ = (rate, base, final) => `
      ${rawBase(P1, 9)}
      ${setRate(rate)}
      ${assertResult(apply(true), `(r->>'products_updated')::int >= 1`, `apply at ${rate}`)}
      ${assertSql(`${price('products', P1)} = ${base} AND ${price('products', P1, 'final_price')} = ${final}`, `P1 at ${rate}`)}`;
    await run(`${setup()} ${seed()} ${up()}
      UPDATE ${t('products')} SET cost_cup = 2950 WHERE id = ${P1};
      ${case_(900, '3.28', '4.76')}
      ${case_(850, '3.47', '5.03')}
      ${case_(950, '3.11', '4.51')}
    `);
  });

  it('keeps products without cost and non-USD intact; scales every combo by the exact rate ratio and records exactly what was applied', async () => {
    await run(`${setup()} ${seed()} ${up()}
      ${nullCost(P4)}
      UPDATE ${t('products')} SET cost_cup = 1000 WHERE id = ${P3};
      ${setRate(850)}
      ${assertResult(apply(), `(r->>'products_updated')::int = 3 AND (r->>'combos_updated')::int = 2 AND jsonb_array_length(r->'skipped_products') = 0`, 'apply result')}
      ${assertSql(`${price('products', P4)} = 5.55`, 'product without cost_cup keeps its price')}
      ${assertSql(`${price('products', P3)} = 7.77`, 'non-USD product keeps its price even with a cost')}
      ${assertSql(`${price('products', P1)} = 3.47 AND ${price('products', P2)} = 10.59`, 'USD products with cost are repriced')}
      ${assertSql(`${price('combo_products', C1, 'base_total_price')} = round(77.36 * 900 / 850, 2)`, 'combo = round(total * previous / new, 2)')}
      ${assertSql(`${price('combo_products', C2, 'base_total_price')} = round(8.83 * 900 / 850, 2)`, 'a manual total that differs from the component sum is kept proportionally')}
      ${assertSql(`${price('combo_products', C3, 'base_total_price')} = 0`, 'a zero total is skipped')}
      ${assertSql(`${count('catalog_price_history')} = 5 AND ${count('catalog_price_history', "entity_type = 'combo'")} = 2`, 'history: 3 products + 2 combos')}
      ${assertSql(`NOT EXISTS (SELECT 1 FROM ${t('catalog_price_history')} h WHERE h.entity_type = 'product' AND h.new_base IS DISTINCT FROM (SELECT base_price FROM ${t('products')} WHERE id = h.entity_id))
        AND NOT EXISTS (SELECT 1 FROM ${t('catalog_price_history')} h WHERE h.entity_type = 'combo' AND h.new_base IS DISTINCT FROM (SELECT base_total_price FROM ${t('combo_products')} WHERE id = h.entity_id))`, 'history new_base equals the applied price')}
      ${assertSql(`(SELECT products_updated = 3 AND combos_updated = 2 AND previous_rate = 900 AND rate = 850 AND status = 'applied' FROM ${t('catalog_reprice_runs')} ORDER BY applied_at DESC LIMIT 1)`, 'run recorded')}
      ${assertSql(`${price('order_items', u(32), 'unit_price')} = 4.76 AND ${price('orders', u(31), 'total_amount')} = 99.99`, 'existing orders are frozen')}
    `);
  });

  it('without a baseline run combos are not touched and the first apply needs confirmation', async () => {
    await run(`${setup()} ${seed({ withRate: false })} ${up()}
      INSERT INTO ${t('exchange_rates')} (from_currency_id, to_currency_id, rate, market_rate) VALUES (${USD}, ${CUP}, 900, 900);
      UPDATE ${t('products')} SET cost_cup = 2950 WHERE id = ${P1};
      ${assertResult(preview(), `(r->>'requires_extra_confirmation')::boolean AND r->'previous_rate' = 'null'::jsonb AND r->'rate_pct_change' = 'null'::jsonb AND (r->>'combos_affected')::int = 0`, 'preview without baseline')}
      ${expectError(apply(), 'large_rate_change_requires_confirmation')}
      ${assertResult(apply(true), `(r->>'combos_updated')::int = 0`, 'combos untouched without baseline')}
      ${assertSql(`${price('combo_products', C1, 'base_total_price')} = 77.36`, 'combo total unchanged')}
    `);
  });

  it('the sync trigger clears cost_cup on a direct base_price edit and keeps it when both change; apply does not clear it', async () => {
    await run(`${setup()} ${seed()} ${up()}
      UPDATE ${t('products')} SET base_price = 4.00 WHERE id = ${P2};
      ${assertSql(`${price('products', P2, 'cost_cup')} IS NULL`, 'direct base_price edit voids cost_cup')}
      ${assertResult(apply(), `(r->>'products_updated')::int = 0`, 'apply at the same rate no longer overwrites the manual price')}
      ${assertSql(`${price('products', P2)} = 4.00`, 'manual price kept')}
      UPDATE ${t('products')} SET base_price = 4.50, cost_cup = 4140 WHERE id = ${P2};
      ${assertSql(`${price('products', P2, 'cost_cup')} = 4140`, 'changing both keeps the new cost_cup')}
      UPDATE ${t('products')} SET name_es = 'renamed' WHERE id = ${P1};
      ${assertSql(`${price('products', P1, 'cost_cup')} = 2952`, 'unrelated update keeps cost_cup')}
      ${assertResult(apply(), `(r->>'products_updated')::int = 1`, 'apply fixes base_price from the cost')}
      ${assertSql(`${price('products', P2)} = 4.60 AND ${price('products', P2, 'cost_cup')} = 4140`, 'apply rewrites base_price and keeps cost_cup')}
      ${assertSql(`(SELECT count(*) FROM pg_trigger WHERE tgrelid = '${t('products')}'::regclass AND NOT tgisinternal) = 1`, 'one trigger')}
    `);
  });

  it('skips products whose price would round to zero and reports them', async () => {
    await run(`${setup()} ${seed()} ${up()}
      ${setRate(3000)}
      ${assertResult(preview(), `jsonb_array_length(r->'skipped_products') = 1 AND r->'skipped_products'->0->>'reason' = 'rounds_to_zero' AND r->'skipped_products'->0->>'id' = '00000000-0000-0000-0000-000000000015'`, 'preview reports P5 (cost 9 CUP)')}
      ${assertResult(apply(true), `jsonb_array_length(r->'skipped_products') = 1 AND r->'skipped_products'->0->>'reason' = 'rounds_to_zero'`, 'apply reports P5')}
      ${assertSql(`${price('products', P5)} = 0.01`, 'price kept instead of becoming 0')}
      ${assertSql(`(SELECT jsonb_array_length(skipped_products) = 1 FROM ${t('catalog_reprice_runs')} ORDER BY applied_at DESC LIMIT 1)`, 'run stores the skipped products')}
    `);
  });

  it('p_expected_rate rejects a rate that moved (tolerance 1e-6) and there is a single apply overload', async () => {
    await run(`${setup()} ${seed()} ${up()}
      ${assertResult(apply(false, 900), `(r->>'rate')::numeric = 900`, 'matching expected rate')}
      ${assertResult(apply(false, 900.0000005), `(r->>'rate')::numeric = 900`, 'within tolerance')}
      ${expectError(apply(false, 901), 'rate_changed')}
      ${assertSql(`(SELECT count(*) FROM pg_proc WHERE pronamespace = '${S}'::regnamespace AND proname = 'apply_catalog_reprice') = 1`, 'single overload')}
      ${assertSql(`pg_get_function_identity_arguments('${t('apply_catalog_reprice')}(boolean, numeric)'::regprocedure) = 'p_confirm_large boolean, p_expected_rate numeric'`, 'signature')}
    `);
  });

  it('refuses to run without the phase0b admin_list_product_costs function and notifies PostgREST', async () => {
    const stderr = executeBlock(`${setup({ legacy: false })} ${seed()} ${up()}`);
    expect(stderr).toMatch(/admin_list_product_costs/);
    expect(readFileSync(resolve(process.cwd(), 'supabase/migrations/20261110100000_catalog_cost_cup_reprice.sql'), 'utf8')).toMatch(/NOTIFY pgrst, 'reload schema'/);
  });

  it('is idempotent: same rate twice changes nothing and adds no history', async () => {
    await run(`${setup()} ${seed()} ${up()}
      ${setRate(850)}
      SELECT ${apply()};
      CREATE TEMP TABLE after_first AS SELECT ${snapshot} AS s, ${count('catalog_price_history')} AS h;
      ${assertResult(apply(), `(r->>'products_updated')::int = 0 AND (r->>'combos_updated')::int = 0`, 'second apply is a no-op')}
      ${assertSql(`${snapshot} = (SELECT s FROM after_first) AND ${count('catalog_price_history')} = (SELECT h FROM after_first)`, 'no new history')}
      ${assertSql(`(SELECT status FROM ${t('catalog_reprice_runs')} ORDER BY applied_at DESC LIMIT 1) = 'noop'`, 'second run is recorded as noop')}
    `);
  });

  it('a >10 % move needs confirmation (nothing changes without it), exactly 10 % does not; no history means always confirm', async () => {
    await run(`${setup()} ${seed()} ${up()}
      CREATE TEMP TABLE before AS SELECT ${snapshot} AS s, ${count('catalog_reprice_runs')} AS runs;
      ${setRate(1100)}
      ${expectError(apply(), 'large_rate_change_requires_confirmation')}
      ${expectError(apply('false'), 'large_rate_change_requires_confirmation')}
      ${assertSql(`${snapshot} = (SELECT s FROM before) AND ${count('catalog_reprice_runs')} = (SELECT runs FROM before) AND ${count('catalog_price_history')} = 0`, 'rejected apply changes nothing')}
      ${assertResult(apply(true), `(r->>'pct_change')::numeric > 10 AND (r->>'products_updated')::int > 0`, 'confirmed apply works')}
      ${setRate(1210)}
      ${assertResult(apply(), `(r->>'pct_change')::numeric = 10`, 'exactly 10 % needs no confirmation')}
      ${setRate(1331.01)}
      ${expectError(apply(), 'large_rate_change_requires_confirmation')}
    `);
    await run(`${setup()} ${seed({ withRate: false })} ${up()}
      INSERT INTO ${t('exchange_rates')} (from_currency_id, to_currency_id, rate, market_rate) VALUES (${USD}, ${CUP}, 900, 900);
      UPDATE ${t('products')} SET cost_cup = 2950, base_price = 9 WHERE id = ${P1};
      ${expectError(apply(), 'large_rate_change_requires_confirmation')}
      ${assertResult(apply(true), `r->'previous_rate' = 'null'::jsonb AND (r->>'products_updated')::int = 1`, 'first run without history after confirmation')}
    `);
  });

  it('rejects non super admin (preview and apply) and grants and RLS shape lock the RPCs and audit tables', async () => {
    await run(`${setup()} ${seed()} ${up()}
      ${asUser(false)}
      ${expectError(preview(), 'forbidden')}
      ${expectError(apply(true), 'forbidden')}
      ${assertSql(`${count('catalog_reprice_runs')} = 1 AND ${count('catalog_price_history')} = 0`, 'nothing written by a non super admin')}
      ${assertSql(`NOT EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.pronamespace = '${S}'::regnamespace
        AND p.proname IN ('apply_catalog_reprice', 'preview_catalog_reprice', 'catalog_reprice_plan', 'catalog_reprice_rate') AND a.grantee = 0)`, 'no PUBLIC execute')}
      ${assertSql(`has_function_privilege('authenticated', '${t('apply_catalog_reprice')}(boolean, numeric)', 'EXECUTE')
        AND has_function_privilege('authenticated', '${t('preview_catalog_reprice')}(numeric)', 'EXECUTE')
        AND NOT has_function_privilege('anon', '${t('apply_catalog_reprice')}(boolean, numeric)', 'EXECUTE')
        AND NOT has_function_privilege('anon', '${t('preview_catalog_reprice')}(numeric)', 'EXECUTE')
        AND NOT has_function_privilege('authenticated', '${t('catalog_reprice_plan')}(numeric, numeric)', 'EXECUTE')
        AND NOT has_function_privilege('authenticated', '${t('catalog_reprice_rate')}()', 'EXECUTE')`, 'grants')}
      ${assertSql(`(SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('${t('catalog_reprice_runs')}'::regclass, '${t('catalog_price_history')}'::regclass))
        AND (SELECT count(*) FROM pg_policies WHERE schemaname = '${S}' AND tablename LIKE 'catalog_%' AND cmd = 'SELECT') = 2
        AND (SELECT count(*) FROM pg_policies WHERE schemaname = '${S}' AND tablename LIKE 'catalog_%') = 2`, 'RLS on, one SELECT-only policy per table')}
      ${assertSql(`has_table_privilege('authenticated', '${t('catalog_reprice_runs')}', 'SELECT')
        AND NOT has_table_privilege('authenticated', '${t('catalog_reprice_runs')}', 'INSERT')
        AND NOT has_table_privilege('authenticated', '${t('catalog_price_history')}', 'UPDATE')
        AND NOT has_table_privilege('anon', '${t('catalog_price_history')}', 'SELECT')`, 'no direct writes, no anon')}
    `);
  });

  it('rejects non positive, NaN, infinite or missing rates', async () => {
    await run(`${setup()} ${seed()} ${up()}
      ${expectError(preview(0), 'invalid_rate')}
      ${expectError(preview(-5), 'invalid_rate')}
      ${expectError(preview("'NaN'::numeric"), 'invalid_rate')}
      ${expectError(preview("'Infinity'::numeric"), 'invalid_rate')}
      ${assertResult(preview('NULL'), `(r->>'rate')::numeric = 900`, 'NULL means the active rate')}
      ${setRate(0)}
      ${expectError(apply(true), 'invalid_rate')}
      DELETE FROM ${t('exchange_rates')} WHERE to_currency_id = ${CUP};
      ${expectError(apply(true), 'usd_cup_pair_not_found')}
      ${expectError(preview(), 'usd_cup_pair_not_found')}
      ${assertSql(`${count('catalog_price_history')} = 0`, 'rejected applies write nothing')}
    `);
  });

  it('rollback removes functions, tables and the column without touching prices', async () => {
    await run(`${setup()} ${seed()} ${up()}
      ${setRate(850)}
      SELECT ${apply()};
      CREATE TEMP TABLE before AS SELECT ${snapshot} AS s;
      ${down()}
      ${assertSql(`${snapshot} = (SELECT s FROM before)`, 'rollback keeps prices')}
      ${assertSql(`(SELECT count(*) FROM pg_proc WHERE pronamespace = '${S}'::regnamespace AND proname LIKE '%catalog_reprice%') = 0`, 'functions gone')}
      ${assertSql(`to_regclass('${t('catalog_reprice_runs')}') IS NULL AND to_regclass('${t('catalog_price_history')}') IS NULL`, 'tables gone')}
      ${assertSql(`NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = '${S}' AND table_name = 'products' AND column_name = 'cost_cup')`, 'column gone')}
      ${assertSql(`(SELECT count(*) FROM pg_trigger WHERE tgrelid = '${t('products')}'::regclass AND NOT tgisinternal) = 0`, 'sync trigger gone')}
      ${assertSql(`(SELECT count(*) FROM ${t('products_cost_cup_backup_20261110')}) = 5 AND (SELECT cost_cup FROM ${t('products_cost_cup_backup_20261110')} WHERE id = ${P1}) = 2952`, 'cost_cup values saved before the column is dropped')}
      ${assertSql(`NOT has_table_privilege('anon', '${t('products_cost_cup_backup_20261110')}', 'SELECT') AND NOT has_table_privilege('authenticated', '${t('products_cost_cup_backup_20261110')}', 'SELECT')`, 'backup is not readable by API roles')}
    `);
  });

  it('admin_list_product_costs returns cost_cup to admins, rejects others (42501) and keeps its grants', async () => {
    const fn = `${S}.admin_list_product_costs`;
    const sig = `${fn}(integer, integer, uuid[])`;
    await run(`${setup()} ${seed()} ${up()}
      UPDATE ${t('products')} SET cost_cup = 2950 WHERE id = ${P1};
      SELECT set_config('test.uid', '00000000-0000-0000-0000-0000000000aa', true);
      ${asUser(false)}
      SELECT set_config('test.admin', 'on', true);
      ${assertResult(`(SELECT to_jsonb(x) FROM ${fn}(10, 0, ARRAY[${P1}]) x)`, `(r->>'cost_cup')::numeric = 2950 AND (r->>'base_price')::numeric = 3.28 AND (r->>'profit_margin')::numeric = 45`, 'admin reads cost_cup')}
      ${assertResult(`(SELECT jsonb_agg(x.cost_cup ORDER BY x.id) FROM ${fn}(10, 0, ARRAY[${P1}, ${P3}]) x)`, 'jsonb_array_length(r) = 2 AND r->>1 IS NULL', 'cost_cup is NULL where unset, ordered by id')}
      ${assertSql(`pg_get_function_result('${sig}'::regprocedure) = 'TABLE(id uuid, base_price numeric, profit_margin numeric, cost_cup numeric)'`, 'four-column signature')}
      ${assertSql(`(SELECT count(*) FROM pg_proc WHERE pronamespace = '${S}'::regnamespace AND proname = 'admin_list_product_costs') = 1`, 'no stale overload')}
      ${assertSql(`(SELECT prosecdef AND provolatile = 's' FROM pg_proc WHERE oid = '${sig}'::regprocedure)
        AND has_function_privilege('authenticated', '${sig}', 'EXECUTE') AND NOT has_function_privilege('anon', '${sig}', 'EXECUTE')
        AND NOT EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid = '${sig}'::regprocedure AND a.grantee = 0)`, 'definer, stable, authenticated only')}
      SELECT set_config('test.admin', 'off', true);
      ${expectError(`${fn}(10, 0, NULL)`, 'insufficient_privilege')}
      SELECT set_config('test.uid', '', true);
      SELECT set_config('test.admin', 'on', true);
      ${expectError(`${fn}(10, 0, NULL)`, 'insufficient_privilege')}
    `);
  });

  it('rollback restores the three-column admin_list_product_costs with its grants', async () => {
    const fn = `${S}.admin_list_product_costs`;
    const sig = `${fn}(integer, integer, uuid[])`;
    await run(`${setup()} ${seed()} ${up()} ${down()}
      ${assertSql(`pg_get_function_result('${sig}'::regprocedure) = 'TABLE(id uuid, base_price numeric, profit_margin numeric)'`, 'three-column signature restored')}
      ${assertSql(`has_function_privilege('authenticated', '${sig}', 'EXECUTE') AND NOT has_function_privilege('anon', '${sig}', 'EXECUTE')`, 'grants restored')}
      SELECT set_config('test.uid', '00000000-0000-0000-0000-0000000000aa', true);
      ${assertResult(`(SELECT to_jsonb(x) FROM ${fn}(10, 0, ARRAY[${P1}]) x)`, `(r->>'base_price')::numeric = 3.28 AND NOT r ? 'cost_cup'`, 'restored function works without cost_cup')}
    `);
  });
});
