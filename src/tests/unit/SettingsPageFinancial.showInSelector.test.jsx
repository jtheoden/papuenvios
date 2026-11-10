/**
 * Per-currency "show in selector" checkbox in Settings > Financial: saved through the currency service and reloaded;
 * locked for the base currency and for the last visible currency.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EN from '@/translations/EN.json';
import ES from '@/translations/ES.json';
import { ConfirmWrapper } from './helpers/confirmDialog';

const svc = vi.hoisted(() => ({
  getAllExchangeRates: vi.fn(),
  getAllCurrencies: vi.fn(),
  setCurrencyShowInSelector: vi.fn()
}));

vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/lib/financialSettingsService', () => ({ saveMarginSettings: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ isSuperAdmin: true }) }));
vi.mock('@/contexts/LanguageContext', async () => {
  const { makeRealT: build } = await import('./helpers/realTranslator');
  return { useLanguage: () => ({ t: build('en'), language: 'en' }) };
});
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => ({ visualSettings: {}, applyMarginSettings: vi.fn() }) }));
vi.mock('@/lib/currencyService', () => ({
  getCurrencies: vi.fn().mockResolvedValue([]),
  getAllCurrencies: (...a) => svc.getAllCurrencies(...a),
  createCurrency: vi.fn(),
  updateCurrency: vi.fn(),
  deleteCurrency: vi.fn(),
  setCurrencyShowInSelector: (...a) => svc.setCurrencyShowInSelector(...a),
  getAllExchangeRates: (...a) => svc.getAllExchangeRates(...a),
  saveExchangeRate: vi.fn(),
  saveExchangeRatePair: vi.fn(),
  deleteExchangeRate: vi.fn(),
  deleteExchangeRatePair: vi.fn(),
  updateExchangeRatePair: vi.fn()
}));
vi.mock('@/lib/fxReference', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchUsdEurReference: vi.fn().mockRejectedValue(new Error('no reference'))
}));
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), auth: { refreshSession: vi.fn() } } }));

import SettingsPageFinancial from '@/components/settings/SettingsPageFinancial';

const mk = (id, extra = {}) => ({ id, code: id.toUpperCase(), name_es: id, name_en: id, symbol: '$', is_active: true, show_in_selector: true, ...extra });
const USD = mk('usd', { is_base: true });
const CUP = mk('cup');
const EUR = mk('eur');

const renderPage = async () => {
  render(<SettingsPageFinancial localFinancial={{ productProfit: 40, comboProfit: 30 }} setLocalFinancial={vi.fn()} />, { wrapper: ConfirmWrapper });
  await screen.findByText('CUP');
};
const box = (code) => screen.getByRole('checkbox', { name: new RegExp(`${EN.settings.financial.showInSelector}.*${code}`) });

beforeEach(() => {
  Object.values(svc).forEach((fn) => fn.mockReset());
  svc.getAllExchangeRates.mockResolvedValue([]);
  svc.setCurrencyShowInSelector.mockResolvedValue({});
});

describe('Show in selector checkbox', () => {
  it.each([['EN', EN], ['ES', ES]])('%s has the label', (_n, dict) => {
    expect(dict.settings.financial.showInSelector).toEqual(expect.any(String));
  });

  it('saves the new value and reloads the currencies', async () => {
    svc.getAllCurrencies.mockResolvedValueOnce([USD, CUP]).mockResolvedValue([USD, { ...CUP, show_in_selector: false }]);
    await renderPage();
    expect(box('CUP').checked).toBe(true);
    fireEvent.click(box('CUP'));
    await waitFor(() => expect(svc.setCurrencyShowInSelector).toHaveBeenCalledWith('cup', false));
    await waitFor(() => expect(box('CUP').checked).toBe(false));
  });

  it('is locked for the base currency', async () => {
    svc.getAllCurrencies.mockResolvedValue([USD, CUP]);
    await renderPage();
    expect(box('USD').disabled).toBe(true);
    expect(box('CUP').disabled).toBe(false);
  });

  it('a hidden currency can always be shown again', async () => {
    svc.getAllCurrencies.mockResolvedValue([USD, { ...CUP, show_in_selector: false }, EUR]);
    await renderPage();
    expect(box('CUP').disabled).toBe(false);
    expect(box('EUR').disabled).toBe(false);
  });

  it('locks the last visible currency', async () => {
    // The base is inactive, so it is out of the selector pool and CUP is the only visible currency.
    svc.getAllCurrencies.mockResolvedValue([{ ...USD, is_active: false }, CUP]);
    await renderPage();
    expect(box('CUP').disabled).toBe(true);
  });
});
