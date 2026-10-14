import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { orders: [], allocations: [], allocError: null, allocQueries: [] };

const chain = (table) => {
  const c = {};
  const q = { table, filters: [] };
  c.select = vi.fn(() => c);
  c.order = vi.fn(() => c);
  c.eq = vi.fn((...a) => { q.filters.push(['eq', ...a]); return c; });
  c.in = vi.fn((...a) => { q.filters.push(['in', ...a]); return c; });
  c.then = (resolve) => {
    if (table === 'orders') return resolve({ data: state.orders, error: null });
    if (table === 'order_stock_allocations') {
      state.allocQueries.push(q);
      return resolve({ data: state.allocError ? null : state.allocations, error: state.allocError });
    }
    return resolve({ data: [], error: null }); // user_profiles etc.
  };
  return c;
};

vi.mock('@/lib/supabase', () => ({ supabase: { from: (t) => chain(t), rpc: vi.fn() } }));
vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/orderDiscountService', () => ({ getUserCategoryWithDiscount: vi.fn(), recordOfferUsage: vi.fn() }));
vi.mock('@/lib/zelleService', () => ({ ZELLE_STATUS: {}, ZELLE_TRANSACTION_TYPES: {}, upsertZelleTransactionStatus: vi.fn() }));

import { getAllOrders } from '@/lib/orderService';

const order = (id, status, extra = {}) => ({ id, user_id: 'u1', status, stock_managed: true, order_items: [], ...extra });

beforeEach(() => {
  state.orders = [];
  state.allocations = [];
  state.allocError = null;
  state.allocQueries = [];
});

describe('getAllOrders flags cancelled orders that own consumed allocations (authoritative, not a heuristic)', () => {
  it('sets has_consumed_stock only for cancelled orders with a consumed allocation', async () => {
    state.orders = [
      order('c1', 'cancelled'),
      order('c2', 'cancelled'),
      order('p1', 'processing', { payment_status: 'validated' })
    ];
    state.allocations = [{ order_id: 'c1' }];

    const result = await getAllOrders();

    const byId = Object.fromEntries(result.map((o) => [o.id, o]));
    expect(byId.c1.has_consumed_stock).toBe(true);
    expect(byId.c2.has_consumed_stock).toBe(false);
    expect(byId.p1.has_consumed_stock).toBe(false);
  });

  it('asks the allocations table only about cancelled orders, filtered by state consumed', async () => {
    state.orders = [order('c1', 'cancelled'), order('p1', 'pending')];

    await getAllOrders();

    expect(state.allocQueries).toHaveLength(1);
    expect(state.allocQueries[0].filters).toEqual(
      expect.arrayContaining([['eq', 'state', 'consumed'], ['in', 'order_id', ['c1']]])
    );
  });

  it('skips the query when nothing is cancelled', async () => {
    state.orders = [order('p1', 'pending')];

    await getAllOrders();

    expect(state.allocQueries).toHaveLength(0);
  });

  it('a failing allocations read never breaks the order list (flag stays false)', async () => {
    state.orders = [order('c1', 'cancelled')];
    state.allocError = { code: 'XX000', message: 'boom' };

    const result = await getAllOrders();

    expect(result).toHaveLength(1);
    expect(result[0].has_consumed_stock).toBe(false);
  });
});
