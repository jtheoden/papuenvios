/**
 * exchange_rates is writable by super_admin only (RLS, already in production). A plain admin must see the
 * rates read-only, with the reason visible, instead of an active editor that fails with a misleading error.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EN from '@/translations/EN.json';
import ES from '@/translations/ES.json';
import { ConfirmWrapper, findConfirmDialog, answerConfirm } from './helpers/confirmDialog';

const auth = vi.hoisted(() => ({ isSuperAdmin: false }));
const svc = vi.hoisted(() => ({
  getAllExchangeRates: vi.fn(),
  getAllCurrencies: vi.fn(),
  saveExchangeRatePair: vi.fn(),
  updateExchangeRatePair: vi.fn(),
  deleteExchangeRatePair: vi.fn(),
  deleteCurrency: vi.fn(),
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
  deleteCurrency: (...a) => svc.deleteCurrency(...a),
  getAllExchangeRates: (...a) => svc.getAllExchangeRates(...a),
  saveExchangeRate: vi.fn(),
  saveExchangeRatePair: (...a) => svc.saveExchangeRatePair(...a),
  deleteExchangeRate: vi.fn(),
  deleteExchangeRatePair: (...a) => svc.deleteExchangeRatePair(...a),
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
const rateRow = (id, from, to, rate) => ({
  id, rate, effective_date: '2026-10-12', updated_at: '2026-10-12T10:00:00Z', is_active: true,
  from_currency_id: from.id, to_currency_id: to.id, from_currency: from, to_currency: to
});
const NOTE_ID = 'rates-super-admin-only-note';
const CURRENCY_NOTE_ID = 'currency-delete-super-admin-only-note';

const renderPage = async () => {
  render(<SettingsPageFinancial localFinancial={{ productProfit: 40, comboProfit: 30 }} setLocalFinancial={vi.fn()} />, { wrapper: ConfirmWrapper });
  await screen.findByText('1 USD = 915.0000 CUP');
};

beforeEach(() => {
  Object.values(svc).forEach((fn) => fn.mockReset());
  svc.getAllCurrencies.mockResolvedValue([USD, CUP]);
  svc.getAllExchangeRates.mockResolvedValue([rateRow('r1', USD, CUP, 915), rateRow('r2', CUP, USD, 0.001093)]);
  svc.fetchReference.mockRejectedValue(new Error('no reference in this test'));
});

describe('translations of the read-only notes', () => {
  it.each([['EN', EN], ['ES', ES]])('%s has both notes', (_n, dict) => {
    expect(dict.settings.financial.ratesSuperAdminOnly).toEqual(expect.any(String));
    expect(dict.settings.financial.currencyDeleteSuperAdminOnly).toEqual(expect.any(String));
  });

  it('the Spanish copy addresses the user with usted, not tu', () => {
    expect(ES.settings.financial.ratesSuperAdminOnly).toMatch(/Puede consultarlas/);
  });
});

describe('plain admin (not super_admin): rates are read-only with the reason visible', () => {
  beforeEach(() => {
    auth.isSuperAdmin = false;
  });

  it('shows the note and keeps the rates readable', async () => {
    await renderPage();
    expect(screen.getAllByRole('note').length).toBeGreaterThan(0);
    expect(document.getElementById(NOTE_ID)).toHaveTextContent(EN.settings.financial.ratesSuperAdminOnly);
    expect(screen.getByText('1 USD = 915.0000 CUP')).toBeInTheDocument();
  });

  // aria-disabled (not the native attribute) keeps the control focusable, so a screen reader announces the note.
  const expectLocked = (button, noteId) => {
    expect(button).not.toBeDisabled();
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-describedby')).toBe(noteId);
    button.focus();
    expect(document.activeElement).toBe(button);
  };

  it('locks New Rate, Edit and Delete pair (aria-disabled, focusable), each tied to the note', async () => {
    await renderPage();
    const newRate = screen.getByRole('button', { name: /New Rate/ });
    const edit = screen.getByRole('button', { name: /Edit/ });
    const del = screen.getByTitle('Deactivate rate pair');
    [newRate, edit, del].forEach((button) => expectLocked(button, NOTE_ID));
  });

  it('never opens the editor nor calls a write service', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
    fireEvent.click(screen.getByRole('button', { name: /New Rate/ }));
    expect(screen.queryByText('Edit Rate Pair')).toBeNull();
    expect(screen.queryByText('Add New Exchange Rate')).toBeNull();
    expect(svc.saveExchangeRatePair).not.toHaveBeenCalled();
    expect(svc.updateExchangeRatePair).not.toHaveBeenCalled();
    expect(svc.deleteExchangeRatePair).not.toHaveBeenCalled();
  });

  it('locks deleting a currency (it deactivates its rates) with its own note', async () => {
    await renderPage();
    expect(document.getElementById(CURRENCY_NOTE_ID)).toHaveTextContent(EN.settings.financial.currencyDeleteSuperAdminOnly);
    const deleteButtons = screen.getAllByTitle('Delete currency');
    expect(deleteButtons.length).toBeGreaterThan(0);
    deleteButtons.forEach((button) => expectLocked(button, CURRENCY_NOTE_ID));
    fireEvent.click(deleteButtons[0]);
    expect(svc.deleteExchangeRatePair).not.toHaveBeenCalled();
  });
});

describe('super_admin keeps the full editor', () => {
  beforeEach(() => {
    auth.isSuperAdmin = true;
  });

  it('has no note and enabled controls', async () => {
    await renderPage();
    expect(document.getElementById(NOTE_ID)).toBeNull();
    expect(document.getElementById(CURRENCY_NOTE_ID)).toBeNull();
    expect(screen.getByRole('button', { name: /New Rate/ })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /Edit/ })).not.toBeDisabled();
    expect(screen.getByTitle('Deactivate rate pair')).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
    return waitFor(() => expect(screen.getByText('Edit Rate Pair')).toBeInTheDocument());
  });

  it('"delete pair" is honest: it deactivates, names the pair and states the consequence, only after confirming', async () => {
    svc.deleteExchangeRatePair.mockResolvedValue({ deletedCount: 2 });
    await renderPage();
    fireEvent.click(screen.getByTitle('Deactivate rate pair'));
    const dialog = await findConfirmDialog();
    expect(dialog).toHaveTextContent('USD <-> CUP');
    expect(dialog).toHaveTextContent(/no operations can be quoted with this rate/i);
    expect(svc.deleteExchangeRatePair).not.toHaveBeenCalled();
    await answerConfirm(true);
    await waitFor(() => expect(svc.deleteExchangeRatePair).toHaveBeenCalledWith('usd', 'cup'));
    expect(screen.queryByTitle('Delete rate pair')).toBeNull();
  });

  it('does not deactivate the pair when the confirmation is cancelled', async () => {
    await renderPage();
    fireEvent.click(screen.getByTitle('Deactivate rate pair'));
    await answerConfirm(false);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(svc.deleteExchangeRatePair).not.toHaveBeenCalled();
  });

  it.each([['EN', EN], ['ES', ES]])('%s has the deactivation strings', (_n, dict) => {
    ['deactivatePair', 'deactivatePairConfirm', 'pairDeactivated', 'pairDeactivatedDesc'].forEach((key) => {
      expect(dict.settings.financial[key]).toEqual(expect.any(String));
    });
  });
});
