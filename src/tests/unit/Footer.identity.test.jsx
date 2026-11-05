import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, within } from '@testing-library/react';
import ES from '@/translations/ES.json';

const state = vi.hoisted(() => ({ visualSettings: {}, notificationSettings: {} }));

const translate = (key, params = {}) => {
  const value = key.split('.').reduce((acc, k) => (acc ? acc[k] : undefined), ES);
  if (typeof value !== 'string') return key;
  return Object.entries(params).reduce((acc, [k, v]) => acc.replace(`{${k}}`, v), value);
};

vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: translate, language: 'es' }),
}));
vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({ visualSettings: state.visualSettings, notificationSettings: state.notificationSettings }),
}));

import Footer from '@/components/Footer';

const mount = () => render(<Footer onNavigate={vi.fn()} showNotice={false} />).container.querySelector('footer');

describe('Footer business identity', () => {
  beforeEach(() => {
    state.visualSettings = { companyName: 'Acme Envios' };
    state.notificationSettings = {};
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('never shows a personal email; the developer credit stays, without email', () => {
    vi.stubEnv('VITE_SUPPORT_EMAIL', '');
    const footer = mount();
    expect(footer.textContent).not.toMatch(/@gmail\.com|jtheoden/i);
    const credit = within(footer).getByRole('link', { name: /Juan A\. Centelles/ });
    expect(credit.textContent).not.toMatch(/@/);
  });

  it('with support email and WhatsApp configured, shows company, mailto and wa.me links', () => {
    vi.stubEnv('VITE_SUPPORT_EMAIL', 'soporte@acme.test');
    state.notificationSettings = { whatsapp: '+1 (305) 555-0100' };
    const footer = mount();
    const identity = within(footer).getByRole('group', { name: ES.footer.identity.label });
    expect(within(identity).getByText('Acme Envios')).toBeInTheDocument();
    expect(within(identity).getByRole('link', { name: 'soporte@acme.test' })).toHaveAttribute('href', 'mailto:soporte@acme.test');
    const wa = within(identity).getByRole('link', { name: new RegExp(ES.footer.identity.whatsapp) });
    expect(wa.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/13055550100/);
  });

  it('without contact data, renders no identity block and invents nothing', () => {
    vi.stubEnv('VITE_SUPPORT_EMAIL', '');
    const footer = mount();
    expect(within(footer).queryByRole('group', { name: ES.footer.identity.label })).toBeNull();
    expect(footer.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(footer.querySelector('a[href*="wa.me"]')).toBeNull();
  });

  it('shows only the channel that exists (email only)', () => {
    vi.stubEnv('VITE_SUPPORT_EMAIL', 'soporte@acme.test');
    const footer = mount();
    const identity = within(footer).getByRole('group', { name: ES.footer.identity.label });
    expect(within(identity).getByRole('link', { name: 'soporte@acme.test' })).toBeInTheDocument();
    expect(identity.querySelector('a[href*="wa.me"]')).toBeNull();
  });
});
