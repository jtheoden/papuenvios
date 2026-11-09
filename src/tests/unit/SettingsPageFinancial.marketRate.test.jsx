/**
 * Internal "market rate (reference)" per pair: visible and editable by super_admin only, informational
 * difference vs the operative rate, never used for quoting.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EN from '@/translations/EN.json';
import ES from '@/translations/ES.json';
import { ConfirmWrapper } from './helpers/confirmDialog';

const auth = vi.hoisted(() => ({ isSuperAdmin: true }));
const svc = vi.hoisted(() => ({
  getAllExchangeRates: vi.fn(),
  getAllCurrencies: vi.fn(),
  saveExchangeRatePair: vi.fn(),
  updateExchangeRatePair: vi.fn(),
  fetchReference: vi.fn()
}));

vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/lib/financialSettingsService', () => ({ saveMarginSettings: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ isSuperAdmin: auth.isSuperAdmin }) }));
vi.mock('@/contexts/LanguageContext', async () => {
  const { makeRealT: build } = await import('./helpers/realTranslator');
  const t = build('en');
  return { useLanguage: () => ({ t, language: 'en' }) };
});
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => ({ visualSettings: {}, applyMarginSettings: vi.fn() }) }));
vi.mock('@/lib/currencyService', () => ({
  getCurrencies: vi.fn().mockResolvedValue([]),
  getAllCurrencies: (...a) => svc.getAllCurrencies(...a),
  createCurrency: vi.fn(),
  updateCurrency: vi.fn(),
  deleteCurrency: vi.fn(),
  getAllExchangeRates: (...a) => svc.getAllExchangeRates(...a),
  saveExchangeRate: vi.fn(),
  saveExchangeRatePair: (...a) => svc.saveExchangeRatePair(...a),
  deleteExchangeRate: vi.fn(),
  deleteExchangeRatePair: vi.fn(),
  updateExchangeRatePair: (...a) => svc.updateExchangeRatePair(...a)
}));
vi.mock('@/lib/fxReference', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchUsdEurReference: (...a) => svc.fetchReference(...a)
}));
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), auth: { refreshSession: vi.fn() } } }));

import SettingsPageFinancial from '@/components/settings/SettingsPageFinancial';

const USD = { id: 'usd', code: 'USD', name_es: 'Dólar', name_en: 'Dollar', symbol: '$', is_active: true, is_base: true };
const CUP = { id: 'cup', code: 'CUP', name_es: 'Peso', name_en: 'Peso', symbol: '$', is_active: true };
const rateRow = (id, from, to, rate, market) => ({
  id, rate, market_rate: market, effective_date: '2026-10-12', updated_at: '2026-10-12T10:00:00Z', is_active: true,
  from_currency_id: from.id, to_currency_id: to.id, from_currency: from, to_currency: to
});
const MARKET_LABEL = 'Market rate (reference)';

const renderPage = async () => {
  render(<SettingsPageFinancial localFinancial={{ productProfit: 40, comboProfit: 30 }} setLocalFinancial={vi.fn()} />, { wrapper: ConfirmWrapper });
  await screen.findByText('1 USD = 915.0000 CUP');
};

beforeEach(() => {
  Object.values(svc).forEach((fn) => fn.mockReset());
  auth.isSuperAdmin = true;
  svc.getAllCurrencies.mockResolvedValue([USD, CUP]);
  svc.getAllExchangeRates.mockResolvedValue([rateRow('r1', USD, CUP, 915, 900), rateRow('r2', CUP, USD, 1 / 915, 1 / 900)]);
  svc.updateExchangeRatePair.mockResolvedValue({ updatedCount: 2 });
  svc.saveExchangeRatePair.mockResolvedValue({ direct: {}, inverse: {} });
  svc.fetchReference.mockRejectedValue(new Error('no reference in this test'));
});

describe('translations', () => {
  it.each([['EN', EN], ['ES', ES]])('%s has the market rate strings', (_n, dict) => {
    ['marketRate', 'marketRateHint', 'marketRateInfo'].forEach((key) => {
      expect(dict.settings.financial[key]).toEqual(expect.any(String));
    });
  });
});

describe('super_admin', () => {
  it('shows the market rate and the informational difference on the pair card', async () => {
    await renderPage();
    expect(screen.getByTestId('market-rate-info')).toHaveTextContent('900.0000');
    expect(screen.getByTestId('market-rate-info')).toHaveTextContent('+1.7 %');
  });

  it('prefills the edit form with the stored market rate and saves it as marketRate', async () => {
    await renderPage();
    fireEvent.click(screen.getByTitle('Edit rate pair'));
    const input = await screen.findByLabelText(MARKET_LABEL);
    expect(input).toHaveValue(900);
    fireEvent.change(input, { target: { value: '905' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(svc.updateExchangeRatePair).toHaveBeenCalledWith(
      'usd', 'cup', 915, expect.any(String), { marketRate: '905' }
    ));
  });

  it('does not send marketRate when only the rate is edited (keeps a hand-entered inverse market rate)', async () => {
    await renderPage();
    fireEvent.click(screen.getByTitle('Edit rate pair'));
    await screen.findByLabelText(MARKET_LABEL);
    fireEvent.change(screen.getByDisplayValue('915'), { target: { value: '916' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(svc.updateExchangeRatePair).toHaveBeenCalled());
    expect(svc.updateExchangeRatePair.mock.calls[0]).toHaveLength(4);
  });

  it('does not send marketRate when the field is cleared', async () => {
    await renderPage();
    fireEvent.click(screen.getByTitle('Edit rate pair'));
    fireEvent.change(await screen.findByLabelText(MARKET_LABEL), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(svc.updateExchangeRatePair).toHaveBeenCalled());
    expect(svc.updateExchangeRatePair.mock.calls[0]).toHaveLength(4);
  });

  it('offers the optional field in the create form and sends marketRate when typed', async () => {
    svc.getAllExchangeRates.mockResolvedValue([]); // no existing pair, so the duplicate guard stays out of the way
    render(<SettingsPageFinancial localFinancial={{ productProfit: 40, comboProfit: 30 }} setLocalFinancial={vi.fn()} />, { wrapper: ConfirmWrapper });
    fireEvent.click(await screen.findByTitle(EN.settings.financial.newRate));
    expect(await screen.findByText(EN.settings.financial.marketRateHint)).toBeInTheDocument();
    const pick = (code, value) => fireEvent.change(
      screen.getAllByRole('combobox').find((s) => s.querySelector(`option[value="${code}"]`)),
      { target: { value } }
    );
    pick('usd', 'usd');
    await waitFor(() => expect(screen.getAllByRole('combobox').some((s) => s.querySelector('option[value="cup"]'))).toBe(true));
    fireEvent.change(
      screen.getAllByRole('combobox').filter((s) => s.querySelector('option[value="cup"]')).at(-1),
      { target: { value: 'cup' } }
    );
    fireEvent.change(screen.getByPlaceholderText('1.0000'), { target: { value: '920' } });
    fireEvent.change(screen.getByLabelText(MARKET_LABEL), { target: { value: '905' } });
    fireEvent.click(screen.getByRole('button', { name: EN.settings.financial.saveRates }));
    await waitFor(() => expect(svc.saveExchangeRatePair).toHaveBeenCalledWith(
      expect.objectContaining({ fromCurrencyId: 'usd', toCurrencyId: 'cup', rate: '920', marketRate: '905' })
    ));
  });
});

describe('plain admin', () => {
  it('sees no market rate anywhere', async () => {
    auth.isSuperAdmin = false;
    await renderPage();
    expect(screen.queryByTestId('market-rate-info')).toBeNull();
    expect(screen.queryByText(MARKET_LABEL)).toBeNull();
    expect(screen.queryByText(/900\.0000/)).toBeNull();
  });
});
