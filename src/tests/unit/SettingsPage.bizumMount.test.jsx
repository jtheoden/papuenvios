import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { svc, business, auth, catalog } = vi.hoisted(() => ({
  auth: { user: { id: 'u1' }, isAdmin: true, isSuperAdmin: false },
  catalog: { methods: [{ code: 'zelle' }, { code: 'bizum' }], error: null },
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
  usePaymentMethods: () => ({ methods: catalog.methods, loading: false, error: catalog.error, refresh: vi.fn() })
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

// The tab is labelled Zelle, Pagos or Payments depending on the build/language: match any.
const openPaymentsTab = () => fireEvent.click(screen.getByText(/^(Zelle|Pagos|Payments)$/));
// framer-motion starts the page at opacity 0 in jsdom, so visibility is judged by the panel's `hidden` flag.
const panelOf = (text) => screen.getByText(text, { hidden: true }).closest('[role="tabpanel"]');
// The tab only appears once the first Bizum probe has answered.
const openBizumTab = async () => fireEvent.click(await screen.findByRole('tab', { name: 'settings.payments.tabs.bizum' }));

beforeEach(() => {
  window.history.replaceState({}, '', '/');
  catalog.methods = [{ code: 'zelle' }, { code: 'bizum' }];
  catalog.error = null;
  svc.settings.mockReset().mockResolvedValue({ default_spread_pct: 1.5, default_per_operation_limit: 1000, fx_warn_hours: 24, fx_block_hours: 96 });
  svc.fx.mockReset().mockResolvedValue({ state: 'none', id: null, fx_warn_hours: 24, fx_block_hours: 96 });
  svc.accounts.mockReset().mockResolvedValue([]);
});

describe('SettingsPage payments tab', () => {
  it('mounts the Bizum section in its own tab, keeping a single H1 and the Zelle content', async () => {
    render(<SettingsPage />);
    openPaymentsTab();
    expect(screen.getByText('zelle-tab-content')).toBeInTheDocument();
    await openBizumTab();
    expect(await screen.findByRole('heading', { level: 2, name: 'settings.bizum.title' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('keeps Zelle when the Bizum RPCs fail', async () => {
    svc.settings.mockRejectedValue(toBizumError({ code: 'XX000', message: 'boom' }));
    render(<SettingsPage />);
    openPaymentsTab();
    await openBizumTab();
    await waitFor(() => expect(svc.settings).toHaveBeenCalled());
    expect(screen.getByText('zelle-tab-content')).toBeInTheDocument();
    expect(await screen.findAllByRole('alert')).not.toHaveLength(0);
  });

  it('keeps Zelle and shows neither a Bizum tab nor a Bizum section when the schema is not deployed', async () => {
    svc.settings.mockRejectedValue(toBizumError({ code: 'PGRST202', message: 'Could not find the function' }));
    render(<SettingsPage />);
    openPaymentsTab();
    await waitFor(() => expect(svc.settings).toHaveBeenCalled());
    expect(screen.getByText('zelle-tab-content')).toBeInTheDocument();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByText('settings.bizum.title')).toBeNull();
    expect(svc.fx).not.toHaveBeenCalled();
    expect(svc.accounts).not.toHaveBeenCalled();
  });

  it('probes Bizum once to decide the tab, but loads FX and accounts only when the Bizum tab is opened', async () => {
    render(<SettingsPage />);
    openPaymentsTab();
    await screen.findByRole('tab', { name: 'settings.payments.tabs.bizum' });

    expect(screen.getByRole('tab', { name: 'settings.payments.tabs.zelle' })).toHaveAttribute('aria-selected', 'true');
    expect(panelOf('zelle-tab-content')).not.toHaveAttribute('hidden');
    expect(svc.settings).toHaveBeenCalledTimes(1);
    expect(svc.fx).not.toHaveBeenCalled();
    expect(svc.accounts).not.toHaveBeenCalled();

    await openBizumTab();
    await waitFor(() => expect(svc.accounts).toHaveBeenCalled());
  });

  it('keeps Zelle mounted (hidden) while Bizum is open', async () => {
    render(<SettingsPage />);
    openPaymentsTab();
    await openBizumTab();

    expect(await screen.findByRole('heading', { level: 2, name: 'settings.bizum.title' })).toBeInTheDocument();
    expect(panelOf('zelle-tab-content')).toHaveAttribute('hidden');
  });

  it('opens the Bizum tab straight from ?paymentsTab=bizum', async () => {
    window.history.replaceState({}, '', '/?paymentsTab=bizum');
    render(<SettingsPage />);
    openPaymentsTab();

    expect(await screen.findByRole('heading', { level: 2, name: 'settings.bizum.title' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'settings.payments.tabs.bizum' })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows only Zelle, with no tablist, when the catalog has no Bizum row', () => {
    catalog.methods = [{ code: 'zelle' }];
    render(<SettingsPage />);
    openPaymentsTab();

    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByText('zelle-tab-content')).toBeInTheDocument();
    expect(svc.settings).not.toHaveBeenCalled();
  });

  it('hides the Bizum tab when the catalog read says the schema is not deployed', () => {
    catalog.methods = null;
    catalog.error = Object.assign(new Error('schema cache'), { context: { schemaMissing: true } });
    render(<SettingsPage />);
    openPaymentsTab();

    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.getByText('zelle-tab-content')).toBeInTheDocument();
  });

  it('keeps the Bizum tab reachable when the catalog fails for another reason, so its retry alert can show', async () => {
    catalog.methods = null;
    catalog.error = new Error('network down');
    render(<SettingsPage />);
    openPaymentsTab();
    await openBizumTab();

    expect(await screen.findByText('settings.bizum.loadError')).toBeInTheDocument();
    expect(screen.getByText('zelle-tab-content', { hidden: true })).toBeInTheDocument();
  });
});
