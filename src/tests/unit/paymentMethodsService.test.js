import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = {
  rpc: vi.fn(),
  tables: {},
};

const queryFor = (table) => {
  const result = () => state.tables[table] ?? { data: [], error: null };
  const builder = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    in: vi.fn(() => builder),
    then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
  };
  return builder;
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args) => state.rpc(...args),
    from: (table) => queryFor(table),
  },
}));

import {
  PAYMENT_FLOWS,
  PAYMENT_METHOD_ERROR,
  PaymentMethodError,
  classifyPaymentMethodError,
  isPaymentMethodDisabledError,
  isPaymentMethodEnabled,
  isFlowBlocked,
  listPaymentMethods,
  listPaymentMethodsForAdmin,
  setPaymentMethodEnabled,
} from '@/lib/paymentMethodsService';

const ROWS = [
  { code: 'bizum', available: false, enabled_for_orders: false, enabled_for_remittances: false },
  { code: 'zelle', available: true, enabled_for_orders: true, enabled_for_remittances: false },
];

beforeEach(() => {
  state.rpc = vi.fn();
  state.tables = {};
});

describe('classifyPaymentMethodError', () => {
  it.each([
    ['payment_method_disabled', PAYMENT_METHOD_ERROR.DISABLED],
    ['payment_method_last_enabled', PAYMENT_METHOD_ERROR.LAST_ENABLED],
    ['payment_method_unavailable', PAYMENT_METHOD_ERROR.UNAVAILABLE],
    ['payment_method_forbidden', PAYMENT_METHOD_ERROR.FORBIDDEN],
    ['payment_method_not_found', PAYMENT_METHOD_ERROR.NOT_FOUND],
    ['payment_method_invalid_flow', PAYMENT_METHOD_ERROR.INVALID_FLOW],
    ['payment_method_reason_too_long', PAYMENT_METHOD_ERROR.REASON_TOO_LONG],
  ])('maps %s', (message, expected) => {
    expect(classifyPaymentMethodError({ code: 'P0001', message })).toBe(expected);
  });

  it('also reads the PostgREST details field', () => {
    expect(classifyPaymentMethodError({ details: 'payment_method_disabled' })).toBe(
      PAYMENT_METHOD_ERROR.DISABLED
    );
  });

  it('falls back to unknown for anything else, including nullish input', () => {
    expect(classifyPaymentMethodError({ message: 'boom' })).toBe(PAYMENT_METHOD_ERROR.UNKNOWN);
    expect(classifyPaymentMethodError(null)).toBe(PAYMENT_METHOD_ERROR.UNKNOWN);
  });

  it('detects the creation-guard rejection on raw and wrapped errors', () => {
    expect(isPaymentMethodDisabledError({ code: 'P0001', message: 'payment_method_disabled' })).toBe(true);
    expect(isPaymentMethodDisabledError(new PaymentMethodError(PAYMENT_METHOD_ERROR.DISABLED, 'x'))).toBe(true);
    expect(isPaymentMethodDisabledError(new Error('network'))).toBe(false);
    expect(isPaymentMethodDisabledError(null)).toBe(false);
  });
});

describe('isPaymentMethodEnabled / isFlowBlocked', () => {
  it('reads the flag of the requested flow', () => {
    expect(isPaymentMethodEnabled(ROWS, 'zelle', PAYMENT_FLOWS.ORDERS)).toBe(true);
    expect(isPaymentMethodEnabled(ROWS, 'zelle', PAYMENT_FLOWS.REMITTANCES)).toBe(false);
  });

  it('treats an unavailable method as disabled', () => {
    expect(isPaymentMethodEnabled(ROWS, 'bizum', PAYMENT_FLOWS.ORDERS)).toBe(false);
  });

  it('fails open when the list is unknown (the DB trigger is the real guard)', () => {
    expect(isPaymentMethodEnabled(null, 'zelle', PAYMENT_FLOWS.ORDERS)).toBe(true);
    expect(isPaymentMethodEnabled(undefined, 'zelle', PAYMENT_FLOWS.ORDERS)).toBe(true);
    expect(isFlowBlocked(null, PAYMENT_FLOWS.ORDERS)).toBe(false);
  });

  it('reports a blocked flow only when no available method is enabled for it', () => {
    expect(isFlowBlocked(ROWS, PAYMENT_FLOWS.ORDERS)).toBe(false);
    expect(isFlowBlocked(ROWS, PAYMENT_FLOWS.REMITTANCES)).toBe(true);
  });

  it('treats a method missing from a loaded list as disabled', () => {
    expect(isPaymentMethodEnabled([], 'zelle', PAYMENT_FLOWS.ORDERS)).toBe(false);
  });
});

describe('listPaymentMethods', () => {
  it('calls the public RPC and returns the rows', async () => {
    state.rpc.mockResolvedValue({ data: ROWS, error: null });
    await expect(listPaymentMethods()).resolves.toEqual(ROWS);
    expect(state.rpc).toHaveBeenCalledWith('list_payment_methods_public');
  });

  it('returns [] when the RPC returns null data', async () => {
    state.rpc.mockResolvedValue({ data: null, error: null });
    await expect(listPaymentMethods()).resolves.toEqual([]);
  });

  it('throws a typed error when the RPC fails', async () => {
    state.rpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function in the schema cache' },
    });
    const error = await listPaymentMethods().catch((e) => e);
    expect(error).toBeInstanceOf(PaymentMethodError);
    expect(error.kind).toBe(PAYMENT_METHOD_ERROR.UNKNOWN);
    expect(error.context.schemaMissing).toBe(true);
  });

  it('wraps a thrown client error (e.g. missing rpc function) in a typed error', async () => {
    state.rpc = undefined;
    const error = await listPaymentMethods().catch((e) => e);
    expect(error).toBeInstanceOf(PaymentMethodError);
  });
});

describe('listPaymentMethodsForAdmin', () => {
  it('reads the table and resolves the names of the admins who last changed a row', async () => {
    state.tables.payment_methods = {
      data: [
        { code: 'zelle', available: true, enabled_for_orders: false, enabled_for_remittances: true, disabled_reason: 'maintenance', updated_at: '2026-10-14T16:00:00Z', updated_by: 'admin-1' },
        { code: 'bizum', available: false, enabled_for_orders: false, enabled_for_remittances: false, disabled_reason: null, updated_at: '2026-10-14T10:00:00Z', updated_by: null },
      ],
      error: null,
    };
    state.tables.user_profiles = { data: [{ id: 'admin-1', full_name: 'Ana Admin' }], error: null };

    const rows = await listPaymentMethodsForAdmin();

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ code: 'zelle', updated_by_name: 'Ana Admin', disabled_reason: 'maintenance' });
    expect(rows[1].updated_by_name).toBeNull();
  });

  it('keeps the rows when the name lookup fails', async () => {
    state.tables.payment_methods = {
      data: [{ code: 'zelle', available: true, enabled_for_orders: true, enabled_for_remittances: true, disabled_reason: null, updated_at: 'x', updated_by: 'admin-1' }],
      error: null,
    };
    state.tables.user_profiles = { data: null, error: { message: 'denied' } };

    const rows = await listPaymentMethodsForAdmin();
    expect(rows[0].updated_by_name).toBeNull();
  });

  it('throws a typed error when the table read fails', async () => {
    state.tables.payment_methods = { data: null, error: { code: '42P01', message: 'relation does not exist' } };
    const error = await listPaymentMethodsForAdmin().catch((e) => e);
    expect(error).toBeInstanceOf(PaymentMethodError);
    expect(error.context.schemaMissing).toBe(true);
  });
});

describe('setPaymentMethodEnabled', () => {
  it('calls the toggle RPC with the agreed parameter names', async () => {
    const updated = { code: 'zelle', enabled_for_orders: false };
    state.rpc.mockResolvedValue({ data: updated, error: null });

    const result = await setPaymentMethodEnabled({
      code: 'zelle',
      flow: PAYMENT_FLOWS.ORDERS,
      enabled: false,
      reason: 'maintenance',
      confirmLast: true,
    });

    expect(result).toEqual(updated);
    expect(state.rpc).toHaveBeenCalledWith('set_payment_method_enabled', {
      p_code: 'zelle',
      p_flow: 'orders',
      p_enabled: false,
      p_reason: 'maintenance',
      p_confirm_last: true,
    });
  });

  it('defaults reason to null and confirmLast to false', async () => {
    state.rpc.mockResolvedValue({ data: {}, error: null });
    await setPaymentMethodEnabled({ code: 'zelle', flow: 'orders', enabled: true });
    expect(state.rpc).toHaveBeenCalledWith('set_payment_method_enabled', {
      p_code: 'zelle',
      p_flow: 'orders',
      p_enabled: true,
      p_reason: null,
      p_confirm_last: false,
    });
  });

  it('rejects an invalid flow locally without a round trip', async () => {
    const error = await setPaymentMethodEnabled({ code: 'zelle', flow: 'nope', enabled: true }).catch((e) => e);
    expect(error).toBeInstanceOf(PaymentMethodError);
    expect(error.kind).toBe(PAYMENT_METHOD_ERROR.INVALID_FLOW);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('maps the last-method rejection to a typed error', async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'payment_method_last_enabled' } });
    const error = await setPaymentMethodEnabled({ code: 'zelle', flow: 'orders', enabled: false }).catch((e) => e);
    expect(error).toBeInstanceOf(PaymentMethodError);
    expect(error.kind).toBe(PAYMENT_METHOD_ERROR.LAST_ENABLED);
  });

  it('maps a permission failure to forbidden', async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'payment_method_forbidden' } });
    const error = await setPaymentMethodEnabled({ code: 'zelle', flow: 'orders', enabled: false }).catch((e) => e);
    expect(error.kind).toBe(PAYMENT_METHOD_ERROR.FORBIDDEN);
  });
});
