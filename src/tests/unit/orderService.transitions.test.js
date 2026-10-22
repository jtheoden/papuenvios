/**
 * E6: every order status change goes through its order_* RPC (the database owns lock, matrix, stock and history).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const state = {
  rpcResults: {},
  rpcCalls: [],
  directWrites: [],
  uploads: [],
  consumed: false
};

const rpcMock = vi.fn(async (name, args) => {
  state.rpcCalls.push([name, args]);
  const configured = state.rpcResults[name];
  if (configured !== undefined) return typeof configured === 'function' ? configured(args) : configured;
  return { data: { id: args?.p_order_id ?? 'ord-1', order_number: 'ORD-20261024-100001', status: 'x', zelle_account_id: 'z1', order_type: 'product', total_amount: 10 }, error: null };
});

const makeQuery = (table) => {
  const q = {
    select: () => q,
    eq: () => q,
    limit: () => q,
    single: async () => ({ data: { id: 'ord-1', order_number: 'ORD-20261024-100001' }, error: null }),
    maybeSingle: async () => ({ data: null, error: null }),
    insert: (payload) => {
      state.directWrites.push(['insert', table, payload]);
      return q;
    },
    update: (payload) => {
      state.directWrites.push(['update', table, payload]);
      return q;
    },
    then: (resolveFn) =>
      resolveFn(table === 'order_stock_allocations' ? { data: state.consumed ? [{ id: 'a1' }] : [], error: null } : { data: [], error: null })
  };
  return q;
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((t) => makeQuery(t)),
    rpc: (...a) => rpcMock(...a),
    auth: { getUser: async () => ({ data: { user: { id: 'admin-1', email: 'a@x.test' } }, error: null }) },
    storage: {
      from: (bucket) => ({
        upload: async (path, file, opts) => {
          state.uploads.push({ bucket, path, opts });
          return { error: null };
        }
      })
    }
  }
}));

vi.mock('@/lib/errorHandler', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, logError: vi.fn() };
});
vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn(async () => ({ success: true })) }));
vi.mock('@/lib/orderDiscountService', () => ({ getUserCategoryWithDiscount: vi.fn(), recordOfferUsage: vi.fn() }));
const zelleUpsert = vi.fn(async () => ({}));
vi.mock('@/lib/zelleService', () => ({
  ZELLE_STATUS: { PENDING: 'pending', VALIDATED: 'validated', REJECTED: 'rejected' },
  ZELLE_TRANSACTION_TYPES: { PRODUCT: 'product', COMBO: 'combo', REMITTANCE: 'remittance' },
  upsertZelleTransactionStatus: (...a) => zelleUpsert(...a)
}));
vi.mock('@/lib/paymentProofService', () => ({
  PAYMENT_PROOF_MIME_EXT: { 'image/png': 'png', 'image/jpeg': 'jpg' },
  validatePaymentProofFile: () => null
}));

import {
  validatePayment,
  rejectPayment,
  startProcessingOrder,
  markOrderAsDispatched,
  markOrderAsDelivered,
  completeOrder,
  cancelOrder,
  cancelOrderByUser,
  reopenOrder,
  uploadPaymentProof,
  createOrder
} from '@/lib/orderService';
import * as orderServiceModule from '@/lib/orderService';

const png = { type: 'image/png', size: 10, name: 'p.png' };

beforeEach(() => {
  state.rpcResults = {};
  state.rpcCalls = [];
  state.directWrites = [];
  state.uploads = [];
  state.consumed = false;
  zelleUpsert.mockClear();
  vi.clearAllMocks();
});

const lastRpc = () => state.rpcCalls[state.rpcCalls.length - 1];

describe('each function calls its RPC', () => {
  it('validatePayment -> order_validate_payment, then syncs Zelle from the returned row', async () => {
    const row = await validatePayment('ord-1', 'admin-1');
    expect(state.rpcCalls[0]).toEqual(['order_validate_payment', { p_order_id: 'ord-1' }]);
    expect(row.id).toBe('ord-1');
    expect(zelleUpsert).toHaveBeenCalledWith(expect.objectContaining({ referenceId: 'ord-1', status: 'validated', zelleAccountId: 'z1', validatedBy: 'admin-1' }));
  });

  it('rejectPayment -> order_reject_payment with the reason', async () => {
    await rejectPayment('ord-1', 'admin-1', 'blurry');
    expect(state.rpcCalls[0]).toEqual(['order_reject_payment', { p_order_id: 'ord-1', p_reason: 'blurry' }]);
    expect(zelleUpsert).toHaveBeenCalledWith(expect.objectContaining({ status: 'rejected' }));
  });

  it('startProcessingOrder -> order_start_processing', async () => {
    await startProcessingOrder('ord-1', 'admin-1');
    expect(state.rpcCalls[0]).toEqual(['order_start_processing', { p_order_id: 'ord-1' }]);
  });

  it('markOrderAsDispatched -> order_dispatch with the tracking (null when empty)', async () => {
    await markOrderAsDispatched('ord-1', 'admin-1', 'TRK-1');
    expect(lastRpc()).toEqual(['order_dispatch', { p_order_id: 'ord-1', p_tracking: 'TRK-1' }]);
    await markOrderAsDispatched('ord-1', 'admin-1');
    expect(lastRpc()).toEqual(['order_dispatch', { p_order_id: 'ord-1', p_tracking: null }]);
  });

  it('markOrderAsDelivered uploads the proof first, then calls order_mark_delivered with the path', async () => {
    await markOrderAsDelivered('ord-1', png, 'admin-1');
    expect(state.uploads).toHaveLength(1);
    expect(state.uploads[0].bucket).toBe('order-delivery-proofs');
    expect(state.uploads[0].path).toMatch(/^admin-1\/ord-1\/delivery-proof-\d+\.jpg$/);
    expect(lastRpc()).toEqual(['order_mark_delivered', { p_order_id: 'ord-1', p_proof_path: state.uploads[0].path }]);
  });

  it('completeOrder -> order_complete with the notes (null when empty)', async () => {
    await completeOrder('ord-1', 'all good');
    expect(lastRpc()).toEqual(['order_complete', { p_order_id: 'ord-1', p_notes: 'all good' }]);
    await completeOrder('ord-1');
    expect(lastRpc()).toEqual(['order_complete', { p_order_id: 'ord-1', p_notes: null }]);
  });

  it('cancelOrder -> order_cancel and reports stockConsumed from the allocations', async () => {
    state.consumed = true;
    const row = await cancelOrder('ord-1', 'admin-1', 'supplier');
    expect(state.rpcCalls[0]).toEqual(['order_cancel', { p_order_id: 'ord-1', p_reason: 'supplier' }]);
    expect(row.stockConsumed).toBe(true);
    // no redundant release call: the trigger releases inside the same transaction
    expect(state.rpcCalls.map(([n]) => n)).not.toContain('release_order_inventory');
  });

  it('cancelOrderByUser -> order_cancel with the default reason', async () => {
    await cancelOrderByUser('ord-1', 'u1');
    expect(state.rpcCalls[0]).toEqual(['order_cancel', { p_order_id: 'ord-1', p_reason: 'cancelled_by_user' }]);
    expect(state.rpcCalls.map(([n]) => n)).not.toContain('release_order_inventory');
  });

  it('reopenOrder -> order_reopen only (the RPC reserves the stock itself)', async () => {
    await reopenOrder('ord-1', 'u1');
    expect(state.rpcCalls).toEqual([['order_reopen', { p_order_id: 'ord-1' }]]);
  });

  it('uploadPaymentProof uploads to the private bucket, then calls order_submit_proof and returns the path', async () => {
    const path = await uploadPaymentProof(png, 'ord-1', 'u1', ' Jane Doe ', { payerPhone: '+1 305 555 0100' });
    expect(state.uploads[0].bucket).toBe('order-documents');
    expect(state.uploads[0].path).toMatch(/^payment-proofs\/payment-proof-ord-1-\d+\.png$/);
    expect(path).toBe(state.uploads[0].path);
    const [name, args] = lastRpc();
    expect(name).toBe('order_submit_proof');
    expect(args).toMatchObject({ p_order_id: 'ord-1', p_proof_path: path, p_reference: 'Jane Doe' });
    expect(args.p_payer_phone).toMatch(/305/);
  });
});

describe('createOrder compensation', () => {
  const items = [{ itemType: 'combo', itemId: 'c1', nameEs: 'a', nameEn: 'a', quantity: 1, unitPrice: 10, totalPrice: 10 }];
  const data = { userId: 'u1', totalAmount: 10, currencyId: 'cur', paymentReference: 'J', payerPhone: '+1 305 555 0100' };

  it('a transport failure of reserve_order_inventory cancels through order_cancel, never with a direct UPDATE', async () => {
    state.rpcResults.reserve_order_inventory = { data: null, error: { code: 'XX000', message: 'rpc down' } };
    await expect(createOrder(data, items)).rejects.toBeTruthy();
    const names = state.rpcCalls.map(([n]) => n);
    expect(names).toContain('order_cancel');
    expect(state.rpcCalls.find(([n]) => n === 'order_cancel')[1]).toMatchObject({ p_reason: 'reservation_failed' });
    expect(state.directWrites.filter(([op, table]) => op === 'update' && table === 'orders')).toEqual([]);
  });
});

describe('error mapping', () => {
  it('22023 invalid_transition -> CONFLICT error carrying the current state', async () => {
    state.rpcResults.order_validate_payment = { data: null, error: { code: '22023', message: 'invalid_transition', details: '{"status":"processing","payment_status":"validated","action":"validate_payment"}' } };
    await expect(validatePayment('ord-1', 'admin-1')).rejects.toMatchObject({ code: 'CONFLICT', context: { reason: 'invalid_transition' } });
    expect(zelleUpsert).not.toHaveBeenCalled();
  });

  it('stock_refused -> the typed insufficient stock error (no manual revert needed)', async () => {
    state.rpcResults.order_validate_payment = { data: null, error: { code: 'P0001', message: 'stock_refused', details: '{"ok":false,"reason":"insufficient_stock","product_id":"p1","available":1}' } };
    await expect(validatePayment('ord-1', 'admin-1')).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    expect(state.directWrites).toEqual([]);
  });

  it('a refused reopen surfaces INSUFFICIENT_STOCK', async () => {
    state.rpcResults.order_reopen = { data: null, error: { code: 'P0001', message: 'stock_refused', details: '{"ok":false,"reason":"insufficient_stock"}' } };
    await expect(reopenOrder('ord-1', 'u1')).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
  });
});

describe('the duplicated JS state machine and the dead code are gone', () => {
  it('no longer exports updateOrderStatus or reopenOrderByAdmin', () => {
    expect(orderServiceModule.updateOrderStatus).toBeUndefined();
    expect(orderServiceModule.reopenOrderByAdmin).toBeUndefined();
  });

  it('orderService.js has no client status write: no .from(orders).update, no order_status_history, no JS matrix', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/lib/orderService.js'), 'utf8');
    expect(src).not.toMatch(/\.from\(\s*['"]orders['"]\s*\)\s*\.update\(/);
    expect(src).not.toMatch(/order_status_history/);
    expect(src).not.toMatch(/ORDER_TRANSITIONS|PAYMENT_TRANSITIONS|validateOrderTransition|validatePaymentTransition/);
  });
});
