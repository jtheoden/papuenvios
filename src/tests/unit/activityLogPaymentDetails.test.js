import { describe, expect, it } from 'vitest';
import { getActivityPaymentDetails } from '@/lib/activityLogPaymentDetails';

describe('getActivityPaymentDetails', () => {
  it('formats explicitly recorded Bizum amount in its native currency', () => {
    const result = getActivityPaymentDetails({
      metadata: { paymentMethod: 'bizum', paymentAmount: '42.5', paymentCurrency: 'eur' }
    }, 'es');

    expect(result.method).toBe('BIZUM');
    expect(result.amount).toContain('42,50');
    expect(result.amount).toContain('€');
  });

  it('does not invent an amount when the event has no confirmed payment amount/currency', () => {
    expect(getActivityPaymentDetails({ metadata: { paymentMethod: 'iban', paymentAmount: null } })).toEqual({
      method: 'IBAN',
      amount: null,
      reference: null
    });
  });

  it('ignores unrelated or unsupported payment methods', () => {
    expect(getActivityPaymentDetails({ metadata: { paymentMethod: 'cash', paymentAmount: 10, paymentCurrency: 'USD' } })).toBeNull();
    expect(getActivityPaymentDetails({ metadata: null })).toBeNull();
  });
});
