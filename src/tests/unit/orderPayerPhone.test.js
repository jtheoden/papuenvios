import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { getPaymentConfirmationBlocker } from '@/lib/orderPayerPhone';

const file = { name: 'p.png' };

describe('getPaymentConfirmationBlocker', () => {
  it('returns null when proof, payer and a valid phone are present', () => {
    expect(
      getPaymentConfirmationBlocker({ paymentProof: file, paymentReference: 'John', payerPhone: '+1 305 555 0100' })
    ).toBeNull();
  });

  it('blocks on a missing phone', () => {
    expect(
      getPaymentConfirmationBlocker({ paymentProof: file, paymentReference: 'John', payerPhone: '' })
    ).toBe('payerPhone');
  });

  it('blocks on an invalid phone', () => {
    expect(
      getPaymentConfirmationBlocker({ paymentProof: file, paymentReference: 'John', payerPhone: 'abc' })
    ).toBe('payerPhone');
  });

  it('reports proof first, then payer, then phone', () => {
    expect(getPaymentConfirmationBlocker({ paymentProof: null, paymentReference: '', payerPhone: '' })).toBe('proof');
    expect(getPaymentConfirmationBlocker({ paymentProof: file, paymentReference: ' ', payerPhone: '' })).toBe('payer');
  });
});
