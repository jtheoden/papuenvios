import { describe, it, expect, vi, beforeEach } from 'vitest';

// One mock for both services: records every table call and serves rpc / selects from state.
const state = {
  blockers: [],
  rpcError: null,
  inventory: [{ id: 'inv-1' }],
  orderItems: [],
  calls: []
};

const chain = (table) => {
  const c = {};
  const record = (op, ...args) => state.calls.push({ table, op, args });
  c.select = vi.fn((...a) => { record('select', ...a); return c; });
  c.update = vi.fn((...a) => { record('update', ...a); return c; });
  c.delete = vi.fn((...a) => { record('delete', ...a); return c; });
  c.eq = vi.fn((...a) => { record('eq', ...a); return c; });
  c.in = vi.fn((...a) => { record('in', ...a); return c; });
  c.single = vi.fn(async () => ({ data: { id: 'x', name_es: 'Item' }, error: null }));
  c.then = (resolve) => {
    if (table === 'inventory') return resolve({ data: state.inventory, error: null });
    if (table === 'order_items') return resolve({ data: state.orderItems, error: null });
    return resolve({ data: [], error: null });
  };
  return c;
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table) => chain(table),
    rpc: vi.fn(async (name, args) => {
      state.calls.push({ table: 'rpc', op: name, args: [args] });
      return state.rpcError
        ? { data: null, error: state.rpcError }
        : { data: state.blockers, error: null };
    })
  }
}));
vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));

import { deleteProduct } from '@/lib/productService';
import { deleteCombo } from '@/lib/comboService';

const deletes = () => state.calls.filter((c) => c.op === 'delete');

beforeEach(() => {
  state.blockers = [];
  state.rpcError = null;
  state.inventory = [{ id: 'inv-1' }];
  state.orderItems = [];
  state.calls = [];
});

describe('deleteProduct uses the shared database predicate (get_product_blockers)', () => {
  it('asks the RPC instead of looking only at order_items.inventory_id', async () => {
    await deleteProduct('p1', 'admin@x.test');

    const rpc = state.calls.find((c) => c.table === 'rpc');
    expect(rpc).toMatchObject({ op: 'get_product_blockers', args: [{ p_product_id: 'p1' }] });
  });

  it('blocks (409) when the RPC returns open orders - direct, via combo or allocation - and deletes nothing', async () => {
    state.blockers = [
      { order_id: 'o1', order_number: 'ORD-1', status: 'pending', payment_status: 'pending', via: 'direct' },
      { order_id: 'o2', order_number: 'ORD-2', status: 'processing', payment_status: 'validated', via: 'combo' }
    ];

    const error = await deleteProduct('p1').catch((e) => e);

    expect(error).toMatchObject({ code: 'CONFLICT', httpStatus: 409 });
    expect(error.context.blockingOrders).toEqual([
      expect.objectContaining({ orderId: 'o1', orderNumber: 'ORD-1', via: 'direct' }),
      expect.objectContaining({ orderId: 'o2', orderNumber: 'ORD-2', via: 'combo' })
    ]);
    expect(deletes()).toEqual([]);
  });

  it('still blocks when the product has NO inventory rows (the old early return skipped the check)', async () => {
    state.inventory = [];
    state.blockers = [{ order_id: 'o1', order_number: 'ORD-1', status: 'pending', payment_status: 'pending', via: 'direct' }];

    await expect(deleteProduct('p1')).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(deletes()).toEqual([]);
  });

  it('fails closed when the RPC errors: nothing is deleted', async () => {
    state.rpcError = { code: '42501', message: 'denied' };

    await expect(deleteProduct('p1')).rejects.toBeTruthy();
    expect(deletes()).toEqual([]);
  });

  it('deletes when there are no blockers', async () => {
    const result = await deleteProduct('p1');

    expect(result.success).toBe(true);
    expect(deletes().map((c) => c.table)).toEqual(expect.arrayContaining(['inventory_movements', 'inventory', 'products']));
  });
});

describe('deleteCombo order lookup (mislabelled combos)', () => {
  it('does not filter order_items by item_type, so a combo stored as item_type product is still found', async () => {
    await deleteCombo('c1').catch(() => {});

    const eqs = state.calls.filter((c) => c.table === 'order_items' && c.op === 'eq').map((c) => c.args);
    expect(eqs).toContainEqual(['item_id', 'c1']);
    expect(eqs).not.toContainEqual(['item_type', 'combo']);
  });
});
