import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Supabase mock: records every call in order so flows can be asserted, and
// serves `rpc` from a per-test responder map.
// ---------------------------------------------------------------------------
const BASE_ORDER = {
  id: 'ord-1',
  order_number: 'ORD-1',
  user_id: 'user-1',
  status: 'pending',
  payment_status: 'proof_uploaded',
  payment_method: 'zelle',
  total_amount: 10,
  order_type: 'product',
  zelle_account_id: null,
  order_items: [
    { id: 'oi-1', item_type: 'product', item_id: 'p1', quantity: 2, inventory_id: null }
  ]
};

const state = {
  consumedRows: [],
  consumedError: null,
  log: [],
  order: { ...BASE_ORDER },
  updates: [],
  rpc: {}
};

const makeQuery = (table) => {
  let lastPayload = null;
  const q = {
    select: () => q,
    eq: () => q,
    in: () => q,
    limit: () => q,
    insert: (payload) => {
      state.log.push(`${table}:insert`);
      lastPayload = payload;
      return q;
    },
    update: (payload) => {
      state.log.push(`${table}:update`);
      state.updates.push({ table, payload });
      lastPayload = payload;
      return q;
    },
    single: async () => {
      if (table === 'orders') {
        return { data: { ...state.order, ...(lastPayload && !Array.isArray(lastPayload) ? lastPayload : {}) }, error: null };
      }
      return { data: { email: 'a@b.test' }, error: null };
    },
    then: (resolve) => {
      if (table === 'order_stock_allocations') {
        state.log.push('allocations:select');
        return resolve({ data: state.consumedError ? null : state.consumedRows, error: state.consumedError });
      }
      return resolve({
        data: table === 'order_items' ? [{ id: 'oi-new' }] : [],
        error: null
      });
    }
  };
  return q;
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table) => makeQuery(table)),
    rpc: vi.fn(async (name, args) => {
      state.log.push(`rpc:${name}`);
      const responder = state.rpc[name];
      if (responder) return responder(args);
      // order_* transition RPCs answer with the fresh order row
      if (name.startsWith('order_')) return { data: { ...state.order, id: args.p_order_id }, error: null };
      return { data: { ok: true, reason: null }, error: null };
    })
  }
}));

vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn(async () => ({ success: true })) }));
vi.mock('@/lib/orderDiscountService', () => ({ getUserCategoryWithDiscount: vi.fn(), recordOfferUsage: vi.fn() }));
vi.mock('@/lib/zelleService', () => ({
  ZELLE_STATUS: {},
  ZELLE_TRANSACTION_TYPES: {},
  upsertZelleTransactionStatus: vi.fn()
}));

import { supabase } from '@/lib/supabase';
import * as errorHandler from '@/lib/errorHandler';
import {
  createOrder,
  cancelOrder,
  cancelOrderByUser,
  rejectPayment,
  validatePayment,
  reopenOrder,
  restockOrder,
  isInsufficientStockError
} from '@/lib/orderService';

const logErrorSpy = vi.spyOn(errorHandler, 'logError');

const rpcCalls = (name) =>
  supabase.rpc.mock.calls.filter(([n]) => n === name).map(([, args]) => args);

const okResult = (extra = {}) => ({ data: { ok: true, reason: null, ...extra }, error: null });
const insufficient = { data: { ok: false, reason: 'insufficient_stock', product_id: 'p1', available: 1 }, error: null };

const orderData = { userId: 'user-1', totalAmount: 10, currencyId: 'c1', payerPhone: '+1 305 555 0100' };
const items = [
  { itemType: 'product', itemId: 'p1', nameEs: 'a', nameEn: 'a', quantity: 2, unitPrice: 5, totalPrice: 10 }
];

beforeEach(() => {
  vi.clearAllMocks();
  state.log = [];
  state.updates = [];
  state.rpc = {};
  state.consumedRows = [];
  state.consumedError = null;
  state.order = { ...BASE_ORDER, order_items: [...BASE_ORDER.order_items] };
});

describe('createOrder stock reservation', () => {
  it('reserves through the RPC AFTER inserting order and items, and never touches inventory from the client', async () => {
    const created = await createOrder(orderData, items);

    expect(created.id).toBe('ord-1');
    expect(rpcCalls('reserve_order_inventory')).toEqual([{ p_order_id: 'ord-1' }]);
    const reserveAt = state.log.indexOf('rpc:reserve_order_inventory');
    expect(state.log.indexOf('orders:insert')).toBeLessThan(state.log.indexOf('order_items:insert'));
    expect(state.log.indexOf('order_items:insert')).toBeLessThan(reserveAt);
    expect(supabase.from).not.toHaveBeenCalledWith('inventory');
    expect(supabase.from).not.toHaveBeenCalledWith('inventory_movements');
  });

  it('throws a typed INSUFFICIENT_STOCK error carrying product and availability when the RPC rejects', async () => {
    state.rpc.reserve_order_inventory = () => insufficient;

    const error = await createOrder(orderData, items).catch((e) => e);

    expect(error.code).toBe('INSUFFICIENT_STOCK');
    expect(isInsufficientStockError(error)).toBe(true);
    expect(error.context).toMatchObject({ reason: 'insufficient_stock', productId: 'p1', available: 1 });
  });

  it('maps invalid_item to a typed error as well (no silent success)', async () => {
    state.rpc.reserve_order_inventory = () => ({ data: { ok: false, reason: 'invalid_item' }, error: null });

    const error = await createOrder(orderData, items).catch((e) => e);

    expect(error.code).toBe('INSUFFICIENT_STOCK');
    expect(error.context.reason).toBe('invalid_item');
  });

  it('on a transport error from the RPC it cancels the half-created order and rethrows', async () => {
    state.rpc.reserve_order_inventory = () => ({ data: null, error: { message: 'network down', code: '57014' } });

    await expect(createOrder(orderData, items)).rejects.toBeTruthy();

    expect(rpcCalls('order_cancel')).toEqual([{ p_order_id: 'ord-1', p_reason: 'reservation_failed' }]);
    expect(state.updates.filter((u) => u.table === 'orders')).toEqual([]);
  });
});

describe('cancel flows leave the release to the database (trigger, same transaction)', () => {
  it('cancelOrder calls order_cancel once and never the release RPC or a direct UPDATE', async () => {
    await cancelOrder('ord-1', 'admin-1', 'duplicate');

    expect(rpcCalls('order_cancel')).toEqual([{ p_order_id: 'ord-1', p_reason: 'duplicate' }]);
    expect(rpcCalls('release_order_inventory')).toHaveLength(0);
    expect(state.updates.filter((u) => u.table === 'orders')).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalledWith('inventory');
  });

  it('cancelOrder surfaces a conflict when the order already moved', async () => {
    state.rpc.order_cancel = () => ({ data: null, error: { code: '22023', message: 'invalid_transition', details: '{"status":"completed"}' } });

    await expect(cancelOrder('ord-1', 'admin-1', 'duplicate')).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('cancelOrderByUser calls order_cancel once and never the release RPC', async () => {
    await cancelOrderByUser('ord-1', 'user-1');

    expect(rpcCalls('order_cancel')).toHaveLength(1);
    expect(rpcCalls('release_order_inventory')).toHaveLength(0);
  });

  it('rejectPayment keeps the order pending for a retry and therefore does NOT release', async () => {
    await rejectPayment('ord-1', 'admin-1', 'wrong amount');

    expect(rpcCalls('order_reject_payment')).toEqual([{ p_order_id: 'ord-1', p_reason: 'wrong amount' }]);
    expect(rpcCalls('release_order_inventory')).toHaveLength(0);
    expect(state.updates.filter((u) => u.table === 'orders')).toEqual([]);
  });
});

describe('validatePayment consumes the reservation inside order_validate_payment', () => {
  it('is ONE RPC: no client-side consume, no UPDATE, no inventory writes', async () => {
    await validatePayment('ord-1', 'admin-1');

    expect(rpcCalls('order_validate_payment')).toEqual([{ p_order_id: 'ord-1' }]);
    expect(rpcCalls('consume_order_inventory')).toHaveLength(0);
    expect(state.updates.filter((u) => u.table === 'orders')).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalledWith('inventory');
    expect(supabase.from).not.toHaveBeenCalledWith('combo_items');
    expect(supabase.from).not.toHaveBeenCalledWith('inventory_movements');
  });

  it('is a plain success for legacy orders (the RPC answers with the row)', async () => {
    await expect(validatePayment('ord-1', 'admin-1')).resolves.toMatchObject({ id: 'ord-1' });
  });

  it('fails loudly when stock cannot be consumed; the database rolled everything back, so there is no revert', async () => {
    state.rpc.order_validate_payment = () => ({
      data: null,
      error: { code: 'P0001', message: 'stock_refused', details: JSON.stringify({ ok: false, reason: 'insufficient_stock', product_id: 'p1', available: 1 }) }
    });

    const error = await validatePayment('ord-1', 'admin-1').catch((e) => e);

    expect(error.code).toBe('INSUFFICIENT_STOCK');
    expect(error.context).toMatchObject({ productId: 'p1', available: 1 });
    expect(state.updates).toEqual([]);
  });

  it('fails loudly on any other stock refusal', async () => {
    state.rpc.order_validate_payment = () => ({
      data: null,
      error: { code: 'P0001', message: 'stock_refused', details: JSON.stringify({ ok: false, reason: 'order_not_active' }) }
    });

    const error = await validatePayment('ord-1', 'admin-1').catch((e) => e);

    expect(error.code).toBe('INVALID_OPERATION');
  });
});

describe('reopenOrder re-reserves inside order_reopen', () => {
  beforeEach(() => {
    state.order = { ...BASE_ORDER, status: 'pending', payment_status: 'pending' };
  });

  it('is ONE RPC: no client UPDATE and no separate reserve call', async () => {
    const reopened = await reopenOrder('ord-1', 'user-1');

    expect(reopened.status).toBe('pending');
    expect(rpcCalls('order_reopen')).toEqual([{ p_order_id: 'ord-1' }]);
    expect(rpcCalls('reserve_order_inventory')).toHaveLength(0);
    expect(state.updates.filter((u) => u.table === 'orders')).toEqual([]);
  });

  it('refuses with a typed error when there is not enough stock (the order stays cancelled in the database)', async () => {
    state.rpc.order_reopen = () => ({
      data: null,
      error: { code: 'P0001', message: 'stock_refused', details: JSON.stringify({ ok: false, reason: 'insufficient_stock' }) }
    });

    const error = await reopenOrder('ord-1', 'user-1').catch((e) => e);

    expect(error.code).toBe('INSUFFICIENT_STOCK');
    expect(isInsufficientStockError(error)).toBe(true);
  });

  it('there is no admin reopen any more (ND-3)', async () => {
    const mod = await import('@/lib/orderService');
    expect(mod.reopenOrderByAdmin).toBeUndefined();
  });
});

describe('SQL / schema errors are never swallowed (migration must be applied first)', () => {
  const sqlErrors = [
    ['42P01', 'relation "order_stock_allocations" does not exist'],
    ['42703', 'column "stock_managed" does not exist'],
    ['PGRST116', 'JSON object requested, multiple (or no) rows returned'],
    ['PGRST202', 'Could not find the function public.reserve_order_inventory(p_order_id) in the schema cache'],
    [undefined, 'function public.consume_order_inventory(uuid) does not exist']
  ];

  it.each(sqlErrors)('createOrder rejects (and cancels the order) on %s', async (code, message) => {
    state.rpc.reserve_order_inventory = () => ({ data: null, error: { code, message } });

    await expect(createOrder(orderData, items)).rejects.toBeTruthy();

    expect(rpcCalls('order_cancel')).toEqual([{ p_order_id: 'ord-1', p_reason: 'reservation_failed' }]);
  });

  it.each(sqlErrors)('validatePayment rejects on %s (nothing to revert: the database transaction rolled back)', async (code, message) => {
    state.rpc.order_validate_payment = () => ({ data: null, error: { code, message } });

    await expect(validatePayment('ord-1', 'admin-1')).rejects.toBeTruthy();

    expect(state.updates).toEqual([]);
  });

  it.each(sqlErrors)('reopenOrder rejects on %s', async (code, message) => {
    state.rpc.order_reopen = () => ({ data: null, error: { code, message } });

    await expect(reopenOrder('ord-1', 'user-1')).rejects.toBeTruthy();
  });
});

describe('new refusal reasons', () => {
  it('maps too_many_open_reservations to a typed non-stock error carrying the reason', async () => {
    state.rpc.reserve_order_inventory = () => ({
      data: { ok: false, reason: 'too_many_open_reservations' },
      error: null
    });

    const error = await createOrder(orderData, items).catch((e) => e);

    expect(error.code).toBe('INVALID_OPERATION');
    expect(error.context.reason).toBe('too_many_open_reservations');
    // The server cancelled the order itself: no client-side compensation
    expect(state.updates.filter((u) => u.table === 'orders')).toEqual([]);
    expect(rpcCalls('order_cancel')).toHaveLength(0);
  });

  it('maps empty_order the same way', async () => {
    state.rpc.reserve_order_inventory = () => ({ data: { ok: false, reason: 'empty_order' }, error: null });

    const error = await createOrder(orderData, items).catch((e) => e);

    expect(error.context.reason).toBe('empty_order');
  });
});

describe('restockOrder (explicit admin decision)', () => {
  it('calls the RPC with the order id and the reason', async () => {
    state.rpc.restock_order_inventory = () => okResult({ restocked: true });

    const result = await restockOrder('ord-1', 'goods came back');

    expect(result.restocked).toBe(true);
    expect(rpcCalls('restock_order_inventory')).toEqual([{ p_order_id: 'ord-1', p_reason: 'goods came back' }]);
  });

  it('requires a reason before touching the database', async () => {
    const error = await restockOrder('ord-1', '   ').catch((e) => e);

    expect(error.code).toBeTruthy();
    expect(rpcCalls('restock_order_inventory')).toHaveLength(0);
  });

  it('throws when the RPC refuses or fails', async () => {
    state.rpc.restock_order_inventory = () => ({ data: { ok: false, reason: 'order_not_cancelled' }, error: null });
    await expect(restockOrder('ord-1', 'r')).rejects.toMatchObject({ code: 'INVALID_OPERATION' });

    state.rpc.restock_order_inventory = () => ({ data: null, error: { code: '42501', message: 'denied' } });
    await expect(restockOrder('ord-1', 'r')).rejects.toBeTruthy();
  });
});

describe('cancelOrder reports whether consumed stock may need restocking (W7: from the allocations)', () => {
  it('flags the order when it has consumed allocations', async () => {
    state.order = { ...BASE_ORDER, status: 'processing', payment_status: 'validated', stock_managed: true };
    state.consumedRows = [{ id: 'a1' }];

    const result = await cancelOrder('ord-1', 'admin-1', 'duplicate');

    expect(result.stockConsumed).toBe(true);
  });

  it('does not flag a validated order that has no consumed allocations (heuristic would have said yes)', async () => {
    state.order = { ...BASE_ORDER, status: 'processing', payment_status: 'validated', stock_managed: true };
    state.consumedRows = [];

    const result = await cancelOrder('ord-1', 'admin-1', 'duplicate');

    expect(result.stockConsumed).toBe(false);
  });

  it('does not flag when the allocations cannot be read (and logs the failure)', async () => {
    state.order = { ...BASE_ORDER, status: 'processing', payment_status: 'validated', stock_managed: true };
    state.consumedError = { code: 'XX000', message: 'boom' };

    const result = await cancelOrder('ord-1', 'admin-1', 'duplicate');

    expect(result.stockConsumed).toBe(false);
    expect(logErrorSpy).toHaveBeenCalled();
  });

  it('asks the database after the cancellation, not before', async () => {
    state.order = { ...BASE_ORDER, status: 'processing', payment_status: 'validated', stock_managed: true };

    await cancelOrder('ord-1', 'admin-1', 'duplicate');

    expect(state.log.indexOf('allocations:select')).toBeGreaterThan(state.log.indexOf('rpc:order_cancel'));
  });
});

describe('isInsufficientStockError', () => {
  it('recognises only the typed stock error', () => {
    expect(isInsufficientStockError({ code: 'INSUFFICIENT_STOCK' })).toBe(true);
    expect(isInsufficientStockError(new Error('x'))).toBe(false);
    expect(isInsufficientStockError(null)).toBe(false);
  });
});
