import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { svc, business, auth } = vi.hoisted(() => ({
  auth: { user: { id: 'u1' }, isAdmin: true, isSuperAdmin: false },
  svc: { settings: vi.fn(), fx: vi.fn(), accounts: vi.fn() },
  // Stable references: SettingsPage syncs local state from these in effects (new objects would loop).
  business: {
    financialSettings: {}, notificationSettings: {}, setNotificationSettings: () => {}, refreshNotificationSettings: () => {},
    visualSettings: {}, setVisualSettings: () => {}, zelleAccounts: [], setZelleAccounts: () => {}
  }
}));

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/contexts/LanguageContext', async () => {
  const { tEcho } = await import('./helpers/bizumTestUtils.js');
  return { useLanguage: () => ({ t: tEcho, language: 'en' }) };
});
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => business }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('@/lib/notificationSettingsService', () => ({ saveNotificationSettings: vi.fn() }));
vi.mock('@/components/settings/SettingsPageFinancial', () => ({ default: () => null }));
vi.mock('@/components/settings/SettingsPageShipping', () => ({ default: () => null }));
vi.mock('@/components/settings/SettingsPageVisual', () => ({ default: () => null }));
vi.mock('@/components/settings/SettingsPageContent', () => ({ default: () => null }));
vi.mock('@/components/settings/SettingsSystemTab', () => ({ default: () => null }));
vi.mock('@/components/settings/PaymentMethodsStatusCard', () => ({ default: () => <p>status-card</p> }));
vi.mock('@/components/settings/SettingsZelleTab', () => ({ default: () => <h3>zelle-tab-content</h3> }));
vi.mock('@/hooks/usePaymentMethods', () => ({
  usePaymentMethods: () => ({ methods: [{ code: 'zelle' }, { code: 'bizum' }], loading: false, error: null, refresh: vi.fn() })
}));
vi.mock('@/lib/bizumService', async (importOriginal) => ({
  ...(await importOriginal()),
  getBizumSettings: (...a) => svc.settings(...a),
  listBizumAccounts: (...a) => svc.accounts(...a)
}));
vi.mock('@/lib/paymentFxService', async (importOriginal) => ({
  ...(await importOriginal()),
  getPaymentFxStatus: (...a) => svc.fx(...a)
}));

import SettingsPage from '@/components/SettingsPage';
import { toBizumError } from '@/lib/bizumErrors';

const openPaymentsTab = () => fireEvent.click(screen.getByText('Zelle'));

beforeEach(() => {
  svc.settings.mockReset().mockResolvedValue({ default_spread_pct: 1.5, default_per_operation_limit: 1000, fx_warn_hours: 24, fx_block_hours: 96 });
  svc.fx.mockReset().mockResolvedValue({ state: 'none', id: null, fx_warn_hours: 24, fx_block_hours: 96 });
  svc.accounts.mockReset().mockResolvedValue([]);
});

describe('SettingsPage payments tab', () => {
  it('mounts the Bizum section after Zelle, keeping a single H1 and the Zelle content', async () => {
    render(<SettingsPage />);
    openPaymentsTab();
    expect(screen.getByText('zelle-tab-content')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 2, name: 'settings.bizum.title' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('keeps Zelle when the Bizum RPCs fail', async () => {
    svc.settings.mockRejectedValue(toBizumError({ code: 'XX000', message: 'boom' }));
    render(<SettingsPage />);
    openPaymentsTab();
    await waitFor(() => expect(svc.settings).toHaveBeenCalled());
    expect(screen.getByText('zelle-tab-content')).toBeInTheDocument();
    expect(await screen.findAllByRole('alert')).not.toHaveLength(0);
  });

  it('keeps Zelle and shows no Bizum section when the schema is not deployed', async () => {
    svc.settings.mockRejectedValue(toBizumError({ code: 'PGRST202', message: 'Could not find the function' }));
    render(<SettingsPage />);
    openPaymentsTab();
    await waitFor(() => expect(svc.settings).toHaveBeenCalled());
    expect(screen.getByText('zelle-tab-content')).toBeInTheDocument();
    expect(screen.queryByText('settings.bizum.title')).toBeNull();
  });
});
