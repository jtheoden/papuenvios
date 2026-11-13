import { describe, expect, it, vi } from 'vitest';
import {
  FINANCIAL_RISK_WARNING_EVENT,
  getInvalidRemittanceRateWarning,
  getNegativeMarginWarning,
  getOverdueRefundWarning,
  publishFinancialRiskWarning,
  validatePersistedFinancialSetting
} from '@/lib/financialRiskWarnings';

describe('financial risk warnings', () => {
  it('describes negative margins as direct loss risk in Spanish and English', () => {
    expect(getNegativeMarginWarning({ language: 'es' }).message).toMatch(/pérdida directa/i);
    expect(getNegativeMarginWarning({ language: 'en' }).impact).toMatch(/financial loss/i);
  });

  it('describes invalid remittance rates and overdue refunds with specific risk guidance', () => {
    expect(getInvalidRemittanceRateWarning({ language: 'es' }).message).toMatch(/pague más de lo que cobra/i);
    expect(getOverdueRefundWarning({ count: 2, language: 'en' }).message).toMatch(/2 pending refunds/i);
  });

  it('publishes a structured warning event without sending financial identifiers', () => {
    const listener = vi.fn();
    window.addEventListener(FINANCIAL_RISK_WARNING_EVENT, listener, { once: true });
    publishFinancialRiskWarning({ code: 'test', title: 'Warning', message: 'Review this', impact: 'Loss risk' });
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail).toMatchObject({ code: 'test', severity: 'high', title: 'Warning' });
    expect(listener.mock.calls[0][0].detail).not.toHaveProperty('customerEmail');
  });

  it('validates persisted order pricing and remittance settings after save', () => {
    const listener = vi.fn();
    window.addEventListener(FINANCIAL_RISK_WARNING_EVENT, listener);
    const orderWarnings = validatePersistedFinancialSetting({
      kind: 'order-pricing', values: { basePrice: -1, profitMargin: 20 }, language: 'en'
    });
    const remittanceWarnings = validatePersistedFinancialSetting({
      kind: 'remittance-type',
      values: { exchange_rate: 400, delivery_rate: 430, commission_percentage: 0, commission_fixed: 0 },
      language: 'en'
    });
    window.removeEventListener(FINANCIAL_RISK_WARNING_EVENT, listener);

    expect(orderWarnings[0].code).toBe('invalid-order-pricing');
    expect(remittanceWarnings[0].code).toBe('invalid-remittance-rate');
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
