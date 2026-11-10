/**
 * Phase 4: saving the USD<->CUP rate previews the catalog repricing, asks one themed confirmation (two when the
 * change is large), saves the rate and then applies the repricing. The rate is never rolled back.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import EN from '@/translations/EN.json';
import ES from '@/translations/ES.json';
import { ConfirmWrapper, findConfirmDialog, answerConfirm } from './helpers/confirmDialog';

const auth = vi.hoisted(() => ({ isSuperAdmin: true }));
const toastSpy = vi.hoisted(() => vi.fn());
const svc = vi.hoisted(() => ({
  getAllExchangeRates: vi.fn(),
  getAllCurrencies: vi.fn(),
  updateExchangeRatePair: vi.fn(),
  deleteExchangeRatePair: vi.fn(),
  saveExchangeRatePair: vi.fn(),
  previewCatalogReprice: vi.fn(),
  applyCatalogReprice: vi.fn(),
  getCatalogRepriceStatus: vi.fn(),
  fetchReference: vi.fn()
}));

vi.mock('@/components/ui/use-toast', () => ({ toast: (...a) => toastSpy(...a) }));
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
  deleteExchangeRatePair: (...a) => svc.deleteExchangeRatePair(...a),
  updateExchangeRatePair: (...a) => svc.updateExchangeRatePair(...a),
  previewCatalogReprice: (...a) => svc.previewCatalogReprice(...a),
  applyCatalogReprice: (...a) => svc.applyCatalogReprice(...a),
  getCatalogRepriceStatus: (...a) => svc.getCatalogRepriceStatus(...a)
}));
vi.mock('@/lib/fxReference', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchUsdEurReference: (...a) => svc.fetchReference(...a)
}));
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn(), auth: { refreshSession: vi.fn() } } }));

import SettingsPageFinancial from '@/components/settings/SettingsPageFinancial';

const USD = { id: 'usd', code: 'USD', name_es: 'Dólar', name_en: 'Dollar', symbol: '$', is_active: true, is_base: true };
const CUP = { id: 'cup', code: 'CUP', name_es: 'Peso', name_en: 'Peso', symbol: '$', is_active: true };
const EUR = { id: 'eur', code: 'EUR', name_es: 'Euro', name_en: 'Euro', symbol: 'E', is_active: true };
const rateRow = (id, from, to, rate) => ({
  id, rate, effective_date: '2026-10-12', updated_at: '2026-10-12T10:00:00Z', is_active: true,
  from_currency_id: from.id, to_currency_id: to.id, from_currency: from, to_currency: to
});

const PREVIEW = {
  rate: 920, previous_rate: 915, pct_change: 0.5, requires_extra_confirmation: false,
  products_affected: 12, combos_affected: 3, skipped_products: [], avg_pct_change: -0.5, max_abs_pct_change: 0.5
};
const LARGE = { ...PREVIEW, rate: 1100, pct_change: 20.2, requires_extra_confirmation: true, avg_pct_change: -16.8, max_abs_pct_change: 16.8 };

const renderPage = async (rateText = '1 USD = 915.0000 CUP') => {
  render(<SettingsPageFinancial localFinancial={{ productProfit: 40, comboProfit: 30 }} setLocalFinancial={vi.fn()} />, { wrapper: ConfirmWrapper });
  await screen.findByText(rateText);
};

const editAndSave = async (value) => {
  fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
  const input = await screen.findByDisplayValue(/^(915|0\.92)$/);
  fireEvent.change(input, { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
};

beforeEach(() => {
  auth.isSuperAdmin = true;
  Object.values(svc).forEach((fn) => fn.mockReset());
  toastSpy.mockReset();
  svc.getAllCurrencies.mockResolvedValue([USD, CUP, EUR]);
  svc.getAllExchangeRates.mockResolvedValue([rateRow('r1', USD, CUP, 915), rateRow('r2', CUP, USD, 0.001093)]);
  svc.fetchReference.mockRejectedValue(new Error('no reference in this test'));
  svc.updateExchangeRatePair.mockResolvedValue({ updatedCount: 2 });
  svc.previewCatalogReprice.mockResolvedValue({ data: PREVIEW });
  svc.applyCatalogReprice.mockResolvedValue({ data: { products_updated: 12, combos_updated: 3, skipped_combos: [] } });
  svc.getCatalogRepriceStatus.mockResolvedValue({ data: { rate: '915.000000', applied_at: '2026-11-01T00:00:00Z' } });
});

describe('USD<->CUP rate edit as super admin', () => {
  it('saves straight away (no dialog, no apply) when nothing is affected', async () => {
    svc.previewCatalogReprice.mockResolvedValue({ data: { ...PREVIEW, products_affected: 0, combos_affected: 0 } });
    await renderPage();
    await editAndSave('920');
    await waitFor(() => expect(svc.updateExchangeRatePair).toHaveBeenCalled());
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(svc.applyCatalogReprice).not.toHaveBeenCalled();
  });

  it('shows one dialog with the figures; confirming saves the rate and applies the repricing', async () => {
    await renderPage();
    await editAndSave('920');
    const dialog = await findConfirmDialog();
    expect(svc.previewCatalogReprice).toHaveBeenCalledWith(920);
    expect(dialog).toHaveTextContent('12 products and 3 combos');
    expect(dialog).toHaveTextContent('Average change -0.5%');
    expect(dialog).toHaveTextContent('largest 0.5%');
    expect(svc.updateExchangeRatePair).not.toHaveBeenCalled();
    await answerConfirm(true);
    await waitFor(() => expect(svc.applyCatalogReprice).toHaveBeenCalledWith(false, 920));
    expect(svc.updateExchangeRatePair).toHaveBeenCalledTimes(1);
    expect(svc.updateExchangeRatePair.mock.invocationCallOrder[0]).toBeLessThan(svc.applyCatalogReprice.mock.invocationCallOrder[0]);
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({
      title: EN.settings.financial.repricing.applied,
      description: expect.stringContaining('12 products and 3 combos')
    })));
  });

  it('saves nothing when the dialog is cancelled', async () => {
    await renderPage();
    await editAndSave('920');
    await answerConfirm(false);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(svc.updateExchangeRatePair).not.toHaveBeenCalled();
    expect(svc.applyCatalogReprice).not.toHaveBeenCalled();
  });

  it('asks a second explicit confirmation above 10% and applies with confirmLarge', async () => {
    svc.previewCatalogReprice.mockResolvedValue({ data: LARGE });
    await renderPage();
    await editAndSave('1100');
    const first = await findConfirmDialog();
    expect(first).toHaveTextContent(EN.settings.financial.repricing.largeWarning);
    expect(screen.queryByText(EN.settings.financial.rateChangeConfirmTitle)).toBeNull();
    await answerConfirm(true);
    await waitFor(() => expect(screen.getByRole('alertdialog')).toHaveTextContent(EN.settings.financial.repricing.secondTitle));
    expect(svc.updateExchangeRatePair).not.toHaveBeenCalled();
    await answerConfirm(true);
    await waitFor(() => expect(svc.applyCatalogReprice).toHaveBeenCalledWith(true, 1100));
    expect(svc.updateExchangeRatePair).toHaveBeenCalledTimes(1);
  });

  it('saves nothing when the second confirmation is cancelled', async () => {
    svc.previewCatalogReprice.mockResolvedValue({ data: LARGE });
    await renderPage();
    await editAndSave('1100');
    await findConfirmDialog();
    await answerConfirm(true);
    await waitFor(() => expect(screen.getByRole('alertdialog')).toHaveTextContent(EN.settings.financial.repricing.secondTitle));
    await answerConfirm(false);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(svc.updateExchangeRatePair).not.toHaveBeenCalled();
    expect(svc.applyCatalogReprice).not.toHaveBeenCalled();
  });

  it('keeps the saved rate, shows the stale banner and retries when apply fails', async () => {
    svc.applyCatalogReprice.mockResolvedValueOnce({ error: { message: 'boom' } });
    await renderPage();
    await editAndSave('920');
    await findConfirmDialog();
    await answerConfirm(true);
    const banner = await screen.findByRole('status');
    expect(banner).toHaveTextContent(EN.settings.financial.repricing.staleTitle);
    expect(svc.updateExchangeRatePair).toHaveBeenCalledTimes(1);
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive', title: EN.settings.financial.repricing.applyFailed }));

    fireEvent.click(within(banner).getByRole('button', { name: EN.settings.financial.repricing.retry }));
    await findConfirmDialog();
    await answerConfirm(true);
    await waitFor(() => expect(svc.applyCatalogReprice).toHaveBeenCalledTimes(2));
    expect(svc.previewCatalogReprice).toHaveBeenLastCalledWith(null);
    expect(svc.applyCatalogReprice).toHaveBeenLastCalledWith(false, 920);
    expect(svc.updateExchangeRatePair).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });

  it('keeps today\'s flow when the migration is not applied (unavailable)', async () => {
    svc.previewCatalogReprice.mockResolvedValue({ unavailable: true });
    await renderPage();
    await editAndSave('920');
    await waitFor(() => expect(svc.updateExchangeRatePair).toHaveBeenCalled());
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(svc.applyCatalogReprice).not.toHaveBeenCalled();
  });

  it('does not ask for repricing when the pair is deactivated', async () => {
    svc.deleteExchangeRatePair.mockResolvedValue({ deletedCount: 2 });
    await renderPage();
    fireEvent.click(screen.getByTitle('Deactivate rate pair'));
    await answerConfirm(true);
    await waitFor(() => expect(svc.deleteExchangeRatePair).toHaveBeenCalledWith('usd', 'cup'));
    expect(svc.previewCatalogReprice).not.toHaveBeenCalled();
    expect(svc.applyCatalogReprice).not.toHaveBeenCalled();
  });
});

describe('review fixes', () => {
  const R = EN.settings.financial.repricing;

  it('the first dialog shows previous rate, new rate and rate percent', async () => {
    await renderPage();
    await editAndSave('920');
    const dialog = await findConfirmDialog();
    expect(dialog).toHaveTextContent('Rate: 915 → 920 (0.5%)');
  });

  it('shows only the new rate when there is no previous rate', async () => {
    svc.previewCatalogReprice.mockResolvedValue({ data: { ...PREVIEW, previous_rate: null, rate_pct_change: null } });
    await renderPage();
    await editAndSave('920');
    const dialog = await findConfirmDialog();
    expect(dialog).toHaveTextContent('New rate: 920');
    expect(dialog).not.toHaveTextContent('→');
  });

  it('mentions the skipped products', async () => {
    svc.previewCatalogReprice.mockResolvedValue({ data: { ...PREVIEW, skipped_products: [{ id: 'p1', reason: 'rounds_to_zero' }, { id: 'p2', reason: 'rounds_to_zero' }] } });
    await renderPage();
    await editAndSave('920');
    expect(await findConfirmDialog()).toHaveTextContent('2 products skipped (price would be 0.00)');
  });

  it('repeats the rates in the second confirmation', async () => {
    svc.previewCatalogReprice.mockResolvedValue({ data: { ...LARGE, previous_rate: 915, rate_pct_change: 20.2 } });
    await renderPage();
    await editAndSave('1100');
    await findConfirmDialog();
    await answerConfirm(true);
    await waitFor(() => expect(screen.getByRole('alertdialog')).toHaveTextContent(R.secondTitle));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Rate: 915 → 1100 (20.2%)');
  });

  it('on rate_changed: explains it, does not retry blindly and leaves the banner', async () => {
    svc.applyCatalogReprice.mockResolvedValue({ rateChanged: true });
    await renderPage();
    await editAndSave('920');
    await findConfirmDialog();
    await answerConfirm(true);
    expect(await screen.findByRole('status')).toHaveTextContent(R.staleTitle);
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive', title: R.rateChanged }));
    expect(svc.applyCatalogReprice).toHaveBeenCalledTimes(1);
  });

  it('preview error: offers to save the rate without repricing; accepting saves and leaves the banner', async () => {
    svc.previewCatalogReprice.mockResolvedValue({ error: { message: 'boom' } });
    await renderPage();
    await editAndSave('920');
    expect(await findConfirmDialog()).toHaveTextContent(R.previewErrorMessage);
    await answerConfirm(true);
    await waitFor(() => expect(svc.updateExchangeRatePair).toHaveBeenCalledTimes(1));
    expect(svc.applyCatalogReprice).not.toHaveBeenCalled();
    expect(await screen.findByRole('status')).toHaveTextContent(R.staleTitle);
  });

  it('preview error: cancelling saves nothing', async () => {
    svc.previewCatalogReprice.mockResolvedValue({ error: { message: 'boom' } });
    await renderPage();
    await editAndSave('920');
    await findConfirmDialog();
    await answerConfirm(false);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(svc.updateExchangeRatePair).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('Retry with requires_extra_confirmation asks twice and applies with confirmLarge and the previewed rate', async () => {
    svc.getCatalogRepriceStatus.mockResolvedValue({ data: { rate: '520.000000', applied_at: '2026-11-01T00:00:00Z' } });
    svc.previewCatalogReprice.mockResolvedValue({ data: { ...LARGE, rate: 915 } });
    await renderPage();
    const banner = await screen.findByRole('status');
    fireEvent.click(within(banner).getByRole('button', { name: R.retry }));
    await findConfirmDialog();
    await answerConfirm(true);
    await waitFor(() => expect(screen.getByRole('alertdialog')).toHaveTextContent(R.secondTitle));
    expect(svc.applyCatalogReprice).not.toHaveBeenCalled();
    await answerConfirm(true);
    await waitFor(() => expect(svc.applyCatalogReprice).toHaveBeenCalledWith(true, 915));
  });
});

describe('other pairs', () => {
  it('does not preview for a pair other than USD<->CUP', async () => {
    svc.getAllExchangeRates.mockResolvedValue([rateRow('r1', USD, EUR, 0.92), rateRow('r2', EUR, USD, 1.0869)]);
    await renderPage('1 USD = 0.9200 EUR');
    await editAndSave('0.93');
    await waitFor(() => expect(svc.updateExchangeRatePair).toHaveBeenCalled());
    expect(svc.previewCatalogReprice).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

describe('stale prices indicator', () => {
  it('shows the banner on load when the active rate differs from the last run', async () => {
    svc.getCatalogRepriceStatus.mockResolvedValue({ data: { rate: '520.000000', applied_at: '2026-11-01T00:00:00Z' } });
    await renderPage();
    expect(await screen.findByRole('status')).toHaveTextContent(EN.settings.financial.repricing.staleTitle);
    expect(within(screen.getByRole('status')).getByRole('button', { name: EN.settings.financial.repricing.retry })).toBeInTheDocument();
  });

  it('shows nothing when the rates match, there was no run, or the RPC is unavailable', async () => {
    await renderPage();
    await waitFor(() => expect(svc.getCatalogRepriceStatus).toHaveBeenCalled());
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows nothing when the status is unavailable', async () => {
    svc.getCatalogRepriceStatus.mockResolvedValue({ unavailable: true });
    await renderPage();
    await waitFor(() => expect(svc.getCatalogRepriceStatus).toHaveBeenCalled());
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('a plain admin sees nothing new and nothing is requested', async () => {
    auth.isSuperAdmin = false;
    svc.getCatalogRepriceStatus.mockResolvedValue({ data: { rate: '520.000000' } });
    await renderPage();
    expect(svc.getCatalogRepriceStatus).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('translations', () => {
  it.each([['EN', EN], ['ES', ES]])('%s has the repricing strings', (_n, dict) => {
    ['confirmTitle', 'summary', 'confirmAction', 'largeWarning', 'secondTitle', 'secondMessage', 'secondAction',
      'rates', 'ratesNew', 'skippedProducts', 'rateChanged', 'rateChangedDesc', 'previewErrorTitle', 'previewErrorMessage', 'previewErrorAction',
      'applied', 'appliedDesc', 'applyFailed', 'applyFailedDesc', 'previewFailed', 'staleTitle', 'staleMessage', 'retry'].forEach((key) => {
      expect(dict.settings.financial.repricing[key], key).toEqual(expect.any(String));
    });
  });
});
