import { describe, it, expect, vi, beforeEach } from 'vitest';

const REMITTANCE = {
  id: 'rem-1',
  remittance_number: 'REM-1',
  user_id: 'user-1',
  status: 'payment_pending'
};

const state = { updateCalled: false };

const makeQuery = () => {
  const q = {
    select: () => q,
    eq: () => q,
    update: () => {
      state.updateCalled = true;
      return q;
    },
    single: async () => ({
      data: state.updateCalled
        ? { ...REMITTANCE, status: 'payment_proof_uploaded', payment_proof_url: 'user-1/REM-1.png' }
        : REMITTANCE,
      error: null
    })
  };
  return q;
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => makeQuery()),
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: 'user-1', email: 'u@example.com', user_metadata: {} } },
        error: null
      }))
    },
    storage: { from: vi.fn(() => ({ upload: vi.fn(async () => ({ error: null })) })) }
  }
}));

vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn(async () => ({ success: true })) }));
vi.mock('@/lib/orderDiscountService', () => ({ recordOfferUsage: vi.fn() }));
vi.mock('@/lib/currencyService', () => ({ getExchangeRate: vi.fn() }));
vi.mock('@/lib/notificationSettingsService', () => ({
  getFreshWhatsappRecipient: vi.fn(async () => '+15551234567')
}));
vi.mock('@/lib/whatsappService', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, notifyAdminNewPaymentProof: vi.fn(async () => ({ opened: true })) };
});

import { uploadPaymentProof } from '@/lib/remittanceService';
import { notifyAdminNewPaymentProof } from '@/lib/whatsappService';

const file = new File(['x'], 'proof.png', { type: 'image/png' });

describe('remittanceService.uploadPaymentProof notification', () => {
  beforeEach(() => {
    state.updateCalled = false;
    vi.clearAllMocks();
  });

  it('notifies the admin exactly once, in Spanish by default', async () => {
    await uploadPaymentProof('rem-1', file, 'John Doe', 'note');
    expect(notifyAdminNewPaymentProof).toHaveBeenCalledTimes(1);
    expect(notifyAdminNewPaymentProof.mock.calls[0][2]).toBe('es');
  });

  it('forwards the language option to the notifier', async () => {
    await uploadPaymentProof('rem-1', file, 'John Doe', 'note', { language: 'en' });
    expect(notifyAdminNewPaymentProof).toHaveBeenCalledTimes(1);
    expect(notifyAdminNewPaymentProof.mock.calls[0][2]).toBe('en');
  });

  it('does not throw when the notifier rejects', async () => {
    notifyAdminNewPaymentProof.mockRejectedValueOnce(new Error('boom'));
    await expect(uploadPaymentProof('rem-1', file, 'John Doe')).resolves.toMatchObject({ id: 'rem-1' });
  });
});
