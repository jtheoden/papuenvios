import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcMock = vi.fn();
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a) => rpcMock(...a) } }));
const logErrorMock = vi.fn();
vi.mock('@/lib/errorHandler', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, logError: (...a) => logErrorMock(...a) };
});

import { callTransitionRpc, mapTransitionError, isStatusConflictError, transitionErrorKey, transitionMessage } from '@/lib/statusTransition';
import { ERROR_CODES } from '@/lib/errorHandler';
import { isInsufficientStockError, isStockReservationRefusal } from '@/lib/stockErrors';

const ctx = { entity: 'Order', id: 'o-1' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('callTransitionRpc', () => {
  it('calls the RPC with the arguments and returns the row', async () => {
    rpcMock.mockResolvedValue({ data: { id: 'o-1', status: 'processing' }, error: null });
    const row = await callTransitionRpc('order_validate_payment', { p_order_id: 'o-1' }, ctx);
    expect(rpcMock).toHaveBeenCalledWith('order_validate_payment', { p_order_id: 'o-1' });
    expect(row).toEqual({ id: 'o-1', status: 'processing' });
  });

  it('throws the mapped error and logs it', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: '22023', message: 'invalid_transition', details: '{"status":"processing"}' } });
    await expect(callTransitionRpc('order_validate_payment', { p_order_id: 'o-1' }, ctx)).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
    expect(logErrorMock).toHaveBeenCalled();
  });
});

describe('mapTransitionError', () => {
  it('22023 invalid_transition -> CONFLICT carrying the current state, recognised by isStatusConflictError', () => {
    const e = mapTransitionError({ code: '22023', message: 'invalid_transition', details: '{"status":"processing","payment_status":"validated","action":"validate_payment"}' }, ctx);
    expect(e.code).toBe(ERROR_CODES.CONFLICT);
    expect(e.httpStatus).toBe(409);
    expect(e.context).toMatchObject({ reason: 'invalid_transition', current: { status: 'processing' } });
    expect(isStatusConflictError(e)).toBe(true);
  });

  it('22023 invalid_argument -> VALIDATION_FAILED naming the field', () => {
    const e = mapTransitionError({ code: '22023', message: 'invalid_argument', details: 'reason' }, ctx);
    expect(e.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(e.context.fieldErrors).toHaveProperty('reason');
    expect(isStatusConflictError(e)).toBe(false);
  });

  it('P0001 stock_refused -> the typed stock error the UI already understands', () => {
    const e = mapTransitionError({ code: 'P0001', message: 'stock_refused', details: '{"ok":false,"reason":"insufficient_stock","product_id":"p1","available":2}' }, ctx);
    expect(isInsufficientStockError(e)).toBe(true);
    expect(e.context).toMatchObject({ reason: 'insufficient_stock', productId: 'p1', available: 2, orderId: 'o-1' });
  });

  it('P0001 stock_refused with a reservation refusal keeps context.reason for isStockReservationRefusal', () => {
    const e = mapTransitionError({ code: 'P0001', message: 'stock_refused', details: '{"ok":false,"reason":"too_many_open_reservations"}' }, ctx);
    expect(isStockReservationRefusal(e)).toBe(true);
    expect(isInsufficientStockError(e)).toBe(false);
  });

  it('P0001 stock_refused with unparseable details still yields a stock error', () => {
    const e = mapTransitionError({ code: 'P0001', message: 'stock_refused', details: 'garbage' }, ctx);
    expect(e.context.reason).toBe('unknown');
  });

  it('42501 -> FORBIDDEN, P0002 -> NOT_FOUND', () => {
    expect(mapTransitionError({ code: '42501', message: 'not_authorized' }, ctx).code).toBe(ERROR_CODES.FORBIDDEN);
    expect(mapTransitionError({ code: 'P0002', message: 'order_not_found' }, ctx).code).toBe(ERROR_CODES.NOT_FOUND);
  });

  it('anything else falls back to the generic parser', () => {
    const e = mapTransitionError({ code: '08006', message: 'connection failure' }, ctx);
    expect(e.code).not.toBe(ERROR_CODES.CONFLICT);
  });
});

describe('transitionErrorKey (toast message key)', () => {
  const conflict = mapTransitionError({ code: '22023', message: 'invalid_transition', details: '{}' }, ctx);

  it('uses the status-conflict message when the row moved under the user', () => {
    expect(transitionErrorKey(conflict)).toBe('common.statusConflict');
  });

  it('falls back to the caller key (default common.error) for anything else', () => {
    expect(transitionErrorKey(new Error('x'))).toBe('common.error');
    expect(transitionErrorKey(null, 'adminOrders.messages.restockError')).toBe('adminOrders.messages.restockError');
  });
});

describe('42501 reasons are translated, never shown raw', () => {
  const forbidden = (message) => mapTransitionError({ code: '42501', message }, ctx);

  it('not_authorized and user_disabled map to their own keys', () => {
    expect(transitionErrorKey(forbidden('not_authorized'))).toBe('common.statusNotAuthorized');
    expect(transitionErrorKey(forbidden('user_disabled'))).toBe('common.statusUserDisabled');
  });

  it('an unknown 42501 keeps the fallback', () => {
    expect(transitionErrorKey(forbidden('permission denied for table x'), 'common.error')).toBe('common.error');
  });

  it('transitionMessage translates known reasons and otherwise returns the given fallback text', () => {
    const t = (k) => `T:${k}`;
    expect(transitionMessage(t, forbidden('not_authorized'), 'raw')).toBe('T:common.statusNotAuthorized');
    expect(transitionMessage(t, mapTransitionError({ code: '22023', message: 'invalid_transition', details: '{}' }, ctx), 'raw')).toBe('T:common.statusConflict');
    expect(transitionMessage(t, new Error('boom'), 'fallback text')).toBe('fallback text');
  });
});
