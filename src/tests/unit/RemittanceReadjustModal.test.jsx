import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const toast = vi.fn();
const readjustRemittance = vi.fn();

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key, params) => (params ? `${key}|${Object.values(params).join('|')}` : key), language: 'es' })
}));
vi.mock('@/components/ui/use-toast', () => ({ toast: (...args) => toast(...args) }));
vi.mock('@/lib/remittanceService', () => ({ readjustRemittance: (...args) => readjustRemittance(...args) }));

import RemittanceReadjustModal from '@/components/admin/RemittanceReadjustModal';

const KEY = 'remittances.admin.readjust';
const REASON = 'La tasa vigente estaba mal al momento de la venta';

const remittance = (over = {}) => ({
  id: 'rem-1',
  remittance_number: 'REM-1',
  status: 'payment_validated',
  amount_sent: 100,
  currency_sent: 'USD',
  currency_delivered: 'CUP',
  exchange_rate: 800,
  commission_total: 2.5,
  amount_to_deliver: 78000,
  ...over
});

const setup = (rem = remittance()) => {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(<RemittanceReadjustModal remittance={rem} onClose={onClose} onSaved={onSaved} />);
  return { onClose, onSaved };
};

const field = (name) => screen.getByLabelText(`${KEY}.${name}`);
const confirmButton = () => screen.getByRole('button', { name: `${KEY}.confirm` });

beforeEach(() => {
  vi.clearAllMocks();
  readjustRemittance.mockResolvedValue({ id: 'rem-1' });
});

describe('RemittanceReadjustModal', () => {
  it('shows the current values and the 8 statuses', () => {
    setup();
    expect(field('exchangeRate').value).toBe('800');
    expect(field('commissionTotal').value).toBe('2.5');
    expect(field('amountSent').value).toBe('100');
    expect(field('status').value).toBe('payment_validated');
    expect(field('status').querySelectorAll('option')).toHaveLength(8);
  });

  it('always shows the limits of the readjustment as a visible note', () => {
    setup();
    expect(screen.getByRole('note').textContent).toContain(`${KEY}.limits`);
  });

  it('keeps confirm disabled until something changes and the reason is long enough', () => {
    setup();
    expect(confirmButton().disabled).toBe(true);
    fireEvent.change(field('exchangeRate'), { target: { value: '880' } });
    expect(confirmButton().disabled).toBe(true);
    fireEvent.change(field('reason'), { target: { value: REASON } });
    expect(confirmButton().disabled).toBe(false);
  });

  it('previews the recalculated amount to deliver when the rate changes: (100 - 2.5) * 880 = 85800', () => {
    setup();
    fireEvent.change(field('exchangeRate'), { target: { value: '880' } });
    expect(screen.getByTestId('readjust-preview').textContent).toContain('85800.00');
  });

  it('sends only the changed fields with the reason and reports the saved row', async () => {
    const { onSaved } = setup();
    fireEvent.change(field('exchangeRate'), { target: { value: '880' } });
    fireEvent.change(field('status'), { target: { value: 'cancelled' } });
    fireEvent.change(field('reason'), { target: { value: REASON } });
    fireEvent.click(confirmButton());

    await waitFor(() => expect(readjustRemittance).toHaveBeenCalledTimes(1));
    expect(readjustRemittance).toHaveBeenCalledWith('rem-1', { exchangeRate: 880, status: 'cancelled' }, REASON);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ id: 'rem-1' }));
  });

  it('shows the server refusal and stays open', async () => {
    readjustRemittance.mockRejectedValueOnce(new Error('own_operation_not_allowed: another administrator must readjust it'));
    const { onSaved } = setup();
    fireEvent.change(field('commissionTotal'), { target: { value: '3' } });
    fireEvent.change(field('reason'), { target: { value: REASON } });
    fireEvent.click(confirmButton());

    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' })));
    expect(onSaved).not.toHaveBeenCalled();
    expect(confirmButton().disabled).toBe(false);
  });
});
