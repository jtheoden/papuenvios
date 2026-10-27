import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const toastMock = vi.fn();
const svc = vi.hoisted(() => ({
  getAllExchangeRates: vi.fn(),
  refreshSession: vi.fn()
}));

vi.mock('@/components/ui/use-toast', () => ({
  toast: (...args) => toastMock(...args)
}));
vi.mock('@/lib/financialSettingsService', () => ({ saveMarginSettings: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ isSuperAdmin: true }) }));
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'en' })
}));
vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({ visualSettings: {}, applyMarginSettings: vi.fn() })
}));
vi.mock('@/lib/currencyService', () => ({
  getCurrencies: vi.fn().mockResolvedValue([]),
  getAllCurrencies: vi.fn().mockResolvedValue([]),
  createCurrency: vi.fn(),
  updateCurrency: vi.fn(),
  deleteCurrency: vi.fn(),
  fetchOfficialRates: vi.fn().mockResolvedValue({}),
  getAllExchangeRates: (...a) => svc.getAllExchangeRates(...a),
  saveExchangeRate: vi.fn(),
  deleteExchangeRate: vi.fn(),
  deleteExchangeRatePair: vi.fn(),
  updateExchangeRatePair: vi.fn()
}));
vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn(), auth: { refreshSession: (...a) => svc.refreshSession(...a) } }
}));

import SettingsPageFinancial from '@/components/settings/SettingsPageFinancial';

const permissionDenied = Object.assign(new Error('permission denied for table exchange_rates'), { code: '42501' });

const renderPage = () =>
  render(<SettingsPageFinancial localFinancial={{ productProfit: 40, comboProfit: 30 }} setLocalFinancial={vi.fn()} />);

describe('SettingsPageFinancial expired session (401 / 42501)', () => {
  beforeEach(() => {
    toastMock.mockReset();
    svc.getAllExchangeRates.mockReset();
    svc.refreshSession.mockReset();
  });

  it('shows a clear session-expired message instead of the raw database error', async () => {
    svc.getAllExchangeRates.mockRejectedValue(permissionDenied);

    renderPage();

    expect(await screen.findByText('settings.financial.sessionExpired')).toBeTruthy();
    expect(screen.queryByText(/permission denied/)).toBeNull();
    expect(screen.getByText('settings.financial.sessionExpiredRetry').closest('button')).toBeTruthy();
  });

  it('refreshes the session and reloads the rates on retry', async () => {
    svc.getAllExchangeRates.mockRejectedValueOnce(permissionDenied).mockResolvedValue([]);
    svc.refreshSession.mockResolvedValue({ data: { session: { access_token: 't' } }, error: null });

    renderPage();
    fireEvent.click((await screen.findByText('settings.financial.sessionExpiredRetry')).closest('button'));

    await waitFor(() => expect(svc.refreshSession).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(svc.getAllExchangeRates).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('settings.financial.sessionExpired')).toBeNull());
  });

  it('asks to sign in again when the refresh fails', async () => {
    svc.getAllExchangeRates.mockRejectedValue(permissionDenied);
    svc.refreshSession.mockResolvedValue({ data: { session: null }, error: new Error('refresh_token_not_found') });

    renderPage();
    fireEvent.click((await screen.findByText('settings.financial.sessionExpiredRetry')).closest('button'));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'settings.financial.sessionExpiredSignIn', variant: 'destructive' })
      )
    );
    expect(screen.getByText('settings.financial.sessionExpired')).toBeTruthy();
  });
});
