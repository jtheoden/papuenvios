import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcMock = vi.fn();
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...args) => rpcMock(...args) } }));
const logActivityMock = vi.fn(async () => ({ status: 'ok' }));
vi.mock('@/lib/activityLogger', () => ({ logActivity: (...a) => logActivityMock(...a) }));

import {
  STOCK_POLICY_DEFAULTS,
  STOCK_POLICY_BOUNDS,
  validateStockPolicy,
  getStockPolicy,
  setStockPolicy,
  resetStockPolicy
} from '@/lib/stockPolicyService';

const SERVER_POLICY = {
  unpaid_hours: 48,
  proof_hours: 168,
  max_open_reservations: 5,
  defaults: { unpaid_hours: 48, proof_hours: 168, max_open_reservations: 5 },
  bounds: {
    unpaid_hours: { min: 6, max: 720 },
    proof_hours: { min: 24, max: 2160 },
    max_open_reservations: { min: 1, max: 50 }
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  rpcMock.mockResolvedValue({ data: SERVER_POLICY, error: null });
});

describe('constants', () => {
  it('mirror the approved defaults and bounds', () => {
    expect(STOCK_POLICY_DEFAULTS).toEqual({ unpaidHours: 48, proofHours: 168, maxOpenReservations: 5 });
    expect(STOCK_POLICY_BOUNDS.unpaidHours).toEqual({ min: 6, max: 720 });
    expect(STOCK_POLICY_BOUNDS.proofHours).toEqual({ min: 24, max: 2160 });
    expect(STOCK_POLICY_BOUNDS.maxOpenReservations).toEqual({ min: 1, max: 50 });
  });
});

describe('validateStockPolicy', () => {
  const ok = { unpaidHours: 48, proofHours: 168, maxOpenReservations: 5 };

  it('returns no errors for valid values, including the exact bounds', () => {
    expect(validateStockPolicy(ok)).toEqual({});
    expect(validateStockPolicy({ unpaidHours: 6, proofHours: 24, maxOpenReservations: 1 })).toEqual({});
    expect(validateStockPolicy({ unpaidHours: 720, proofHours: 2160, maxOpenReservations: 50 })).toEqual({});
  });

  it.each([
    ['unpaidHours', 5],
    ['unpaidHours', 721],
    ['unpaidHours', 12.5],
    ['unpaidHours', ''],
    ['proofHours', 23],
    ['proofHours', 2161],
    ['maxOpenReservations', 0],
    ['maxOpenReservations', 51],
    ['maxOpenReservations', 'abc']
  ])('flags %s = %j as out of range', (field, value) => {
    expect(validateStockPolicy({ ...ok, [field]: value })[field]).toBe('range');
  });

  it('flags a proof window shorter than the unpaid window', () => {
    expect(validateStockPolicy({ ...ok, unpaidHours: 100, proofHours: 50 })).toEqual({ proofHours: 'belowUnpaid' });
  });
});

describe('getStockPolicy', () => {
  it('maps the RPC payload to camelCase', async () => {
    const policy = await getStockPolicy();

    expect(rpcMock).toHaveBeenCalledWith('get_stock_policy');
    expect(policy).toMatchObject({
      unpaidHours: 48,
      proofHours: 168,
      maxOpenReservations: 5,
      defaults: { unpaidHours: 48, proofHours: 168, maxOpenReservations: 5 },
      bounds: { unpaidHours: { min: 6, max: 720 } }
    });
  });

  it('throws a typed FORBIDDEN error for non-admins', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: '42501', message: 'not_authorized' } });

    await expect(getStockPolicy()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('setStockPolicy', () => {
  const values = { unpaidHours: 12, proofHours: 72, maxOpenReservations: 3 };

  it('validates locally and never calls the RPC with invalid values', async () => {
    await expect(setStockPolicy({ ...values, unpaidHours: 1 })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('calls set_stock_policy (auditing happens in the database, not the client)', async () => {
    rpcMock.mockResolvedValue({
      data: { ...SERVER_POLICY, unpaid_hours: 12, proof_hours: 72, max_open_reservations: 3 },
      error: null
    });

    const result = await setStockPolicy(values, { previous: STOCK_POLICY_DEFAULTS, performedBy: 'root@x.test' });

    expect(rpcMock).toHaveBeenCalledWith('set_stock_policy', {
      p_unpaid_hours: 12,
      p_proof_hours: 72,
      p_max_open: 3
    });
    expect(result).toMatchObject({ unpaidHours: 12, proofHours: 72, maxOpenReservations: 3 });
    // The audit row is written by the database inside set_stock_policy: the client logs nothing.
    expect(logActivityMock).not.toHaveBeenCalled();
  });

  it('maps 42501 / 22023 to typed errors', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: '42501', message: 'not_authorized' } });
    await expect(setStockPolicy(values)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    rpcMock.mockResolvedValue({ data: null, error: { code: '22023', message: 'invalid_unpaid_hours' } });
    await expect(setStockPolicy(values)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    expect(logActivityMock).not.toHaveBeenCalled();
  });
});

describe('resetStockPolicy', () => {
  it('calls reset_stock_policy (no client-side logging)', async () => {
    const result = await resetStockPolicy({ previous: { unpaidHours: 12, proofHours: 72, maxOpenReservations: 3 } });

    expect(rpcMock).toHaveBeenCalledWith('reset_stock_policy');
    expect(result.unpaidHours).toBe(48);
    expect(logActivityMock).not.toHaveBeenCalled();
  });
});
