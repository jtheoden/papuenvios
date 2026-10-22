import { describe, it, expect, vi, beforeEach } from 'vitest';

const fromMock = vi.fn();
const getUserMock = vi.fn();
const rpcMock = vi.fn();
const updateSpy = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args) => fromMock(...args),
    rpc: (...args) => rpcMock(...args),
    auth: { getUser: (...args) => getUserMock(...args) }
  }
}));

vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn() }));

vi.mock('@/lib/zelleService', () => ({
  pickAvailableZelleAccount: vi.fn(),
  registerZelleTransaction: vi.fn(),
  upsertZelleTransactionStatus: vi.fn(),
  ZELLE_STATUS: { PENDING: 'pending', VALIDATED: 'validated', REJECTED: 'rejected' },
  ZELLE_TRANSACTION_TYPES: { REMITTANCE: 'remittance', PRODUCT: 'product', COMBO: 'combo' }
}));

vi.mock('@/lib/whatsappService', () => ({
  notifyAdminNewPaymentProof: vi.fn(),
  notifyUserPaymentValidated: vi.fn(),
  notifyUserPaymentRejected: vi.fn(),
  notifyUserRemittanceDelivered: vi.fn()
}));

vi.mock('@/lib/notificationSettingsService', () => ({ getFreshWhatsappRecipient: vi.fn() }));
vi.mock('@/lib/orderDiscountService', () => ({ recordOfferUsage: vi.fn() }));
vi.mock('@/lib/currencyService', () => ({ getExchangeRate: vi.fn() }));

import { cancelRemittance } from '@/lib/remittanceService';

const cancelled = { id: 'rem-1', remittance_number: 'REM-2026-0001', user_id: 'user-1', status: 'cancelled' };

beforeEach(() => {
  fromMock.mockReset();
  rpcMock.mockReset();
  getUserMock.mockReset();
  updateSpy.mockReset();
  fromMock.mockImplementation(() => ({
    select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: cancelled, error: null }) }) }),
    update: updateSpy
  }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

// The matrix (owner may cancel payment_pending / payment_rejected / payment_proof_uploaded only) lives in
// remittance_cancel and is covered against a real database in src/tests/concurrency/remittanceTransitions.test.js.
describe('remittanceService.cancelRemittance', () => {
  it('cancels through remittance_cancel and never writes the table directly', async () => {
    rpcMock.mockResolvedValue({ data: cancelled, error: null });

    const result = await cancelRemittance('rem-1', 'changed my mind');

    expect(result.status).toBe('cancelled');
    expect(rpcMock).toHaveBeenCalledWith('remittance_cancel', { p_remittance_id: 'rem-1', p_reason: 'changed my mind' });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('surfaces a refused transition as a CONFLICT instead of swallowing it', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: '22023', message: 'invalid_transition', details: '{"status":"processing"}' }
    });

    await expect(cancelRemittance('rem-1', 'late')).rejects.toMatchObject({
      code: 'CONFLICT',
      context: { reason: 'invalid_transition' }
    });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('requires a remittance id', async () => {
    await expect(cancelRemittance('')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
