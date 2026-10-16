import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Stable references: SettingsPage has effects keyed on these objects, so fresh
// objects per render would cause an infinite render loop.
const { businessValue, authValue, translate } = vi.hoisted(() => ({
  businessValue: {
    financialSettings: { productProfit: 45, comboProfit: 30 },
    notificationSettings: {},
    setNotificationSettings: () => {},
    refreshNotificationSettings: () => {},
    visualSettings: {},
    setVisualSettings: () => {},
    zelleAccounts: [],
    setZelleAccounts: () => {}
  },
  authValue: { user: { id: 'u1' }, isAdmin: true, isSuperAdmin: false },
  translate: (key) => key
}));

let currentLanguage = 'en';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: translate, language: currentLanguage })
}));

vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => businessValue }));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => authValue }));

vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/lib/notificationSettingsService', () => ({ saveNotificationSettings: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn() } }));

vi.mock('@/components/settings/SettingsPageFinancial', () => ({ default: () => <div>financial-tab</div> }));
vi.mock('@/components/settings/SettingsPageShipping', () => ({ default: () => <div>shipping-tab</div> }));
vi.mock('@/components/settings/SettingsPageVisual', () => ({ default: () => <div>visual-tab</div> }));
vi.mock('@/components/settings/SettingsPageContent', () => ({ default: () => <div>content-tab</div> }));
vi.mock('@/components/settings/SettingsSystemTab', () => ({ default: () => <div>system-tab</div> }));
vi.mock('@/components/settings/PaymentMethodsStatusCard', () => ({ default: () => <div>status-card</div> }));
vi.mock('@/components/settings/SettingsZelleTab', () => ({ default: () => <div>zelle-tab-content</div> }));

import SettingsPage from '@/components/SettingsPage';

describe('SettingsPage payments tab label', () => {
  beforeEach(() => {
    currentLanguage = 'en';
  });

  it('shows "Payments" instead of "Zelle" in the English UI', () => {
    render(<SettingsPage />);

    expect(screen.getByRole('button', { name: 'Payments' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Zelle' })).toBeNull();
  });

  it('shows "Pagos" in the Spanish UI', () => {
    currentLanguage = 'es';
    render(<SettingsPage />);

    expect(screen.getByRole('button', { name: 'Pagos' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Zelle' })).toBeNull();
  });

  it('still renders the Zelle settings content when the tab is clicked', () => {
    render(<SettingsPage />);

    expect(screen.queryByText('zelle-tab-content')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Payments' }));

    expect(screen.getByText('zelle-tab-content')).toBeTruthy();
    expect(screen.getByText('status-card')).toBeTruthy();
  });
});

describe('Dashboard payment history labels', () => {
  const es = JSON.parse(readFileSync(resolve(__dirname, '../../translations/ES.json'), 'utf8'));
  const en = JSON.parse(readFileSync(resolve(__dirname, '../../translations/EN.json'), 'utf8'));

  it('renames the dashboard tab and section title without the Zelle suffix', () => {
    expect(es.dashboard.zelleHistoryTab).toBe('Historial de Pagos');
    expect(en.dashboard.zelleHistoryTab).toBe('Payment History');
    expect(es.zelleHistory.title).toBe('Historial de Pagos');
    expect(en.zelleHistory.title).toBe('Payment History');
  });

  it('keeps the old Zelle-specific wording out of both locales', () => {
    expect(JSON.stringify(es)).not.toContain('Historial de Pagos Zelle');
    expect(JSON.stringify(en)).not.toContain('Zelle Payment History');
  });
});
