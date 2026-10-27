import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const auth = vi.hoisted(() => ({ isSuperAdmin: false }));
const svc = vi.hoisted(() => ({
  getAllExchangeRates: vi.fn(),
  deleteExchangeRatePair: vi.fn(),
  deleteCurrency: vi.fn()
}));

vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/lib/financialSettingsService', () => ({ saveMarginSettings: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ isSuperAdmin: auth.isSuperAdmin }) }));
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'en' })
}));
vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({ visualSettings: {}, applyMarginSettings: vi.fn() })
}));
vi.mock('@/components/settings/FxReferenceCard', () => ({
  default: ({ disabledReason, lockedBy }) => <div data-testid="fx-card" data-locked-by={lockedBy ?? ''}>{disabledReason}</div>
}));

const usd = { id: 'usd', code: 'USD', name_en: 'US Dollar', name_es: 'Dolar', symbol: '$', is_active: true, is_base: true };
const cup = { id: 'cup', code: 'CUP', name_en: 'Peso', name_es: 'Peso', symbol: '$', is_active: true, is_base: false };
const rate = (from, to, value) => ({
  id: `${from.id}-${to.id}`, rate: value, effective_date: '2026-10-27', updated_at: null, is_active: true,
  from_currency_id: from.id, to_currency_id: to.id, from_currency: from, to_currency: to
});

vi.mock('@/lib/currencyService', () => ({
  getCurrencies: vi.fn().mockResolvedValue([]),
  getAllCurrencies: vi.fn().mockResolvedValue([
    { id: 'usd', code: 'USD', name_en: 'US Dollar', name_es: 'Dolar', symbol: '$', is_active: true, is_base: true },
    { id: 'cup', code: 'CUP', name_en: 'Peso', name_es: 'Peso', symbol: '$', is_active: true, is_base: false }
  ]),
  createCurrency: vi.fn(),
  updateCurrency: vi.fn(),
  deleteCurrency: (...a) => svc.deleteCurrency(...a),
  fetchOfficialRates: vi.fn().mockResolvedValue({}),
  getAllExchangeRates: (...a) => svc.getAllExchangeRates(...a),
  saveExchangeRate: vi.fn(),
  deleteExchangeRate: vi.fn(),
  deleteExchangeRatePair: (...a) => svc.deleteExchangeRatePair(...a),
  updateExchangeRatePair: vi.fn()
}));
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), auth: { refreshSession: vi.fn() } } }));

import SettingsPageFinancial from '@/components/settings/SettingsPageFinancial';

const renderPage = () =>
  render(<SettingsPageFinancial localFinancial={{ productProfit: 40, comboProfit: 30 }} setLocalFinancial={vi.fn()} />);

describe('SettingsPageFinancial: exchange rates are super_admin-only (DEC-10)', () => {
  beforeEach(() => {
    svc.getAllExchangeRates.mockReset().mockResolvedValue([rate(usd, cup, '790'), rate(cup, usd, '0.00126')]);
    svc.deleteExchangeRatePair.mockReset();
    svc.deleteCurrency.mockReset();
  });

  describe('plain admin', () => {
    beforeEach(() => { auth.isSuperAdmin = false; });

    it('still sees the rates but gets a visible role="note" reason', async () => {
      renderPage();
      expect(await screen.findByText(/790/)).toBeTruthy();
      const notes = screen.getAllByRole('note');
      expect(notes.some((n) => n.id === 'rates-super-admin-only-note' && n.textContent.includes('settings.financial.ratesSuperAdminOnly'))).toBe(true);
    });

    it('disables new / edit / delete rate controls with aria-disabled and aria-describedby pointing at the note', async () => {
      renderPage();
      await screen.findByText(/790/);
      const controls = [
        screen.getByTitle('settings.financial.newRate'),
        screen.getByTitle('Edit rate pair'),
        screen.getByTitle('Delete rate pair')
      ];
      for (const el of controls) {
        const button = el.closest('button');
        expect(button.disabled).toBe(true);
        expect(button.getAttribute('aria-disabled')).toBe('true');
        expect(button.getAttribute('aria-describedby')).toBe('rates-super-admin-only-note');
        expect(document.getElementById('rates-super-admin-only-note')).toBeTruthy();
      }
    });

    it('disables currency deletion (it would silently deactivate rates) with its own visible reason', async () => {
      renderPage();
      await screen.findByText(/790/);
      const del = screen.getByTitle('Delete currency').closest('button');
      expect(del.disabled).toBe(true);
      expect(del.getAttribute('aria-describedby')).toBe('currency-delete-super-admin-only-note');
      expect(document.getElementById('currency-delete-super-admin-only-note').getAttribute('role')).toBe('note');
    });

    it('locks the FX reference card by pointing at the note (reason shown once, not repeated)', async () => {
      renderPage();
      const card = await screen.findByTestId('fx-card');
      expect(card.getAttribute('data-locked-by')).toBe('rates-super-admin-only-note');
      expect(card.textContent).not.toContain('settings.financial.ratesSuperAdminOnly');
    });

    it('never calls a rate write', async () => {
      renderPage();
      await screen.findByText(/790/);
      fireEvent.click(screen.getByTitle('Delete rate pair').closest('button'));
      expect(svc.deleteExchangeRatePair).not.toHaveBeenCalled();
    });
  });

  describe('super_admin', () => {
    beforeEach(() => { auth.isSuperAdmin = true; });

    it('has no note and enabled controls, as before', async () => {
      renderPage();
      await screen.findByText(/790/);
      expect(screen.queryByRole('note')).toBeNull();
      for (const title of ['settings.financial.newRate', 'Edit rate pair', 'Delete rate pair']) {
        const button = screen.getByTitle(title).closest('button');
        expect(button.disabled).toBe(false);
        expect(button.getAttribute('aria-disabled')).toBeNull();
      }
      expect(screen.getByTestId('fx-card').getAttribute('data-locked-by')).toBe('');
    });
  });
});
