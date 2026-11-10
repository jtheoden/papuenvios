/**
 * Incident 2026-11-10: a super_admin saved "Dollars to CUP" with origin CUP (was USD) and delivery CUP at rate 880.
 * Same currency means 1:1, so customers were quoted "1 CUP = 1 CUP". The type form must:
 *  - refuse to save origin === delivery when the rate is not 1 (a same-currency type like USD -> USD at 1 stays valid),
 *  - ask for confirmation before changing the currency of a type that already exists.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (key) => key, language: 'en' }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ isSuperAdmin: true }) }));
const ui = vi.hoisted(() => ({ showModal: vi.fn(), toast: vi.fn() }));
vi.mock('@/contexts/ModalContext', () => ({ useModal: () => ({ showModal: (...args) => ui.showModal(...args) }) }));
vi.mock('@/components/ui/use-toast', () => ({ toast: (...args) => ui.toast(...args) }));
vi.mock('@/lib/styleUtils', () => ({ getHeadingStyle: () => ({}), getPrimaryButtonStyle: () => '' }));
vi.mock('@/lib/currencyService', () => ({
  getCurrenciesWithRates: vi.fn(async () => [
    { id: 'usd', code: 'USD', name_es: 'Dólar', name_en: 'Dollar' },
    { id: 'cup', code: 'CUP', name_es: 'Peso', name_en: 'Peso' }
  ])
}));

const svc = vi.hoisted(() => ({ update: vi.fn(), pending: vi.fn(), types: [] }));
vi.mock('@/lib/remittanceService', () => ({
  getAllRemittanceTypes: vi.fn(async () => svc.types),
  createRemittanceType: vi.fn(),
  updateRemittanceType: (...args) => svc.update(...args),
  deleteRemittanceType: vi.fn(),
  getPendingRemittancesCountByType: (...args) => svc.pending(...args),
  DELIVERY_METHODS: { CASH: 'cash', TRANSFER: 'transfer', CARD: 'card' }
}));

import RemittanceTypesConfig from '@/components/RemittanceTypesConfig';

const typeFor = (over = {}) => ({
  id: 't1',
  name: 'Dollars to CUP',
  currency_code: 'USD',
  delivery_currency: 'CUP',
  exchange_rate: 880,
  commission_percentage: 2.2727272727,
  commission_fixed: 0,
  min_amount: 20,
  max_amount: 3000,
  delivery_method: 'cash',
  max_delivery_days: 1,
  warning_days: 2,
  description: '',
  icon: 'dollar-sign',
  is_active: true,
  display_order: 0,
  ...over
});

const openEdit = async () => {
  fireEvent.click(await screen.findByTitle('common.edit'));
  await screen.findByDisplayValue('Dollars to CUP');
  return {
    origin: screen.getByDisplayValue('USD - Dollar'),
    delivery: screen.getByDisplayValue('CUP - Peso'),
    market: screen.getByPlaceholderText('472.00')
  };
};

const clickSave = () => fireEvent.click(screen.getByRole('button', { name: /common\.save$/ }));

beforeEach(() => {
  vi.clearAllMocks();
  svc.types = [typeFor()];
  svc.update.mockResolvedValue({});
  svc.pending.mockResolvedValue(0);
  ui.showModal.mockResolvedValue(true);
});

describe('changing the origin currency by mistake (the 2026-11-10 incident)', () => {
  it('asks the admin to confirm USD -> CUP becoming CUP -> CUP, and saves nothing if they cancel', async () => {
    ui.showModal.mockResolvedValue(false);
    render(<RemittanceTypesConfig />);
    const { origin } = await openEdit();
    fireEvent.change(origin, { target: { value: 'CUP' } });

    clickSave();

    await waitFor(() =>
      expect(ui.showModal).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'warning',
          title: 'remittances.admin.currencyChangeWarning',
          message: 'remittances.admin.currencyChangeMessage'
        })
      )
    );
    expect(svc.update).not.toHaveBeenCalled();
  });
});

describe('same-currency types keep their commission-carrier rate', () => {
  // market 1.03 / delivery 1.00 derives a 2.91% commission: the rate is a reference, not a conversion
  it('USD -> USD with market rate 1.03 saves as is, without a currency-change prompt', async () => {
    svc.types = [typeFor({ delivery_currency: 'USD', exchange_rate: 1.03, commission_percentage: 2.9126213592 })];
    render(<RemittanceTypesConfig />);
    fireEvent.click(await screen.findByTitle('common.edit'));
    await screen.findByDisplayValue('Dollars to CUP');

    clickSave();

    await waitFor(() => expect(svc.update).toHaveBeenCalledTimes(1));
    expect(svc.update.mock.calls[0][1]).toMatchObject({
      currency_code: 'USD',
      delivery_currency: 'USD',
      exchange_rate: 1.03,
      commission_percentage: 2.9126213592
    });
    expect(ui.showModal).not.toHaveBeenCalled();
  });
});

describe('changing the currency of an existing type', () => {
  it('asks for confirmation and does not save when the admin cancels', async () => {
    ui.showModal.mockResolvedValue(false);
    render(<RemittanceTypesConfig />);
    const { delivery } = await openEdit();
    fireEvent.change(delivery, { target: { value: 'USD' } });
    // USD -> USD at rate 1 (market and delivery) so only the currency-change prompt is under test
    fireEvent.change(screen.getByPlaceholderText('472.00'), { target: { value: '1' } });
    fireEvent.change(screen.getByPlaceholderText('470.00'), { target: { value: '1' } });

    clickSave();

    await waitFor(() =>
      expect(ui.showModal).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'warning', title: 'remittances.admin.currencyChangeWarning' })
      )
    );
    expect(svc.update).not.toHaveBeenCalled();
  });

  it('saves after the admin confirms', async () => {
    render(<RemittanceTypesConfig />);
    const { delivery } = await openEdit();
    fireEvent.change(delivery, { target: { value: 'USD' } });
    fireEvent.change(screen.getByPlaceholderText('472.00'), { target: { value: '1' } });
    fireEvent.change(screen.getByPlaceholderText('470.00'), { target: { value: '1' } });

    clickSave();

    await waitFor(() => expect(svc.update).toHaveBeenCalledTimes(1));
    expect(svc.update.mock.calls[0][1]).toMatchObject({ currency_code: 'USD', delivery_currency: 'USD' });
  });

  it('does not prompt when the currencies are untouched', async () => {
    render(<RemittanceTypesConfig />);
    const { market } = await openEdit();
    fireEvent.change(market, { target: { value: '885' } });

    clickSave();

    await waitFor(() => expect(svc.update).toHaveBeenCalledTimes(1));
    expect(ui.showModal).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: 'remittances.admin.currencyChangeWarning' })
    );
  });
});
