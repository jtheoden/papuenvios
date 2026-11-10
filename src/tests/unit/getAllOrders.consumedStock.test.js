import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { orders: [], consumedIds: [], rpcError: null, rpcCalls: [], tableCalls: [] };

const chain = (table) => {
  const c = {};
  c.select = vi.fn(() => c);
  c.order = vi.fn(() => c);
  c.eq = vi.fn(() => c);
  c.in = vi.fn(() => c);
  c.then = (resolve) => {
    state.tableCalls.push(table);
    if (table === 'orders') return resolve({ data: state.orders, error: null });
    return resolve({ data: [], error: null }); // user_profiles etc.
  };
  return c;
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (t) => chain(t),
    rpc: vi.fn(async (name, args) => {
      state.rpcCalls.push({ name, args });
      return state.rpcError
        ? { data: null, error: state.rpcError }
        : { data: state.consumedIds.map((id) => ({ order_id: id })), error: null };
    })
  }
}));
vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/orderDiscountService', () => ({ getUserCategoryWithDiscount: vi.fn(), recordOfferUsage: vi.fn() }));
vi.mock('@/lib/zelleService', () => ({ ZELLE_STATUS: {}, ZELLE_TRANSACTION_TYPES: {}, upsertZelleTransactionStatus: vi.fn() }));

import { getAllOrders } from '@/lib/orderService';

const order = (id, status, extra = {}) => ({ id, user_id: 'u1', status, stock_managed: true, order_items: [], ...extra });

beforeEach(() => {
  state.orders = [];
  state.consumedIds = [];
  state.rpcError = null;
  state.rpcCalls = [];
  state.tableCalls = [];
});

describe('getAllOrders flags cancelled orders that own consumed allocations (admin RPC, not a URL query)', () => {
  it('sets has_consumed_stock only for cancelled orders the RPC returns', async () => {
    state.orders = [order('c1', 'cancelled'), order('c2', 'cancelled'), order('p1', 'processing')];
    state.consumedIds = ['c1'];

    const result = await getAllOrders();

    const byId = Object.fromEntries(result.map((o) => [o.id, o]));
    expect(byId.c1.has_consumed_stock).toBe(true);
    expect(byId.c2.has_consumed_stock).toBe(false);
    expect(byId.p1.has_consumed_stock).toBe(false);
  });

  it('sends the ids in the RPC body in ONE call - 300 cancelled orders - and never reads the allocations table', async () => {
    state.orders = Array.from({ length: 300 }, (_, i) => order(`c${i}`, 'cancelled'));
    state.consumedIds = ['c299'];

    const result = await getAllOrders();

    expect(state.rpcCalls).toHaveLength(1);
    expect(state.rpcCalls[0].name).toBe('orders_with_consumed_stock');
    expect(state.rpcCalls[0].args.p_order_ids).toHaveLength(300);
    expect(state.tableCalls).not.toContain('order_stock_allocations');
    expect(result.find((o) => o.id === 'c299').has_consumed_stock).toBe(true);
  });

  it('skips the call when nothing is cancelled', async () => {
    state.orders = [order('p1', 'pending')];

    await getAllOrders();

    expect(state.rpcCalls).toHaveLength(0);
  });

  it('a failing RPC never breaks the order list (flag stays false)', async () => {
    state.orders = [order('c1', 'cancelled')];
    state.rpcError = { code: 'XX000', message: 'boom' };

    const result = await getAllOrders();

    expect(result).toHaveLength(1);
    expect(result[0].has_consumed_stock).toBe(false);
  });
});
