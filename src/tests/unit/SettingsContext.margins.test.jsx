import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

const authState = { isAuthenticated: true, isAdmin: true };
const getMarginSettingsMock = vi.fn();

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => authState
}));

vi.mock('@/lib/financialSettingsService', () => ({
  getMarginSettings: (...args) => getMarginSettingsMock(...args)
}));

vi.mock('@/lib/notificationSettingsService', () => ({
  DEFAULT_SETTINGS: {},
  loadNotificationSettings: vi.fn().mockResolvedValue({}),
  getFreshNotificationSettings: vi.fn().mockResolvedValue({})
}));

vi.mock('@/lib/businessVisualSettingsService', () => ({
  DEFAULT_VISUAL_SETTINGS: {},
  loadVisualSettings: vi.fn().mockResolvedValue({}),
  saveVisualSettings: vi.fn().mockResolvedValue({ success: true }),
  applyVisualSettingsToDOM: vi.fn(),
  clearVisualSettingsCache: vi.fn()
}));

import { SettingsProvider, useSettings } from '@/contexts/SettingsContext';

let applyRef;
const Probe = () => {
  const { financialSettings, applyMarginSettings } = useSettings();
  applyRef = applyMarginSettings;
  return (
    <div>
      <span data-testid="product">{String(financialSettings.productProfit)}</span>
      <span data-testid="combo">{String(financialSettings.comboProfit)}</span>
    </div>
  );
};

const renderProvider = () => render(<SettingsProvider><Probe /></SettingsProvider>);

describe('SettingsContext global margins', () => {
  beforeEach(() => {
    window.localStorage.clear();
    getMarginSettingsMock.mockReset();
    authState.isAuthenticated = true;
    authState.isAdmin = true;
  });

  it('uses the DB values as source of truth for admins', async () => {
    getMarginSettingsMock.mockResolvedValue({ productProfit: 55, comboProfit: 22 });

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('product')).toHaveTextContent('55'));
    expect(screen.getByTestId('combo')).toHaveTextContent('22');
  });

  it('DB values win over stale localStorage values', async () => {
    window.localStorage.setItem('financialSettings', JSON.stringify({
      usdToLocal: 36.5, currencies: [], productProfit: 10, comboProfit: 11
    }));
    getMarginSettingsMock.mockResolvedValue({ productProfit: 55, comboProfit: 22 });

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('product')).toHaveTextContent('55'));
  });

  it('does not call the service for non-admin users and keeps the local values', async () => {
    authState.isAdmin = false;

    renderProvider();

    await act(async () => {});
    expect(getMarginSettingsMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('product')).toHaveTextContent('40');
    expect(screen.getByTestId('combo')).toHaveTextContent('35');
  });

  it('falls back to the previous localStorage values when the DB read fails', async () => {
    window.localStorage.setItem('financialSettings', JSON.stringify({
      usdToLocal: 36.5, currencies: [], productProfit: 12, comboProfit: 13
    }));
    getMarginSettingsMock.mockRejectedValue(new Error('permission denied'));

    renderProvider();

    await waitFor(() => expect(getMarginSettingsMock).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.getByTestId('product')).toHaveTextContent('12');
    expect(screen.getByTestId('combo')).toHaveTextContent('13');
  });

  it('keeps the fallback for a key that has no value in the DB', async () => {
    getMarginSettingsMock.mockResolvedValue({ productProfit: 50, comboProfit: null });

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('product')).toHaveTextContent('50'));
    expect(screen.getByTestId('combo')).toHaveTextContent('35');
  });

  it('applyMarginSettings updates the exposed values after an admin save', async () => {
    getMarginSettingsMock.mockResolvedValue({ productProfit: 40, comboProfit: 35 });

    renderProvider();
    await waitFor(() => expect(getMarginSettingsMock).toHaveBeenCalled());

    act(() => applyRef({ productProfit: 61, comboProfit: 62 }));

    expect(screen.getByTestId('product')).toHaveTextContent('61');
    expect(screen.getByTestId('combo')).toHaveTextContent('62');
  });
});
