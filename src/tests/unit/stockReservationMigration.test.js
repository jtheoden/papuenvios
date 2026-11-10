import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveCartItemType } from '@/lib/cartItemType';

const MIGRATION = resolve(process.cwd(), 'supabase/migrations/20261014190000_atomic_stock_reservation.sql');
const sql = readFileSync(MIGRATION, 'utf8');
const code = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');
const ES = JSON.parse(readFileSync(resolve(process.cwd(), 'src/translations/ES.json'), 'utf8'));
const EN = JSON.parse(readFileSync(resolve(process.cwd(), 'src/translations/EN.json'), 'utf8'));

const PUBLIC_RPCS = [
  'reserve_order_inventory(uuid)',
  'release_order_inventory(uuid)',
  'consume_order_inventory(uuid)',
  'restock_order_inventory(uuid, text)',
  'get_stock_policy()',
  'set_stock_policy(integer, integer, integer)',
  'reset_stock_policy()',
  'expire_stale_order_reservations(integer, integer)'
];

describe('atomic stock reservation migration (static guarantees; behaviour is covered by npm run test:concurrency)', () => {
  it('pins search_path = public, pg_temp on every function (S2)', () => {
    const definers = code.match(/SECURITY DEFINER\s+SET search_path = public, pg_temp/g) || [];
    // 8 public RPCs (reserve, release, consume, restock, expire, get/set/reset policy)
    // + 3 internal lockers + policy reader + policy writer + cancel trigger
    expect(definers).toHaveLength(14);
    expect(code.match(/SECURITY DEFINER/g)).toHaveLength(14);
    // The two row guards are SECURITY INVOKER by design (they inspect the caller)
    expect(code.match(/SECURITY INVOKER\s+SET search_path = public, pg_temp/g)).toHaveLength(2);
    expect(code).not.toMatch(/SET search_path = public\s*$/m);
  });

  it('releases on ANY cancel through an AFTER UPDATE OF status trigger (W2)', () => {
    expect(code).toMatch(/CREATE TRIGGER release_stock_on_order_cancel\s+AFTER UPDATE OF status ON public\.orders/);
    expect(code).toMatch(/WHEN \(NEW\.status = 'cancelled' AND OLD\.status IS DISTINCT FROM 'cancelled'\)/);
  });

  it('isolates each order of the expiry sweep in its own subtransaction (W1)', () => {
    expect(code).toMatch(/EXCEPTION WHEN OTHERS THEN\s+v_skipped := v_skipped \+ 1;\s+RAISE WARNING 'expire_stale_order_reservations/);
    expect(code).toMatch(/v_delta := LEAST\(v_alloc\.quantity, GREATEST\(COALESCE\(v_current, 0\), 0\)\)/);
  });

  it('locks the order FOR SHARE in the order_items guard (W3)', () => {
    expect(code).toMatch(/FOR SHARE OF o;/);
  });

  it('writes the policy audit row inside the database (W4)', () => {
    expect(code).toMatch(/INSERT INTO public\.activity_logs \(action, entity_type, entity_id, performed_by, description, metadata\)/);
    expect(code).toMatch(/REVOKE ALL ON FUNCTION public\._apply_stock_policy\(integer, integer, integer, text\) FROM PUBLIC, anon, authenticated;/);
  });

  it('documents the open ledger and cascade risks honestly (W5)', () => {
    expect(sql).toMatch(/OPEN RISKS/);
    expect(sql).toMatch(/ON DELETE CASCADE: deleting a batch/);
    expect(sql).toMatch(/NOT ledgered/);
  });

  it.each(PUBLIC_RPCS)('revokes %s from PUBLIC and anon and grants it to authenticated + service_role', (sig) => {
    const escaped = sig.replace(/[()]/g, '\\$&');
    expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${escaped} FROM PUBLIC, anon;`));
    expect(sql).toMatch(
      new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${escaped} TO authenticated, service_role;`)
    );
  });

  it('keeps the internal helpers unreachable from the API roles', () => {
    for (const fn of ['_order_stock_needs', '_reserve_order_locked', '_release_order_locked', '_consume_order_locked']) {
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(uuid\\) FROM PUBLIC, anon, authenticated;`));
    }
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\._stock_policy_int\(text\) FROM PUBLIC, anon, authenticated;/);
  });

  it('never schedules anything (pg_cron snippet stays commented)', () => {
    expect(code).not.toMatch(/cron\.schedule/);
  });

  it('enables RLS on the allocations table and exposes no direct writes', () => {
    expect(sql).toMatch(/ALTER TABLE public\.order_stock_allocations ENABLE ROW LEVEL SECURITY;/);
    expect(sql).toMatch(/GRANT SELECT ON public\.order_stock_allocations TO authenticated;/);
    expect(sql).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*order_stock_allocations TO authenticated/);
  });

  it('marks scheduling as a release gate and keeps the cron snippet argument-free', () => {
    expect(sql).toMatch(/RELEASE GATE/);
    expect(sql).toMatch(/--\s+\$\$SELECT public\.expire_stale_order_reservations\(\)\$\$/);
  });

  it('stores the approved policy defaults in system_config without touching its policies', () => {
    expect(code).toMatch(/'stock_unpaid_expiry_hours', 48::numeric/);
    expect(code).toMatch(/'stock_proof_expiry_hours', 168::numeric/);
    expect(code).toMatch(/'stock_max_open_reservations', 5::numeric/);
    expect(code).toMatch(/WHERE NOT EXISTS \(SELECT 1 FROM public\.system_config c WHERE c\.key = v\.key\)/);
    // the existing system_config write policies are not widened
    expect(code).not.toMatch(/(CREATE|ALTER|DROP) POLICY[^;]*system_config/i);
  });

  it('reads the cap and the windows from the config instead of constants', () => {
    expect(code).not.toMatch(/v_max_open_reservations integer := \d+;/);
    expect(code).toMatch(/v_max_open_reservations integer := public\._stock_policy_int\('stock_max_open_reservations'\);/);
    expect(code).toMatch(/p_hours integer DEFAULT NULL,\s+p_proof_hours integer DEFAULT NULL/);
  });

  it('restricts set / reset to super_admin and validates the bounds with 22023', () => {
    expect(code).toMatch(/set_stock_policy[\s\S]*?NOT public\.is_super_admin\(\)/);
    expect(code).toMatch(/NOT BETWEEN 6 AND 720/);
    expect(code).toMatch(/NOT BETWEEN 24 AND 2160/);
    expect(code).toMatch(/NOT BETWEEN 1 AND 50/);
    expect(code).toMatch(/pg_advisory_xact_lock\(hashtext\('stock_policy'\)\)/);
    expect(code).toMatch(/_apply_stock_policy\(48, 168, 5, 'stock_policy_reset'\)/);
  });

  it('guards order_items and does NOT drop the legacy movements insert policy (version skew: it lives in 20261014210000)', () => {
    expect(code).not.toMatch(/DROP POLICY[^;]*inventory_movements_insert_own_order/);
    expect(code).toMatch(/CREATE TRIGGER guard_order_items_insert\s+BEFORE INSERT ON public\.order_items/);
    const drop = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261014210000_drop_movements_insert_policy.sql'), 'utf8');
    expect(drop).toMatch(/^DROP POLICY IF EXISTS inventory_movements_insert_own_order ON public\.inventory_movements;$/m);
    expect(drop).toMatch(/ROLLBACK/);
    expect(drop).toMatch(/CREATE POLICY inventory_movements_insert_own_order/);
    expect(drop).toMatch(/AFTER the new front end is deployed/);
  });

  it('isolates the cancel-trigger release, logs skipped expiries and audits the policy durably (W6, W7, W10)', () => {
    expect(code).toMatch(/PERFORM public\._release_order_locked\(NEW\.id\);\s+EXCEPTION WHEN OTHERS THEN/);
    expect(code).toMatch(/'stock_release_failed'/);
    expect(code).toMatch(/'stock_expiry_skipped'/);
    expect(code).toMatch(/'stock_expiry_run'/);
    expect(code).toMatch(/'stock_policy_changed'/);
  });

  it('the sweep only touches pending orders that still hold a reserved allocation; consume clamps like release', () => {
    const sweep = code.slice(code.indexOf('1. Lock every candidate order') > -1 ? 0 : 0);
    expect(sweep).toMatch(/o\.status = 'pending'\s+AND EXISTS \(SELECT 1 FROM public\.order_stock_allocations a\s+WHERE a\.order_id = o\.id AND a\.state = 'reserved'\)\s+AND o\.payment_status IN \('pending', 'rejected'\)/);
    expect(sweep).toMatch(/o\.status = 'pending'\s+AND EXISTS \(SELECT 1 FROM public\.order_stock_allocations a\s+WHERE a\.order_id = o\.id AND a\.state = 'reserved'\)\s+AND o\.payment_status = 'proof_uploaded'/);
    expect(sweep).toMatch(/'sold', -v_alloc\.quantity, -v_delta,/);
  });

  it('converts the ledger columns to text only when they are enums', () => {
    expect(code).toMatch(/c\.data_type = 'USER-DEFINED'/);
    expect(code).toMatch(/ALTER COLUMN %I TYPE text USING %I::text/);
  });

  it('turns inventory_movements into a ledger and adds the restocked state', () => {
    expect(code).toMatch(/ADD COLUMN IF NOT EXISTS reserved_change integer NOT NULL DEFAULT 0/);
    expect(code).toMatch(/CHECK \(state IN \('reserved', 'consumed', 'released', 'restocked'\)\)/);
    // every movement written by an RPC states both deltas
    const inserts = code.match(/INSERT INTO public\.inventory_movements\s+\(inventory_id, movement_type, quantity_change, reserved_change,/g) || [];
    expect(inserts).toHaveLength(4);
    expect(code.match(/INSERT INTO public\.inventory_movements/g)).toHaveLength(4);
  });

  it('documents a rollback', () => {
    expect(sql).toMatch(/ROLLBACK/);
    expect(sql).toMatch(/DROP TABLE IF EXISTS public\.order_stock_allocations;/);
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS release_stock_on_order_cancel ON public\.orders;/);
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\._apply_stock_policy/);
    expect(sql).toMatch(/SELECT cron\.unschedule/);
  });
});

describe('stock reservation i18n parity', () => {
  const read = (dict, path) => path.reduce((node, key) => node?.[key], dict);
  const KEYS = [
    ['cart', 'stock', 'insufficient'],
    ['cart', 'stock', 'insufficientItem'],
    ['cart', 'stock', 'invalidItem'],
    ['stockPolicy', 'title'],
    ['stockPolicy', 'intro'],
    ['stockPolicy', 'unpaid', 'label'],
    ['stockPolicy', 'unpaid', 'help'],
    ['stockPolicy', 'proof', 'label'],
    ['stockPolicy', 'proof', 'help'],
    ['stockPolicy', 'maxOpen', 'label'],
    ['stockPolicy', 'maxOpen', 'help'],
    ['stockPolicy', 'errors', 'range'],
    ['stockPolicy', 'errors', 'belowUnpaid'],
    ['stockPolicy', 'scheduleNote'],
    ['cart', 'stock', 'tooManyOpen'],
    ['cart', 'stock', 'emptyOrder'],
    ['vendor', 'inventory', 'stockBelowReserved'],
    ['adminOrders', 'modals', 'restockTitle'],
    ['adminOrders', 'messages', 'restockPrompt'],
    ['adminOrders', 'messages', 'restockSuccess'],
    ['adminOrders', 'messages', 'restockError'],
    ['adminOrders', 'messages', 'restockNothing'],
    ['adminOrders', 'messages', 'restockReasonRequired'],
    ['adminOrders', 'messages', 'restockReasonPrompt'],
    ['adminOrders', 'modals', 'restockReasonTitle'],
    ['adminOrders', 'action', 'restock'],
    ['userPanel', 'reopenInsufficientStock'],
    ['adminOrders', 'messages', 'validateStockError']
  ];

  it.each(KEYS)('has %s in ES and EN', (...path) => {
    expect(typeof read(ES, path)).toBe('string');
    expect(typeof read(EN, path)).toBe('string');
  });

  it('has the same stockPolicy key tree in both languages', () => {
    const leaves = (node, prefix = '') =>
      Object.entries(node).flatMap(([k, v]) =>
        typeof v === 'object' ? leaves(v, `${prefix}${k}.`) : [`${prefix}${k}`]
      ).sort();
    expect(leaves(ES.stockPolicy)).toEqual(leaves(EN.stockPolicy));
    expect(ES.stockPolicy.errors.range).toContain('{min}');
    expect(EN.stockPolicy.errors.range).toContain('{max}');
  });

  it('keeps the same placeholders in both languages', () => {
    for (const key of ['insufficientItem']) {
      const placeholders = (text) => (text.match(/\{\w+\}/g) || []).sort();
      expect(placeholders(ES.cart.stock[key])).toEqual(placeholders(EN.cart.stock[key]));
    }
  });
});

describe('resolveCartItemType', () => {
  it('honours an explicit combo type', () => {
    expect(resolveCartItemType({ id: 'c', type: 'combo' })).toBe('combo');
  });

  it('detects a combo added without a type (it carries a products array)', () => {
    expect(resolveCartItemType({ id: 'c', products: [{ product_id: 'p', quantity: 1 }] })).toBe('combo');
  });

  it('defaults plain products to product', () => {
    expect(resolveCartItemType({ id: 'p' })).toBe('product');
    expect(resolveCartItemType({ id: 'p', type: 'product' })).toBe('product');
    expect(resolveCartItemType(null)).toBe('product');
  });
});

describe('product delete safety + ledger migration (static guarantees)', () => {
  const sql2 = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/20261014200000_product_delete_safety_and_ledger.sql'),
    'utf8'
  );
  const code2 = sql2
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  it('pins search_path = public, pg_temp on every SECURITY DEFINER function', () => {
    const total = code2.match(/SECURITY DEFINER/g) || [];
    const pinned = code2.match(/SECURITY DEFINER\s+SET search_path = public, pg_temp/g) || [];
    // product blockers, combo blockers, orders_with_consumed_stock, ledger snapshot helper,
    // delete_product, bulk delete, preview, ledger trigger, delete snapshot trigger
    // + delete_combo
    expect(total).toHaveLength(10);
    expect(pinned).toHaveLength(10);
    expect(code2.match(/SECURITY INVOKER\s+SET search_path = public, pg_temp/g)).toHaveLength(2);
    expect(code2).toMatch(/SECURITY INVOKER\s+SET search_path = public, pg_temp/);
  });

  it('gives bulk delete and the preview the SAME predicate and keeps the super_admin gates', () => {
    expect(code2.match(/FROM public\.get_product_blockers\(v_id\)/g)).toHaveLength(2);
    expect(code2).not.toMatch(/count\(\*\) INTO v_blocking_count\s+FROM order_items/);
    expect(code2.match(/is_super_admin\(\)/g)).toHaveLength(2);
    expect(code2).toMatch(/pg_advisory_xact_lock\(hashtext\('bulk_delete:products'\)\)/);
  });

  it('does not filter the blocker lookup by item_type and fails closed on unknown statuses', () => {
    expect(code2).not.toMatch(/item_type/);
    expect(code2).toMatch(/o\.status IS NULL\s+OR o\.status NOT IN \('dispatched', 'delivered', 'completed', 'cancelled'\)/);
  });

  it('snapshots deleted batches into admin_destructive_ops_log and never writes movements on delete', () => {
    const snapshot = code2.slice(code2.indexOf('trg_inventory_delete_snapshot()'));
    expect(snapshot).toMatch(/INSERT INTO public\.admin_destructive_ops_log/);
    expect(snapshot).not.toMatch(/INSERT INTO public\.inventory_movements/);
  });

  it('keeps get_product_blockers away from anon', () => {
    expect(sql2).toMatch(/REVOKE ALL ON FUNCTION public\.get_product_blockers\(uuid\) FROM PUBLIC, anon;/);
    expect(sql2).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_product_blockers\(uuid\) TO authenticated, service_role;/);
  });

  it('the stock RPC helpers raise the app.stock_rpc flag and restore it', () => {
    expect(code.match(/set_config\('app\.stock_rpc', 'on', true\)/g)).toHaveLength(4);
    expect(code.match(/set_config\('app\.stock_rpc', COALESCE\(v_prev_rpc, 'off'\), true\)/g)).toHaveLength(4);
  });

  it('delete_combo locks the component batches before the blocker check and logs the delete', () => {
    const body = code2.slice(code2.indexOf('FUNCTION public.delete_combo'), code2.indexOf('GRANT EXECUTE ON FUNCTION public.delete_combo'));
    expect(body.indexOf('FOR UPDATE')).toBeGreaterThan(-1);
    expect(body.indexOf('FOR UPDATE')).toBeLessThan(body.indexOf('get_combo_blockers'));
    expect(body).toMatch(/'combo_deleted'/);
    expect(sql2).toMatch(/DROP FUNCTION IF EXISTS public\.delete_combo\(uuid\);/);
  });

  it('documents a rollback', () => {
    expect(sql2).toMatch(/ROLLBACK/);
    expect(sql2).toMatch(/DROP FUNCTION IF EXISTS public\.get_product_blockers\(uuid\);/);
  });

  it('guards the ledger and the reserved counter, locks before checking, and keeps new RPCs away from anon', () => {
    expect(code2).toMatch(/BEFORE DELETE ON public\.inventory_movements/);
    expect(code2).toMatch(/BEFORE INSERT ON public\.inventory\s+FOR EACH ROW EXECUTE FUNCTION public\.guard_inventory_reserved_edit/);
    expect(code2.match(/ORDER BY i\.id FOR UPDATE;/g)).toHaveLength(3); // delete_product + bulk + delete_combo (the lock before the check)
    for (const fn of ['get_combo_blockers(uuid)', 'orders_with_consumed_stock(uuid[])', 'delete_product(uuid)', 'delete_combo(uuid)']) {
      const escaped = fn.replace(/[()[\]]/g, '\\$&');
      expect(sql2).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${escaped} FROM PUBLIC, anon;`));
    }
    expect(sql2).toMatch(/REVOKE ALL ON FUNCTION public\._log_product_ledger_snapshot\(uuid\) FROM PUBLIC, anon, authenticated;/);
  });

  it('corrects the wrong "11 via combo" figure and ships the live bodies as a rollback file', () => {
    expect(sql2).not.toMatch(/11 more through combo_items/);
    expect(sql2).toMatch(/0 through combo_items/);
    const live = readFileSync(resolve(process.cwd(), 'supabase/rollbacks/20261014_bulk_delete_live_bodies.sql'), 'utf8');
    expect(live).toMatch(/CREATE OR REPLACE FUNCTION public\.bulk_delete_products/);
    expect(live).toMatch(/CREATE OR REPLACE FUNCTION public\.preview_bulk_delete_products/);
    expect(live).toMatch(/42702/);
  });
});
