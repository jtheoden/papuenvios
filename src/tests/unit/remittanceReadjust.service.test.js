import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...args) => rpc(...args) }, withTimeout: (p) => p }));

import { readjustRemittance } from '@/lib/remittanceService';
import { validateReadjust, calcReadjustedDeliver, REMITTANCE_STATUSES } from '@/lib/remittanceReadjustRules';

const REASON = 'La tasa vigente estaba mal al momento de la venta';

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: { id: 'r1' }, error: null });
});

describe('remittanceReadjustRules', () => {
  it('lists the 8 statuses of the remittances table', () => {
    expect(REMITTANCE_STATUSES).toEqual([
      'payment_pending', 'payment_proof_uploaded', 'payment_validated', 'payment_rejected',
      'processing', 'delivered', 'completed', 'cancelled'
    ]);
  });

  it('recalculates the amount to deliver like the quote: (sent - commission) * rate at 4 decimals', () => {
    expect(calcReadjustedDeliver({ amountSent: 100, commission: 2.5, exchangeRate: 880 })).toBe(85800);
    expect(calcReadjustedDeliver({ amountSent: 50, commission: 1.14, exchangeRate: 890.1235 })).toBe(43491.43);
  });

  it('accepts a complete valid change', () => {
    expect(validateReadjust({ reason: REASON, amountSent: 100, commission: 2.5, exchangeRate: 880 })).toEqual({});
  });

  it.each([
    ['reason too short', { reason: 'corto' }, 'reason'],
    ['reason too long', { reason: 'x'.repeat(501) }, 'reason'],
    ['rate zero', { reason: REASON, exchangeRate: 0 }, 'exchangeRate'],
    ['rate with 5 decimals', { reason: REASON, exchangeRate: 880.12345 }, 'exchangeRate'],
    ['commission equal to the amount sent', { reason: REASON, amountSent: 100, commission: 100 }, 'commission'],
    ['negative commission', { reason: REASON, amountSent: 100, commission: -1 }, 'commission'],
    ['amount sent with 3 decimals', { reason: REASON, amountSent: 10.123 }, 'amountSent'],
    ['amount to deliver zero', { reason: REASON, amountToDeliver: 0 }, 'amountToDeliver'],
    ['unknown status', { reason: REASON, status: 'shipped' }, 'status'],
    ['nothing to change', { reason: REASON }, 'nothing']
  ])('refuses %s', (_label, input, field) => {
    expect(validateReadjust(input)).toHaveProperty(field);
  });
});

describe('readjustRemittance', () => {
  it('sends only the values that were given, with the trimmed reason', async () => {
    await readjustRemittance('r1', { exchangeRate: 880, commissionTotal: 2.5 }, `  ${REASON}  `);
    expect(rpc).toHaveBeenCalledWith('superadmin_readjust_remittance', {
      p_remittance_id: 'r1',
      p_reason: REASON,
      p_exchange_rate: 880,
      p_commission_total: 2.5
    });
  });

  it('maps every field to its RPC parameter', async () => {
    await readjustRemittance('r1', { exchangeRate: 880, commissionTotal: 2.5, amountToDeliver: 85800, amountSent: 100, status: 'cancelled' }, REASON);
    expect(rpc.mock.calls[0][1]).toEqual({
      p_remittance_id: 'r1',
      p_reason: REASON,
      p_exchange_rate: 880,
      p_commission_total: 2.5,
      p_amount_to_deliver: 85800,
      p_amount_sent: 100,
      p_status: 'cancelled'
    });
  });

  it('refuses invalid input without calling the server', async () => {
    await expect(readjustRemittance('r1', { exchangeRate: 0 }, REASON)).rejects.toBeTruthy();
    await expect(readjustRemittance('r1', {}, REASON)).rejects.toBeTruthy();
    await expect(readjustRemittance('r1', { status: 'cancelled' }, 'corto')).rejects.toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('turns a server error into a thrown AppError and returns the row on success', async () => {
    await expect(readjustRemittance('r1', { status: 'cancelled' }, REASON)).resolves.toEqual({ id: 'r1' });
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'own_operation_not_allowed: another administrator' } });
    await expect(readjustRemittance('r1', { status: 'cancelled' }, REASON)).rejects.toBeTruthy();
  });
});
