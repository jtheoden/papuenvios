import { describe, expect, it } from 'vitest';
import { includePlannedPaymentMethods } from '@/lib/paymentMethodPresentation';

describe('payment method presentation rows', () => {
  it('shows IBAN as a disabled placeholder when an older catalog has no IBAN row', () => {
    const rows = includePlannedPaymentMethods([
      { code: 'bizum', available: false },
      { code: 'zelle', available: true }
    ]);

    expect(rows.map(({ code }) => code)).toEqual(['bizum', 'zelle', 'iban']);
    expect(rows[2]).toMatchObject({
      code: 'iban',
      available: false,
      enabled_for_orders: false,
      enabled_for_remittances: false,
      planned_placeholder: true
    });
  });

  it('keeps the database row and does not duplicate IBAN when the migration is deployed', () => {
    const iban = { code: 'iban', available: false, disabled_reason: 'not ready' };
    const rows = includePlannedPaymentMethods([iban]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toBe(iban);
  });
});
