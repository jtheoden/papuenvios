import { describe, it, expect, vi, beforeEach } from 'vitest';

// Records every table call and serves rpc results from state.
const state = {
  rpc: {},
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
  c.then = (resolve) => resolve({ data: [], error: null });
  return c;
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table) => chain(table),
    rpc: vi.fn(async (name, args) => {
      state.calls.push({ table: 'rpc', op: name, args: [args] });
      const responder = state.rpc[name];
      return responder ? responder(args) : { data: null, error: null };
    })
  }
}));
vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));

import { deleteProduct } from '@/lib/productService';
import { deleteCombo } from '@/lib/comboService';

const writes = () => state.calls.filter((c) => ['delete', 'update'].includes(c.op));
const rpcNames = () => state.calls.filter((c) => c.table === 'rpc').map((c) => c.op);

const blocker = (extra = {}) => ({
  order_id: 'o1', order_number: 'ORD-1', status: 'pending', payment_status: 'pending', via: 'direct', ...extra
});

beforeEach(() => {
  state.rpc = {};
  state.calls = [];
});

describe('deleteProduct is one transactional RPC (delete_product)', () => {
  it('calls delete_product and nothing else: no client-side deletes, no ledger deletes', async () => {
    state.rpc.delete_product = () => ({
      data: { ok: true, product_name: 'Item', deactivated_combos: [{ id: 'c1', name: 'Combo' }] },
      error: null
    });

    const result = await deleteProduct('p1', 'admin@x.test');

    expect(rpcNames()).toEqual(['delete_product']);
    expect(state.calls.find((c) => c.table === 'rpc').args).toEqual([{ p_product_id: 'p1' }]);
    expect(writes()).toEqual([]);
    expect(result).toMatchObject({
      success: true,
      deletedProduct: { id: 'p1', name: 'Item' },
      deactivatedCombos: [{ id: 'c1', name: 'Combo' }]
    });
  });

  it('maps blocking_orders to a 409 CONFLICT with the blockers (front error mapping kept)', async () => {
    state.rpc.delete_product = () => ({
      data: { ok: false, reason: 'blocking_orders', blockers: [blocker(), blocker({ order_id: 'o2', order_number: 'ORD-2', via: 'combo' })] },
      error: null
    });

    const error = await deleteProduct('p1').catch((e) => e);

    expect(error).toMatchObject({ code: 'CONFLICT', httpStatus: 409 });
    expect(error.context.blockingOrders).toEqual([
      expect.objectContaining({ orderId: 'o1', orderNumber: 'ORD-1', via: 'direct' }),
      expect.objectContaining({ orderId: 'o2', orderNumber: 'ORD-2', via: 'combo' })
    ]);
    expect(error.context.blockingOrderCount).toBe(2);
  });

  it('maps not_found to a NOT_FOUND-style error and fails closed on RPC errors', async () => {
    state.rpc.delete_product = () => ({ data: { ok: false, reason: 'not_found' }, error: null });
    await expect(deleteProduct('p1')).rejects.toBeTruthy();

    state.rpc.delete_product = () => ({ data: null, error: { code: '42501', message: 'denied' } });
    await expect(deleteProduct('p1')).rejects.toBeTruthy();
    expect(writes()).toEqual([]);
  });
});

describe('deleteCombo fails closed through get_combo_blockers', () => {
  it('asks the RPC and, when there are no blockers, deletes items and combo only (no order_items update)', async () => {
    state.rpc.get_combo_blockers = () => ({ data: [], error: null });

    const result = await deleteCombo('c1');

    expect(state.calls.find((c) => c.table === 'rpc')).toMatchObject({ op: 'get_combo_blockers', args: [{ p_combo_id: 'c1' }] });
    expect(result.success).toBe(true);
    expect(state.calls.filter((c) => c.table === 'order_items')).toEqual([]);
    expect(writes().map((c) => c.table)).toEqual(['combo_items', 'combo_products']);
  });

  it('blocks (409) on open orders returned by the RPC and deletes nothing', async () => {
    state.rpc.get_combo_blockers = () => ({ data: [blocker()], error: null });

    const error = await deleteCombo('c1').catch((e) => e);

    expect(error).toMatchObject({ code: 'CONFLICT', httpStatus: 409 });
    expect(error.context.blockingOrders).toEqual([expect.objectContaining({ orderNumber: 'ORD-1' })]);
    expect(writes()).toEqual([]);
  });

  it('error path: an RPC failure blocks the delete (fail closed, the old code returned "no blockers")', async () => {
    state.rpc.get_combo_blockers = () => ({ data: null, error: { code: '42501', message: 'denied' } });

    await expect(deleteCombo('c1')).rejects.toBeTruthy();
    expect(writes()).toEqual([]);
  });
});
