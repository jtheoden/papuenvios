import { describe, it, expect, vi, beforeEach } from 'vitest';

const REMITTANCE = {
  id: 'rem-1',
  remittance_number: 'REM-1',
  user_id: 'user-1',
  status: 'payment_pending'
};

const state = { updateCalled: false, updatePayload: null };
const uploadMock = vi.fn(async () => ({ error: null }));

const makeQuery = () => {
  const q = {
    select: () => q,
    eq: () => q,
    update: (payload) => {
      state.updateCalled = true;
      state.updatePayload = payload;
      return q;
    },
    single: async () => ({
      data: state.updateCalled
        ? { ...REMITTANCE, ...state.updatePayload, status: 'payment_proof_uploaded', payment_proof_url: 'user-1/REM-1.png' }
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
    storage: { from: vi.fn(() => ({ upload: (...args) => uploadMock(...args) })) }
  }
}));

vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn(async () => ({ success: true })) }));
vi.mock('@/lib/orderDiscountService', () => ({ recordOfferUsage: vi.fn() }));
vi.mock('@/lib/currencyService', () => ({ getExchangeRate: vi.fn() }));
vi.mock('@/lib/notificationSettingsService', () => ({
  getFreshGuidedWhatsappPhone: vi.fn(async () => '+15551234567')
}));

import { uploadPaymentProof } from '@/lib/remittanceService';
import { getFreshGuidedWhatsappPhone } from '@/lib/notificationSettingsService';
import { logActivity } from '@/lib/activityLogger';

const PHONE = '+1 305 555 0100';
const file = new File(['x'], 'proof.png', { type: 'image/png' });

const resetState = () => {
  state.updateCalled = false;
  state.updatePayload = null;
  vi.clearAllMocks();
};

describe('remittanceService.uploadPaymentProof notification', () => {
  beforeEach(resetState);

  it('never opens WhatsApp by itself (the guided step belongs to the caller)', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    await uploadPaymentProof('rem-1', file, 'John Doe', 'note', { payerPhone: PHONE });
    expect(openSpy).not.toHaveBeenCalled();
    expect(getFreshGuidedWhatsappPhone).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it('returns the persisted row so callers can build the admin message from it', async () => {
    await expect(
      uploadPaymentProof('rem-1', file, 'John Doe', '', { payerPhone: PHONE })
    ).resolves.toMatchObject({ id: 'rem-1', status: 'payment_proof_uploaded', payer_phone: PHONE });
  });
});

describe('remittanceService.uploadPaymentProof payer phone', () => {
  beforeEach(resetState);

  it('persists the trimmed payer_phone in the update payload', async () => {
    await uploadPaymentProof('rem-1', file, 'John Doe', 'note', { payerPhone: `  ${PHONE}  ` });
    expect(state.updatePayload).toMatchObject({ payer_phone: PHONE });
  });

  it.each([undefined, '', '   ', '123', 'not a phone'])(
    'rejects payerPhone=%j before touching storage or the database',
    async (payerPhone) => {
      await expect(
        uploadPaymentProof('rem-1', file, 'John Doe', 'note', { payerPhone })
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(uploadMock).not.toHaveBeenCalled();
      expect(state.updateCalled).toBe(false);
    }
  );

  it('rejects when no options are passed at all', async () => {
    await expect(uploadPaymentProof('rem-1', file, 'John Doe')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED'
    });
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('never writes the phone into activity log metadata', async () => {
    await uploadPaymentProof('rem-1', file, 'John Doe', 'note', { payerPhone: PHONE });
    expect(logActivity).toHaveBeenCalled();
    expect(JSON.stringify(logActivity.mock.calls)).not.toContain('305 555 0100');
  });
});
