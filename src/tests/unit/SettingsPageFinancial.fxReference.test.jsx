import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { makeRealT } from './helpers/realTranslator';

const toastMock = vi.fn();
const svc = vi.hoisted(() => ({
  getAllExchangeRates: vi.fn(),
  getAllCurrencies: vi.fn(),
  saveExchangeRate: vi.fn(),
  updateExchangeRatePair: vi.fn(),
  fetchReference: vi.fn()
}));

vi.mock('@/components/ui/use-toast', () => ({ toast: (...args) => toastMock(...args) }));
vi.mock('@/lib/financialSettingsService', () => ({ saveMarginSettings: vi.fn() }));
vi.mock('@/contexts/LanguageContext', async () => {
  const { makeRealT: build } = await import('./helpers/realTranslator');
  const t = build('en');
  return { useLanguage: () => ({ t, language: 'en' }) };
});
vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({ visualSettings: {}, applyMarginSettings: vi.fn() })
}));
vi.mock('@/lib/currencyService', () => ({
  getCurrencies: vi.fn().mockResolvedValue([]),
  getAllCurrencies: (...a) => svc.getAllCurrencies(...a),
  createCurrency: vi.fn(),
  updateCurrency: vi.fn(),
  deleteCurrency: vi.fn(),
  getAllExchangeRates: (...a) => svc.getAllExchangeRates(...a),
  saveExchangeRate: (...a) => svc.saveExchangeRate(...a),
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

const NOW = new Date('2026-10-16T12:00:00Z');
const USD = { id: 'usd', code: 'USD', name_es: 'Dólar', name_en: 'Dollar', symbol: '$', is_active: true };
const CUP = { id: 'cup', code: 'CUP', name_es: 'Peso', name_en: 'Peso', symbol: '$', is_active: true };
const EUR = { id: 'eur', code: 'EUR', name_es: 'Euro', name_en: 'Euro', symbol: 'E', is_active: false };

const rateRow = (id, from, to, rate, overrides = {}) => ({
  id,
  rate,
  effective_date: '2026-10-12',
  updated_at: '2026-10-12T10:00:00Z',
  is_active: true,
  from_currency_id: from.id,
  to_currency_id: to.id,
  from_currency: from,
  to_currency: to,
  ...overrides
});
const usdEurPair = () => [rateRow('r1', USD, EUR, 0.92), rateRow('r2', EUR, USD, 1.0869565)];
const cupPair = () => [rateRow('c1', USD, CUP, 790), rateRow('c2', CUP, USD, 0.001265)];

const reference = (overrides = {}) => ({
  pair: 'USD_EUR',
  rate: 0.892,
  providerName: 'ExchangeRate-API',
  providerDomain: 'exchangerate-api.com',
  providerUpdatedAt: new Date('2026-10-16T00:00:01Z'),
  providerDate: '2026-10-16',
  fetchedAt: NOW,
  ...overrides
});

const renderPage = () =>
  render(<SettingsPageFinancial localFinancial={{ productProfit: 40, comboProfit: 30 }} setLocalFinancial={vi.fn()} />);
const useReference = async () => fireEvent.click(await screen.findByRole('button', { name: 'Use as rate' }));
const newRateForm = () => screen.getByText('Add New Exchange Rate').parentElement;
const editForm = () => screen.getByText('Edit Rate Pair').closest('div.bg-amber-50');

beforeEach(() => {
  toastMock.mockReset();
  Object.values(svc).forEach((fn) => fn.mockReset());
  svc.getAllCurrencies.mockResolvedValue([USD, CUP, EUR]);
  svc.getAllExchangeRates.mockResolvedValue([]);
  svc.fetchReference.mockResolvedValue(reference());
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Financial: external reference', () => {
  it('replaces the old green block with the labelled reference and no longer loads "official rates"', async () => {
    renderPage();

    expect(await screen.findByText('Reference: 1 USD = 0.892 EUR (not the operative rate)')).toBeInTheDocument();
    expect(screen.getByText('Source: ExchangeRate-API (exchangerate-api.com)')).toBeInTheDocument();
    expect(screen.queryByText('Official Rates (Reference)')).toBeNull();
    expect(screen.queryByRole('button', { name: /Load Official Rates/ })).toBeNull();
  });

  it('shows an alert instead of an empty box when the reference fails, leaving the rates intact', async () => {
    const { FxReferenceError } = await import('@/lib/fxReference');
    svc.fetchReference.mockRejectedValue(new FxReferenceError('network'));
    svc.getAllExchangeRates.mockResolvedValue(cupPair());
    renderPage();

    expect(await screen.findByText('The external source could not be reached.')).toBeInTheDocument();
    expect(await screen.findByText('1 USD = 790.0000 CUP')).toBeInTheDocument();
  });

  it('"Use as rate" preloads a new USD->EUR rate (today) and writes nothing', async () => {
    renderPage();
    await useReference();

    const form = within(newRateForm());
    const [from, to] = form.getAllByRole('combobox');
    expect(from).toHaveValue('usd');
    expect(to).toHaveValue('eur');
    expect(form.getByDisplayValue('0.892')).toBeInTheDocument();
    expect(form.getByDisplayValue('2026-10-16')).toBeInTheDocument();
    expect(svc.saveExchangeRate).not.toHaveBeenCalled();
    expect(svc.updateExchangeRatePair).not.toHaveBeenCalled();
  });

  it('"Use as rate" with an existing USD->EUR pair opens it in edit mode, with no duplicate', async () => {
    svc.getAllExchangeRates.mockResolvedValue(usdEurPair());
    renderPage();
    await screen.findByText('1 USD = 0.9200 EUR');
    await useReference();

    expect(screen.queryByText('Add New Exchange Rate')).toBeNull();
    expect(within(editForm()).getByDisplayValue('0.892')).toBeInTheDocument();
    expect(svc.saveExchangeRate).not.toHaveBeenCalled();
    expect(svc.updateExchangeRatePair).not.toHaveBeenCalled();
  });

  it('with only the inverse EUR->USD row, does not edit it as USD->EUR (a save would hit nothing)', async () => {
    svc.getAllExchangeRates.mockResolvedValue([rateRow('r2', EUR, USD, 1.0869565)]);
    renderPage();
    await screen.findByText('1 EUR = 1.0870 USD');
    await useReference();

    expect(screen.queryByText('Edit Rate Pair')).toBeNull();
    expect(screen.getByText('Add New Exchange Rate')).toBeInTheDocument();
    expect(svc.updateExchangeRatePair).not.toHaveBeenCalled();
  });

  it('explains why it cannot preload when USD or EUR do not exist', async () => {
    svc.getAllCurrencies.mockResolvedValue([USD, CUP]);
    renderPage();

    expect(await screen.findByText('Create the USD and EUR currencies before preloading the rate.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Use as rate' })).toBeDisabled();
  });
});

describe('Financial: inactive EUR in the rate selector (owner decision)', () => {
  const openForm = async () => {
    renderPage();
    await screen.findByText('Reference: 1 USD = 0.892 EUR (not the operative rate)');
    fireEvent.click(screen.getByRole('button', { name: 'New Rate' }));
    return within(newRateForm()).getAllByRole('combobox');
  };
  const optionCodes = (select) => within(select).getAllByRole('option').map((o) => o.textContent.split(' - ')[0]);

  it('offers the inactive EUR as target only after choosing USD as source', async () => {
    const [from, to] = await openForm();
    expect(optionCodes(to)).not.toContain('EUR');

    fireEvent.change(from, { target: { value: 'usd' } });
    expect(optionCodes(to)).toContain('EUR');
    expect(optionCodes(from)).not.toContain('EUR');

    fireEvent.change(to, { target: { value: 'eur' } });
    fireEvent.change(from, { target: { value: 'cup' } });
    expect(to).toHaveValue('');
  });

  it('does not touch the currency list: EUR stays inactive and is not activated', async () => {
    await openForm();
    expect(screen.getAllByText('EUR').length).toBeGreaterThan(0);
    expect(svc.getAllCurrencies).toHaveBeenCalledTimes(1);
  });
});

describe('Financial: USD->EUR guards', () => {
  const fillNewRate = async (rate) => {
    renderPage();
    await screen.findByText('Reference: 1 USD = 0.892 EUR (not the operative rate)');
    fireEvent.click(screen.getByRole('button', { name: 'New Rate' }));
    const form = within(newRateForm());
    const [from, to] = form.getAllByRole('combobox');
    fireEvent.change(from, { target: { value: 'usd' } });
    fireEvent.change(to, { target: { value: 'eur' } });
    fireEvent.change(form.getByPlaceholderText('1.0000'), { target: { value: rate } });
    return form;
  };

  it('rejects an out-of-range USD->EUR rate (92) and saves nothing', async () => {
    const form = await fillNewRate('92');
    fireEvent.click(form.getByRole('button', { name: 'Save Rates' }));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'The USD to EUR rate must be between 0.5 and 1.5.', variant: 'destructive' })
      )
    );
    expect(svc.saveExchangeRate).not.toHaveBeenCalled();
  });

  it('saves a valid USD->EUR rate together with its inverse', async () => {
    svc.saveExchangeRate.mockResolvedValue({ error: null });
    const form = await fillNewRate('0.892');
    fireEvent.click(form.getByRole('button', { name: 'Save Rates' }));

    await waitFor(() => expect(svc.saveExchangeRate).toHaveBeenCalledTimes(2));
    expect(svc.saveExchangeRate.mock.calls[0][0]).toMatchObject({ fromCurrencyId: 'usd', toCurrencyId: 'eur', rate: '0.892' });
  });

  describe('editing an existing pair', () => {
    const startEdit = async (rate) => {
      svc.getAllExchangeRates.mockResolvedValue(usdEurPair());
      svc.updateExchangeRatePair.mockResolvedValue({ updatedCount: 2 });
      renderPage();
      await screen.findByText('1 USD = 0.9200 EUR');
      fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
      const form = within(editForm());
      fireEvent.change(form.getByDisplayValue('0.92'), { target: { value: rate } });
      return form;
    };

    it('rejects an out-of-range rate on edit', async () => {
      const form = await startEdit('92');
      fireEvent.click(form.getByRole('button', { name: 'Save Changes' }));

      await waitFor(() =>
        expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ description: 'The USD to EUR rate must be between 0.5 and 1.5.' }))
      );
      expect(svc.updateExchangeRatePair).not.toHaveBeenCalled();
    });

    it('asks for confirmation when the change is larger than 5% and saves only after confirming', async () => {
      const form = await startEdit('0.99');
      fireEvent.click(form.getByRole('button', { name: 'Save Changes' }));

      expect(await screen.findByText('Confirm large rate change')).toBeInTheDocument();
      expect(screen.getByText(/from 0\.92 to 0\.99 \(7\.6%\)/)).toBeInTheDocument();
      expect(svc.updateExchangeRatePair).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Save anyway' }));
      await waitFor(() => expect(svc.updateExchangeRatePair).toHaveBeenCalledWith('usd', 'eur', '0.99', expect.any(String)));
    });

    it('does not save when the confirmation is cancelled', async () => {
      const form = await startEdit('0.99');
      fireEvent.click(form.getByRole('button', { name: 'Save Changes' }));
      await screen.findByText('Confirm large rate change');
      // The confirmation modal renders after the edit form, so its Cancel is the last one.
      fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' }).at(-1));

      expect(svc.updateExchangeRatePair).not.toHaveBeenCalled();
    });

    it('saves a small change (<= 5%) without asking', async () => {
      const form = await startEdit('0.93');
      fireEvent.click(form.getByRole('button', { name: 'Save Changes' }));

      await waitFor(() => expect(svc.updateExchangeRatePair).toHaveBeenCalledWith('usd', 'eur', '0.93', expect.any(String)));
      expect(screen.queryByText('Confirm large rate change')).toBeNull();
    });
  });

  it('does not apply the USD->EUR band to other pairs', async () => {
    svc.getAllExchangeRates.mockResolvedValue(cupPair());
    svc.updateExchangeRatePair.mockResolvedValue({ updatedCount: 2 });
    renderPage();
    await screen.findByText('1 USD = 790.0000 CUP');
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
    const form = within(editForm());
    fireEvent.change(form.getByDisplayValue('790'), { target: { value: '1000' } });
    fireEvent.click(form.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(svc.updateExchangeRatePair).toHaveBeenCalledWith('usd', 'cup', '1000', expect.any(String)));
  });
});

describe('Financial: operative rate age', () => {
  it('shows when each operative rate was last updated', async () => {
    svc.getAllExchangeRates.mockResolvedValue(cupPair());
    renderPage();

    expect(await screen.findByText(/Last updated: .*2026/)).toBeInTheDocument();
  });

  it('shows nothing about age when the rate has no updated_at', async () => {
    svc.getAllExchangeRates.mockResolvedValue([rateRow('c1', USD, CUP, 790, { updated_at: null })]);
    renderPage();

    await screen.findByText('1 USD = 790.0000 CUP');
    expect(screen.queryByText(/Last updated:/)).toBeNull();
  });
});
