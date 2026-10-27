import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const toastMock = vi.fn();
const saveMarginSettingsMock = vi.fn();
const applyMarginSettingsMock = vi.fn();

vi.mock('@/components/ui/use-toast', () => ({
  toast: (...args) => toastMock(...args)
}));

vi.mock('@/lib/financialSettingsService', () => ({
  saveMarginSettings: (...args) => saveMarginSettingsMock(...args)
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ isSuperAdmin: true }) }));
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'en' })
}));

vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({ visualSettings: {}, applyMarginSettings: applyMarginSettingsMock })
}));

vi.mock('@/lib/currencyService', () => ({
  getCurrencies: vi.fn().mockResolvedValue([]),
  getAllCurrencies: vi.fn().mockResolvedValue([]),
  createCurrency: vi.fn(),
  updateCurrency: vi.fn(),
  deleteCurrency: vi.fn(),
  fetchOfficialRates: vi.fn().mockResolvedValue([]),
  getAllExchangeRates: vi.fn().mockResolvedValue([]),
  saveExchangeRate: vi.fn(),
  deleteExchangeRate: vi.fn(),
  deleteExchangeRatePair: vi.fn(),
  updateExchangeRatePair: vi.fn()
}));

vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn() } }));

import SettingsPageFinancial from '@/components/settings/SettingsPageFinancial';

const renderPage = (financial = { productProfit: 45, comboProfit: 30 }) =>
  render(<SettingsPageFinancial localFinancial={financial} setLocalFinancial={vi.fn()} />);

const clickSave = () => fireEvent.click(screen.getByText('common.saveSettings').closest('button'));

describe('SettingsPageFinancial global margins save', () => {
  beforeEach(() => {
    toastMock.mockReset();
    saveMarginSettingsMock.mockReset();
    applyMarginSettingsMock.mockReset();
  });

  it('persists both margins, updates the context and shows the success toast', async () => {
    saveMarginSettingsMock.mockResolvedValue({ productProfit: 45, comboProfit: 30 });

    renderPage();
    clickSave();

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith({ title: 'settings.saveSuccess' }));
    expect(saveMarginSettingsMock).toHaveBeenCalledWith({ productProfit: 45, comboProfit: 30 });
    expect(applyMarginSettingsMock).toHaveBeenCalledWith({ productProfit: 45, comboProfit: 30 });
  });

  it('shows a destructive error toast and does not claim success when the save fails', async () => {
    saveMarginSettingsMock.mockRejectedValue(new Error('permission denied'));

    renderPage();
    clickSave();

    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'common.error',
      description: 'settings.financial.marginSaveError',
      variant: 'destructive'
    }));
    expect(toastMock).not.toHaveBeenCalledWith({ title: 'settings.saveSuccess' });
    expect(applyMarginSettingsMock).not.toHaveBeenCalled();
  });

  it('blocks invalid values with a validation toast', async () => {
    const validationError = Object.assign(new Error('Invalid profit margin'), { code: 'VALIDATION_FAILED' });
    saveMarginSettingsMock.mockRejectedValue(validationError);

    renderPage({ productProfit: NaN, comboProfit: 30 });
    clickSave();

    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      description: 'settings.financial.marginInvalid',
      variant: 'destructive'
    }));
    expect(toastMock).not.toHaveBeenCalledWith({ title: 'settings.saveSuccess' });
    expect(applyMarginSettingsMock).not.toHaveBeenCalled();
  });
});
