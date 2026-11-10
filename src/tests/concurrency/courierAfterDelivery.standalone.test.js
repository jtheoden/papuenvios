/** Socketless real PG17 coverage. Run COURIER_TEST_PG_BIN=/usr/lib/postgresql/17/bin.
 * Minimal operation dependencies mirror the production money/status constraints; courier tables/functions are
 * the ACTUAL M1/M2/M3/A/B/C migrations. Auth gates are copied from the repo base schema, not role-bypassing mocks.
 * Two-session concurrency requires courierAfterDelivery.test.js on a socket-enabled scratch harness; --single is sequential.
 */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MIGRATIONS, ROLLBACKS, readSql } from './courierTestKit';
const bin = process.env.COURIER_TEST_PG_BIN;
const upPath = 'supabase/migrations/20261105170000_courier_assign_after_delivery.sql';
const downPath = 'supabase/rollbacks/20261105170000_courier_assign_after_delivery_down.sql';
const strip = (sql) => sql.replace(/^\s*(BEGIN|COMMIT);\s*$/gm, '');
const id = (n) => `'00000000-0000-4000-8000-${String(n).padStart(12, '0')}'::uuid`;
const rpc = (confirm = false, token = 'NULL', courier = id(3), reason = "'Historical assignment'") =>
  `public.admin_assign_courier_after_delivery('remittance',${id(4)},${courier},${reason},${confirm},${token})`;
const assert = (condition) => `DO $assert$ BEGIN IF NOT COALESCE((${condition}),false) THEN RAISE EXCEPTION 'Assertion failed: %', ${"'" + condition.replaceAll("'", "''") + "'"}; END IF; END $assert$;`;
const baseSchema = readFileSync('supabase/e2e/base-public-schema.sql', 'utf8');
const authGates = ['is_admin_user', 'is_super_admin'].map((name) => {
  const start = baseSchema.indexOf(`CREATE FUNCTION public.${name}()`);
  return baseSchema.slice(start, baseSchema.indexOf('$$;', start) + 3);
}).join('\n');
const setup = `
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon;
CREATE TABLE public.user_profiles(id uuid PRIMARY KEY, role text, is_enabled boolean NOT NULL);
${authGates}
CREATE TABLE public.currencies(id uuid PRIMARY KEY, code text NOT NULL UNIQUE);
CREATE TABLE public.shipping_zones(id uuid PRIMARY KEY);
CREATE TABLE public.remittance_types(id uuid PRIMARY KEY, delivery_currency text);
CREATE TABLE public.exchange_rates(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), from_currency_id uuid REFERENCES public.currencies, to_currency_id uuid REFERENCES public.currencies,
 rate numeric(15,6) NOT NULL CHECK(rate > 0), is_active boolean NOT NULL, effective_date timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.orders(id uuid PRIMARY KEY, status text NOT NULL CHECK(status IN ('processing','dispatched','delivered','completed','cancelled')),
 subtotal numeric(12,2) NOT NULL CHECK(subtotal>=0), currency_id uuid REFERENCES public.currencies, shipping_zone_id uuid, delivered_at timestamptz);
CREATE TABLE public.remittances(id uuid PRIMARY KEY, status text NOT NULL CHECK(status IN ('processing','delivered','completed','cancelled')),
 amount_sent numeric(12,2) NOT NULL CHECK(amount_sent>0), amount_to_deliver numeric(12,2) NOT NULL CHECK(amount_to_deliver>0),
 exchange_rate numeric(12,4) NOT NULL CHECK(exchange_rate>0), currency_sent text NOT NULL, currency_delivered text NOT NULL,
 commission_total numeric(12,2), delivery_cost numeric(12,2), shipping_zone_id uuid, remittance_type_id uuid, delivered_at timestamptz);
CREATE TABLE public.order_courier_costs(order_id uuid PRIMARY KEY REFERENCES public.orders ON DELETE CASCADE, amount_usd numeric(12,2), created_at timestamptz DEFAULT now());
CREATE TABLE public.remittance_courier_costs(remittance_id uuid PRIMARY KEY REFERENCES public.remittances ON DELETE CASCADE, amount_usd numeric(12,2), created_at timestamptz DEFAULT now());
CREATE TABLE public.financial_audit_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_name text NOT NULL, row_id uuid NOT NULL, column_name text NOT NULL,
 old_value text, new_value text, operation text NOT NULL CHECK(operation IN ('UPDATE','DELETE')), changed_by uuid, changed_by_role text, via_function text);
CREATE FUNCTION public.test_expect_error(p_sql text, p_message text, p_state text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
DECLARE caught boolean := false;
BEGIN
 BEGIN EXECUTE p_sql;
 EXCEPTION WHEN OTHERS THEN
   caught := true;
   IF p_state IS NOT NULL AND SQLSTATE <> p_state THEN RAISE EXCEPTION 'Unexpected SQLSTATE: %', SQLSTATE; END IF;
   IF SQLERRM NOT LIKE '%' || p_message || '%' THEN RAISE EXCEPTION 'Unexpected error: % (expected %)', SQLERRM, p_message; END IF;
 END;
 IF NOT caught THEN RAISE EXCEPTION 'Expected failure: %', p_message; END IF;
END $$;
${['m1','m2','m3','a','b'].map((key) => strip(readSql(MIGRATIONS[key]))).join('\n')}
INSERT INTO public.user_profiles VALUES (${id(1)}, 'super_admin', true);
SELECT set_config('request.jwt.claim.sub',${id(1)}::text,false);
INSERT INTO public.currencies VALUES (${id(10)},'USD'),(${id(11)},'CUP');
INSERT INTO public.exchange_rates(from_currency_id,to_currency_id,rate,is_active) VALUES(${id(10)},${id(11)},400,true);
INSERT INTO public.couriers(id,name) VALUES (${id(3)},'Test Courier'),(${id(30)},'Other Test Courier');
INSERT INTO public.remittances VALUES(${id(4)},'processing',100,79056,810,'USD','CUP',2.4,0,NULL,NULL,'2026-01-10T12:00:00Z');
UPDATE public.remittances SET status='delivered' WHERE id=${id(4)};
CREATE TEMP TABLE original_accrual AS SELECT * FROM public.courier_accruals;
CREATE TEMP TABLE original_functions AS SELECT oid,md5(prosrc) AS hash FROM pg_proc WHERE pronamespace='public'::regnamespace;
`;
const rule = (extra = '') => `INSERT INTO public.messenger_payment_types(code,name,version,applies_to,method,fixed_amount,currency,courier_id,valid_from${extra})
 VALUES ('fixed','Current test rule',1,'both','fixed_amount',2,'USD',${id(3)},now());`;
const error = (sql, message, state = null) => `SELECT public.test_expect_error($sql$${sql}$sql$,'${message}',${state ? `'${state}'` : 'NULL'});`;
(bin ? describe : describe.skip)('phase C contracts on standalone real PostgreSQL', () => {
  let dir;
  const execute = (sql, database = 'papuenvios_test_courier_c') => {
    const file = join(dir, 'scenario.sql');
    writeFileSync(file, sql.split('\n').filter((line) => line.trim()).join('\n') + '\n\n');
    const fd = openSync(file, 'r');
    try {
      const r = spawnSync(join(bin,'postgres'), ['--single','-j','-D',dir,database], { stdio: [fd,'pipe','pipe'], encoding:'utf8', timeout:30000, maxBuffer:12*1024*1024, env:{...process.env,LC_ALL:'C'} });
      expect(r.error).toBeUndefined(); expect(r.status,r.stderr).toBe(0); expect(r.stderr).not.toMatch(/(?:ERROR|FATAL|PANIC):/);
    } finally { closeSync(fd); }
  };
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(),'papuenvios-courier-c-'));
    const r = spawnSync(join(bin,'initdb'),['-D',dir,'-U','postgres','-A','trust','--no-locale'],{encoding:'utf8'});
    expect(r.status,r.stderr).toBe(0);
    execute('CREATE DATABASE papuenvios_test_courier_c;','postgres');
    execute('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  });
  afterAll(() => { if(dir) rmSync(dir,{recursive:true,force:true}); });
  const run = (sql) => execute(`BEGIN; ${setup}\n${strip(readSql(upPath))}\n${sql}\nROLLBACK;`);
  it('super_admin only, enabled role rechecked, API/helper privileges explicit', () => run(`
    SET ROLE authenticated;
    SELECT ${rpc()};
    RESET ROLE;
    UPDATE public.user_profiles SET role='admin';
    SET ROLE authenticated;
    ${error('SELECT '+rpc(),'insufficient_privilege')}
    ${error('SELECT '+rpc(true),'insufficient_privilege')}
    RESET ROLE;
    UPDATE public.user_profiles SET role='user';
    ${error('SELECT '+rpc(),'insufficient_privilege')}
    UPDATE public.user_profiles SET role='super_admin',is_enabled=false;
    ${error('SELECT '+rpc(),'insufficient_privilege')}
    ${assert(`NOT has_function_privilege('anon','public.admin_assign_courier_after_delivery(text,uuid,uuid,text,boolean,text)','EXECUTE')`)}
    ${assert(`NOT has_function_privilege('service_role','public.admin_assign_courier_after_delivery(text,uuid,uuid,text,boolean,text)','EXECUTE')`)}
    ${assert(`NOT has_function_privilege('authenticated','public._courier_compute_accrual_retroactive(text,uuid,uuid)','EXECUTE')`)}
  `));
  it('preview is read-only; confirmation writes once, audited reason, snapshot and date; retry does not write', () => run(`
    ${rule()}
    CREATE TEMP TABLE quote AS SELECT ${rpc()} AS q;
    ${assert(`(SELECT (q->>'amount_cup')::numeric=1620 AND q->>'fx_source'='remittance' AND q->>'precedence'='courier' FROM quote)`)}
    ${assert('NOT EXISTS(SELECT * FROM public.courier_accruals EXCEPT SELECT * FROM original_accrual)')}
    ${assert('NOT EXISTS(SELECT 1 FROM public.financial_audit_log)')}
    SELECT ${rpc(true,"(SELECT q->>'preview_token' FROM quote)")};
    ${assert(`(SELECT courier_id=${id(3)} AND amount_cup=1620 AND amount_usd=2 AND fx_used=810 AND rule_snapshot->>'retroactive'='true'
      AND rule_snapshot->>'assignment_reason'='Historical assignment' AND delivered_at='2026-01-10T12:00:00Z' FROM public.courier_accruals)`)}
    ${assert(`(SELECT count(*)=1 AND bool_and(new_value::jsonb->>'reason'='Historical assignment') FROM public.financial_audit_log)`)}
    CREATE TEMP TABLE confirmed AS SELECT * FROM public.courier_accruals;
    ${assert(`(${rpc(true,"(SELECT q->>'preview_token' FROM quote)")}->>'already_assigned')::boolean`)}
    ${assert('NOT EXISTS(SELECT * FROM public.courier_accruals EXCEPT SELECT * FROM confirmed)')}
    ${assert('(SELECT count(*)=1 FROM public.financial_audit_log)')}
    ${assert('NOT EXISTS(SELECT 1 FROM public.delivery_assignments)')}
    ${error('SELECT '+rpc(true,'NULL',id(30)), 'already_assigned')}
  `));
  it('exact confirmation retry after payment acknowledges without writes; mismatches and void remain refused', () => run(`
    ${rule()}
    CREATE TEMP TABLE quote AS SELECT ${rpc()} AS q;
    SELECT ${rpc(true,"(SELECT q->>'preview_token' FROM quote)")};
    INSERT INTO public.courier_payments(id,amount_cup,method,paid_at) VALUES(${id(6)},1620,'test',now());
    UPDATE public.courier_accruals SET payment_id=${id(6)};
    CREATE TEMP TABLE linked AS SELECT * FROM public.courier_accruals;
    CREATE TEMP TABLE audit_before_retry AS SELECT * FROM public.financial_audit_log;
    ${assert(`(${rpc(true,"(SELECT q->>'preview_token' FROM quote)")}->>'already_assigned')::boolean`)}
    ${assert('NOT EXISTS(SELECT * FROM public.courier_accruals EXCEPT SELECT * FROM linked)')}
    UPDATE public.courier_accruals SET status='paid';
    CREATE TEMP TABLE paid AS SELECT * FROM public.courier_accruals;
    ${assert(`(${rpc(true,"(SELECT q->>'preview_token' FROM quote)")}->>'already_assigned')::boolean`)}
    ${assert('NOT EXISTS(SELECT * FROM public.courier_accruals EXCEPT SELECT * FROM paid)')}
    ${error('SELECT '+rpc(true,"(SELECT q->>'preview_token' FROM quote)",id(30)), 'invalid_status')}
    ${error('SELECT '+rpc(true,"(SELECT q->>'preview_token' FROM quote)",id(3),"'Different historical reason'"), 'invalid_status')}
    ${error('SELECT '+rpc(true,"'different-token'"), 'invalid_status')}
    ${error('SELECT '+rpc(), 'invalid_status')}
    UPDATE public.courier_accruals SET status='void',void_reason='Voided after payment';
    CREATE TEMP TABLE voided AS SELECT * FROM public.courier_accruals;
    ${error('SELECT '+rpc(true,"(SELECT q->>'preview_token' FROM quote)"), 'invalid_status')}
    ${assert('NOT EXISTS(SELECT * FROM public.courier_accruals EXCEPT SELECT * FROM voided)')}
    ${assert('NOT EXISTS((TABLE public.financial_audit_log EXCEPT TABLE audit_before_retry) UNION ALL (TABLE audit_before_retry EXCEPT TABLE public.financial_audit_log))')}
  `));
  it('preview without payment rules returns NULL/no_rule; confirm refuses without writes, then succeeds once a rule exists', () => run(`
    CREATE TEMP TABLE quote AS SELECT ${rpc()} AS q;
    ${assert(`(SELECT q->>'reason'='no_rule' AND q->>'amount_cup' IS NULL AND q->>'confirmed'='false' FROM quote)`)}
    ${assert('NOT EXISTS((TABLE public.courier_accruals EXCEPT TABLE original_accrual) UNION ALL (TABLE original_accrual EXCEPT TABLE public.courier_accruals))')}
    ${assert('NOT EXISTS(SELECT 1 FROM public.financial_audit_log)')}
    ${error('SELECT '+rpc(true,"(SELECT q->>'preview_token' FROM quote)"), 'no_amount: no_rule', '22023')}
    ${assert('NOT EXISTS((TABLE public.courier_accruals EXCEPT TABLE original_accrual) UNION ALL (TABLE original_accrual EXCEPT TABLE public.courier_accruals))')}
    ${assert('NOT EXISTS(SELECT 1 FROM public.financial_audit_log)')}
    ${assert('NOT EXISTS(SELECT 1 FROM public.delivery_assignments)')}
    ${rule()}
    ${error('SELECT '+rpc(true,"(SELECT q->>'preview_token' FROM quote)"), 'preview_changed')}
    SELECT ${rpc(true,`(${rpc()}->>'preview_token')`)};
    ${assert(`(SELECT courier_id=${id(3)} AND amount_cup=1620 FROM public.courier_accruals)`)}
    ${assert('(SELECT count(*)=1 FROM public.financial_audit_log)')}
  `));
  it('orders and USD-to-USD remittances use current rates; USD-to-CUP uses frozen even with no live FX', () => run(`
    ${rule()}
    ${assert(`(${rpc()}->>'amount_cup')::numeric=1620`)}
    UPDATE public.remittances SET currency_delivered='USD',exchange_rate=1 WHERE id=${id(4)};
    ${assert(`(${rpc()}->>'amount_cup')::numeric=800 AND ${rpc()}->>'fx_source'='exchange_rates'`)}
    INSERT INTO public.orders VALUES(${id(5)},'dispatched',100,${id(10)},NULL,'2026-01-10');
    UPDATE public.orders SET status='delivered';
    ${assert(`(public.admin_assign_courier_after_delivery('order',${id(5)},${id(3)},'Historical assignment')->>'fx_used')::numeric=400`)}
    UPDATE public.remittances SET currency_delivered='CUP',exchange_rate=810 WHERE id=${id(4)};
    -- Existing delivery still uses the live fixed-USD rate (phase B behavior), not the retroactive frozen rate.
    INSERT INTO public.remittances SELECT ${id(40)},'processing',amount_sent,amount_to_deliver,exchange_rate,currency_sent,currency_delivered,
      commission_total,delivery_cost,shipping_zone_id,remittance_type_id,delivered_at FROM public.remittances WHERE id=${id(4)};
    SELECT public.admin_assign_delivery_courier('remittance',${id(40)},${id(3)});
    UPDATE public.remittances SET status='delivered' WHERE id=${id(40)};
    ${assert(`(SELECT amount_cup=800 AND fx_used=400 AND rule_snapshot->>'source'='trigger' AND NOT rule_snapshot ? 'retroactive' FROM public.courier_accruals WHERE remittance_id=${id(40)})`)}
    UPDATE public.exchange_rates SET is_active=false;
    ${assert(`(${rpc()}->>'amount_cup')::numeric=1620`)}
  `));
  it('requires reason and fresh preview, rejects paid/void/payment-linked/already-assigned and known-cost rows', () => run(`
    ${error('SELECT '+rpc(false,'NULL',id(3),"'short'"),'invalid_reason')}
    ${error('SELECT '+rpc(true),'preview_required')}
    CREATE TEMP TABLE quote AS SELECT ${rpc()} AS q;
    ${rule()}
    ${error('SELECT '+rpc(true,"(SELECT q->>'preview_token' FROM quote)"),'preview_changed')}
    UPDATE public.courier_accruals SET status='paid';
    ${error('SELECT '+rpc(),'invalid_status')}
    UPDATE public.courier_accruals SET status='void',void_reason='Test void reason';
    ${error('SELECT '+rpc(),'invalid_status')}
    UPDATE public.courier_accruals SET status='calculated',courier_id=${id(3)};
    ${error('SELECT '+rpc(),'already_assigned')}
    UPDATE public.courier_accruals SET courier_id=NULL,amount_cup=0;
    ${error('SELECT '+rpc(),'invalid_status')}
    INSERT INTO public.courier_payments(id,amount_cup,method,paid_at) VALUES(${id(6)},1,'test',now());
    UPDATE public.courier_accruals SET amount_cup=NULL,payment_id=${id(6)};
    ${error('SELECT '+rpc(),'invalid_status')}
  `));
  it('refuses cancelled/pending operations, missing accruals, invalid kinds and inactive/missing couriers', () => run(`
    ${error('SELECT '+rpc(false,'NULL','NULL'),'courier not found or inactive')}
    UPDATE public.couriers SET is_active=false WHERE id=${id(3)};
    ${error('SELECT '+rpc(),'courier not found or inactive')}
    UPDATE public.couriers SET is_active=true WHERE id=${id(3)};
    UPDATE public.remittances SET status='cancelled';
    ${error('SELECT '+rpc(),'invalid_status')}
    UPDATE public.remittances SET status='processing';
    ${error('SELECT '+rpc(),'invalid_status')}
    UPDATE public.remittances SET status='completed';
    ${assert(`${rpc()}->>'retroactive'='true'`)}
    DELETE FROM public.courier_accruals;
    ${error('SELECT '+rpc(),'accrual_not_found')}
    ${error("SELECT public.admin_assign_courier_after_delivery('invalid',"+id(4)+","+id(3)+",'Historical assignment')",'invalid_argument')}
    DELETE FROM public.remittances;
    ${error('SELECT '+rpc(),'operation_not_found')}
  `));
  it('all unknown-cost reasons refuse confirmation; half-open ranges and precedence reused', () => run(`
    ${assert(`${rpc()}->>'reason'='no_rule' AND ${rpc()}->>'amount_cup' IS NULL`)}
    ${error('SELECT '+rpc(true,`(${rpc()}->>'preview_token')`), 'no_amount: no_rule', '22023')}
    ${rule()}
    UPDATE public.messenger_payment_types SET is_active=false;
    INSERT INTO public.messenger_payment_types(code,name,version,applies_to,method,fixed_cup,currency,courier_id,valid_from,amount_from,amount_to)
      VALUES('tier','Test tier',1,'remittance','fixed_cup',50,'CUP',${id(3)},now(),81000,90000);
    ${assert(`${rpc()}->>'reason'='no_tier_match'`)}
    ${error('SELECT '+rpc(true,`(${rpc()}->>'preview_token')`), 'no_amount: no_tier_match', '22023')}
    UPDATE public.remittances SET amount_sent=100.01;
    ${assert(`(${rpc()}->>'amount_cup')::numeric=50`)}
    UPDATE public.remittances SET currency_delivered='USD'; UPDATE public.exchange_rates SET is_active=false;
    ${assert(`${rpc()}->>'reason'='no_fx'`)}
    ${error('SELECT '+rpc(true,`(${rpc()}->>'preview_token')`), 'no_amount: no_fx', '22023')}
    UPDATE public.exchange_rates SET is_active=true,rate=999999999;
    UPDATE public.messenger_payment_types SET is_active=false WHERE code='tier';
    INSERT INTO public.messenger_payment_types(code,name,version,applies_to,method,fixed_amount,currency,courier_id,valid_from)
      VALUES('big','Test overflow',1,'both','fixed_amount',9999999999.99,'USD',${id(3)},now());
    ${assert(`${rpc()}->>'reason'='amount_out_of_range'`)}
    ${error('SELECT '+rpc(true,`(${rpc()}->>'preview_token')`), 'no_amount: amount_out_of_range', '22023')}
    UPDATE public.messenger_payment_types SET is_active=false;
    INSERT INTO public.messenger_payment_types(code,name,version,applies_to,method,cup_per_usd,base,currency,courier_id,valid_from)
      VALUES('basis','Missing basis',1,'remittance','per_usd_delivered',2,'nominal_usd','USD',${id(3)},now());
    UPDATE public.remittances SET currency_sent='CUP';
    ${assert(`${rpc()}->>'reason'='no_amount_basis'`)}
    ${error('SELECT '+rpc(true,`(${rpc()}->>'preview_token')`), 'no_amount: no_amount_basis', '22023')}
    ${assert('NOT EXISTS((TABLE public.courier_accruals EXCEPT TABLE original_accrual) UNION ALL (TABLE original_accrual EXCEPT TABLE public.courier_accruals))')}
    ${assert('NOT EXISTS(SELECT 1 FROM public.financial_audit_log)')}
  `));
  it('subscriptions preserve courier precedence and metadata; migration/rollback preserve functions, paid evidence and data', () => run(`
    INSERT INTO public.messenger_payment_types(code,name,version,applies_to,method,fixed_cup,currency,valid_from)
      VALUES('sub','Subscribed test rule',1,'both','fixed_cup',300,'USD',now());
    SELECT public.admin_subscribe_courier_payment_type(${id(3)},'sub');
    ${assert(`${rpc()}->>'precedence'='courier'`)}
    SELECT ${rpc(true,`(${rpc()}->>'preview_token')`)};
    ${assert(`(SELECT rule_snapshot->>'via_subscription'='true' FROM public.courier_accruals)`)}
    ${assert('NOT EXISTS(SELECT 1 FROM original_functions o JOIN pg_proc p USING(oid) WHERE o.hash<>md5(p.prosrc))')}
    CREATE TEMP TABLE saved AS SELECT * FROM public.courier_accruals;
    ${strip(readSql(downPath))}
    ${assert("to_regproc('public.admin_assign_courier_after_delivery') IS NULL")}
    ${assert('NOT EXISTS(SELECT * FROM public.courier_accruals EXCEPT SELECT * FROM saved)')}
    ${assert('NOT EXISTS(SELECT 1 FROM original_functions o JOIN pg_proc p USING(oid) WHERE o.hash<>md5(p.prosrc))')}
    ${strip(readSql(upPath))}
    SET LOCAL app.confirm_courier_rollback='yes';
    ${strip(readSql(ROLLBACKS.b))}
    ${strip(readSql(ROLLBACKS.a))}
    ${assert('NOT EXISTS(SELECT * FROM public.courier_accruals EXCEPT SELECT * FROM saved)')}
    ${strip(readSql(downPath))} -- C rollback also works AFTER B -> A, without disturbing them.
  `));
});
