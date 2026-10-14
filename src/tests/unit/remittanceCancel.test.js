import { describe, it, expect, vi, beforeEach } from 'vitest';

const fromMock = vi.fn();
const getUserMock = vi.fn();
const updateSpy = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args) => fromMock(...args),
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

const OWNER = { id: 'user-1', email: 'owner@example.com' };

const mockRemittanceTable = (remittance) => {
  fromMock.mockImplementation(() => ({
    select: () => ({
      eq: () => ({
        single: () => Promise.resolve({ data: remittance, error: null })
      })
    }),
    update: (payload) => {
      updateSpy(payload);
      return {
        eq: () => ({
          select: () => ({
            single: () => Promise.resolve({ data: { ...remittance, ...payload }, error: null })
          })
        })
      };
    }
  }));
};

const buildRemittance = (status) => ({
  id: 'rem-1',
  remittance_number: 'REM-2026-0001',
  user_id: OWNER.id,
  status
});

beforeEach(() => {
  fromMock.mockReset();
  getUserMock.mockReset();
  updateSpy.mockReset();
  getUserMock.mockResolvedValue({ data: { user: OWNER }, error: null });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('remittanceService.cancelRemittance — allowed statuses', () => {
  // Mirrors guard_remittance_owner_update in the database (owner may cancel until an admin validates)
  it.each(['payment_pending', 'payment_rejected', 'payment_proof_uploaded'])('cancels a %s remittance', async (status) => {
    mockRemittanceTable(buildRemittance(status));

    const result = await cancelRemittance('rem-1', 'changed my mind');

    expect(result.status).toBe('cancelled');
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(Object.keys(updateSpy.mock.calls[0][0]).sort()).toEqual(
      ['cancellation_reason', 'cancelled_at', 'status', 'updated_at']
    );
  });

  it.each([
    'payment_validated',
    'processing',
    'delivered',
    'completed',
    'cancelled'
  ])('rejects cancelling a %s remittance without writing to the database', async (status) => {
    mockRemittanceTable(buildRemittance(status));

    await expect(cancelRemittance('rem-1', 'changed my mind')).rejects.toThrow();
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
