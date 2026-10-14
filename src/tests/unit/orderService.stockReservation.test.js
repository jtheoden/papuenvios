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
  revertError: null,
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
      const isRevert = table === 'orders' && lastPayload && lastPayload.status === 'pending' && 'validated_by' in lastPayload;
      return resolve({
        data: table === 'order_items' ? [{ id: 'oi-new' }] : [],
        error: isRevert ? state.revertError : null
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
      return responder ? responder(args) : { data: { ok: true, reason: null }, error: null };
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
  reopenOrderByAdmin,
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
  state.revertError = null;
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

    const cancel = state.updates.find((u) => u.table === 'orders');
    expect(cancel.payload).toMatchObject({ status: 'cancelled', rejection_reason: 'reservation_failed' });
  });
});

describe('cancel flows release the reservation exactly once', () => {
  it('cancelOrder updates the status first and then calls release once', async () => {
    state.order.status = 'pending';

    await cancelOrder('ord-1', 'admin-1', 'duplicate');

    expect(rpcCalls('release_order_inventory')).toEqual([{ p_order_id: 'ord-1' }]);
    expect(state.log.indexOf('orders:update')).toBeLessThan(state.log.indexOf('rpc:release_order_inventory'));
    expect(supabase.from).not.toHaveBeenCalledWith('inventory');
  });

  it('cancelOrder still succeeds when the release call fails (the sweep heals the orphan)', async () => {
    state.rpc.release_order_inventory = () => ({ data: null, error: { message: 'boom' } });

    const result = await cancelOrder('ord-1', 'admin-1', 'duplicate');

    expect(result.status).toBe('cancelled');
  });

  it('cancelOrderByUser releases once after cancelling', async () => {
    await cancelOrderByUser('ord-1', 'user-1');

    expect(rpcCalls('release_order_inventory')).toHaveLength(1);
    expect(state.log.indexOf('orders:update')).toBeLessThan(state.log.indexOf('rpc:release_order_inventory'));
  });

  it('rejectPayment keeps the order pending for a retry and therefore does NOT release', async () => {
    await rejectPayment('ord-1', 'admin-1', 'wrong amount');

    expect(rpcCalls('release_order_inventory')).toHaveLength(0);
    expect(state.updates.find((u) => u.table === 'orders').payload).toMatchObject({
      status: 'pending',
      payment_status: 'rejected'
    });
  });
});

describe('validatePayment consumes the reservation', () => {
  it('updates the order, then consumes through the RPC; no client-side inventory writes', async () => {
    state.rpc.consume_order_inventory = () => okResult({ consumed: true });

    await validatePayment('ord-1', 'admin-1');

    expect(rpcCalls('consume_order_inventory')).toEqual([{ p_order_id: 'ord-1' }]);
    expect(state.log.indexOf('orders:update')).toBeLessThan(state.log.indexOf('rpc:consume_order_inventory'));
    expect(supabase.from).not.toHaveBeenCalledWith('inventory');
    expect(supabase.from).not.toHaveBeenCalledWith('combo_items');
    expect(supabase.from).not.toHaveBeenCalledWith('inventory_movements');
  });

  it('is a plain success for legacy orders (consume reports a no-op)', async () => {
    state.rpc.consume_order_inventory = () => okResult({ consumed: false, reason: 'legacy_order' });

    await expect(validatePayment('ord-1', 'admin-1')).resolves.toMatchObject({ id: 'ord-1' });
  });

  it('fails loudly when stock cannot be consumed (retry is safe: consume is idempotent)', async () => {
    state.rpc.consume_order_inventory = () => insufficient;

    const error = await validatePayment('ord-1', 'admin-1').catch((e) => e);

    expect(error.code).toBe('INSUFFICIENT_STOCK');
    // The status change is undone so the admin can retry from the original state.
    const revert = state.updates.filter((u) => u.table === 'orders').pop().payload;
    expect(revert).toMatchObject({ status: 'pending', payment_status: 'proof_uploaded' });
  });

  it('fails loudly on any other consume refusal', async () => {
    state.rpc.consume_order_inventory = () => ({ data: { ok: false, reason: 'order_not_active' }, error: null });

    const error = await validatePayment('ord-1', 'admin-1').catch((e) => e);

    expect(error.code).toBe('INVALID_OPERATION');
  });
});

describe('reopen flows re-reserve', () => {
  beforeEach(() => {
    state.order = { ...BASE_ORDER, status: 'cancelled', payment_status: 'rejected' };
  });

  it('reopenOrder sets pending, then reserves again; payload only has real orders columns', async () => {
    const reopened = await reopenOrder('ord-1', 'user-1');

    expect(reopened.status).toBe('pending');
    expect(rpcCalls('reserve_order_inventory')).toEqual([{ p_order_id: 'ord-1' }]);
    const payload = state.updates.find((u) => u.table === 'orders').payload;
    expect(payload).toMatchObject({ status: 'pending', payment_status: 'pending' });
    expect(payload).not.toHaveProperty('cancelled_by');
    expect(payload).not.toHaveProperty('cancelled_at');
    expect(payload).not.toHaveProperty('cancellation_reason');
  });

  it('reopenOrder refuses with a typed error when there is not enough stock', async () => {
    state.rpc.reserve_order_inventory = () => insufficient;

    const error = await reopenOrder('ord-1', 'user-1').catch((e) => e);

    expect(error.code).toBe('INSUFFICIENT_STOCK');
    expect(isInsufficientStockError(error)).toBe(true);
  });

  it('reopenOrderByAdmin reserves again and refuses when stock is gone', async () => {
    await reopenOrderByAdmin('ord-1', 'admin-1', 'customer asked');
    expect(rpcCalls('reserve_order_inventory')).toHaveLength(1);

    state.rpc.reserve_order_inventory = () => insufficient;
    const error = await reopenOrderByAdmin('ord-1', 'admin-1').catch((e) => e);
    expect(error.code).toBe('INSUFFICIENT_STOCK');
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

    const cancel = state.updates.find((u) => u.table === 'orders');
    expect(cancel.payload).toMatchObject({ status: 'cancelled', rejection_reason: 'reservation_failed' });
  });

  it.each(sqlErrors)('validatePayment rejects and reverts the order on %s', async (code, message) => {
    state.rpc.consume_order_inventory = () => ({ data: null, error: { code, message } });

    await expect(validatePayment('ord-1', 'admin-1')).rejects.toBeTruthy();

    const revert = state.updates.filter((u) => u.table === 'orders').pop().payload;
    expect(revert).toMatchObject({ status: 'pending', payment_status: 'proof_uploaded' });
  });

  it.each(sqlErrors)('reopenOrder rejects on %s', async (code, message) => {
    state.order = { ...BASE_ORDER, status: 'cancelled', payment_status: 'rejected' };
    state.rpc.reserve_order_inventory = () => ({ data: null, error: { code, message } });

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
  });

  it('maps empty_order the same way', async () => {
    state.rpc.reserve_order_inventory = () => ({ data: { ok: false, reason: 'empty_order' }, error: null });

    const error = await createOrder(orderData, items).catch((e) => e);

    expect(error.context.reason).toBe('empty_order');
  });
});

describe('validatePayment revert failures are logged (W6)', () => {
  it('logs the revert error instead of ignoring it, and still throws the original error', async () => {
    state.rpc.consume_order_inventory = () => insufficient;
    state.revertError = { message: 'revert denied', code: '42501' };
    logErrorSpy.mockClear();

    const error = await validatePayment('ord-1', 'admin-1').catch((e) => e);

    expect(error.code).toBe('INSUFFICIENT_STOCK');
    expect(logErrorSpy.mock.calls.some(([, ctx]) => ctx?.operation === 'validatePayment - revert')).toBe(true);
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

  it('asks the database after the release, not before', async () => {
    state.order = { ...BASE_ORDER, status: 'processing', payment_status: 'validated', stock_managed: true };

    await cancelOrder('ord-1', 'admin-1', 'duplicate');

    expect(state.log.indexOf('allocations:select')).toBeGreaterThan(state.log.indexOf('rpc:release_order_inventory'));
  });
});

describe('isInsufficientStockError', () => {
  it('recognises only the typed stock error', () => {
    expect(isInsufficientStockError({ code: 'INSUFFICIENT_STOCK' })).toBe(true);
    expect(isInsufficientStockError(new Error('x'))).toBe(false);
    expect(isInsufficientStockError(null)).toBe(false);
  });
});
