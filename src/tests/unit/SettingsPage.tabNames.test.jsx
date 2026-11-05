import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// RB-04: below 640px the Settings tabs show only their icon; each one must still expose its name, and the
// label must not depend on the non-existent `xs` Tailwind breakpoint.

const { businessValue, authValue } = vi.hoisted(() => ({
  businessValue: {
    financialSettings: { productProfit: 45, comboProfit: 30 },
    notificationSettings: {},
    setNotificationSettings: () => {},
    refreshNotificationSettings: () => {},
    visualSettings: {},
    setVisualSettings: () => {},
    zelleAccounts: [],
    setZelleAccounts: () => {},
  },
  authValue: { user: { id: 'u1' }, isAdmin: true, isSuperAdmin: true },
}));

vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (key) => key, language: 'es' }) }));
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => businessValue }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => authValue }));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/lib/notificationSettingsService', () => ({ saveNotificationSettings: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn() } }));
vi.mock('@/components/settings/SettingsPageFinancial', () => ({ default: () => <div /> }));
vi.mock('@/components/settings/SettingsPageShipping', () => ({ default: () => <div /> }));
vi.mock('@/components/settings/SettingsPageVisual', () => ({ default: () => <div /> }));
vi.mock('@/components/settings/SettingsPageContent', () => ({ default: () => <div /> }));
vi.mock('@/components/settings/SettingsSystemTab', () => ({ default: () => <div /> }));
vi.mock('@/components/settings/PaymentMethodsStatusCard', () => ({ default: () => <div /> }));
vi.mock('@/components/settings/SettingsZelleTab', () => ({ default: () => <div /> }));

import SettingsPage from '@/components/SettingsPage';

describe('SettingsPage tab strip accessibility', () => {
  it('gives every tab an accessible name below the sm breakpoint', () => {
    const { container } = render(<SettingsPage />);

    const strip = container.querySelector('div.overflow-x-auto');
    const buttons = within(strip).getAllByRole('button');
    expect(buttons).toHaveLength(7);
    ['Financiero', 'Envíos', 'Visual', 'Pagos', 'Mensajería', 'Contenido', 'Sistema'].forEach((name) => {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    });
  });

  it('does not use the `xs:` variant, which tailwind.config.js does not define', () => {
    const source = readFileSync(resolve(__dirname, '../../components/SettingsPage.jsx'), 'utf8');
    expect(source).not.toMatch(/\bxs:/);
  });
});
