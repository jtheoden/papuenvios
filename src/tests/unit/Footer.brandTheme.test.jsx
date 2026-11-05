import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';
import { BRAND_PRESET } from '@/lib/brandPalette';
import { DEFAULT_VISUAL_SETTINGS } from '@/lib/businessVisualSettingsService';

const state = vi.hoisted(() => ({ lang: 'es', settings: {} }));

const translate = (key, params = {}) => {
  const dict = state.lang === 'es' ? ES : EN;
  const value = key.split('.').reduce((acc, k) => (acc ? acc[k] : undefined), dict);
  if (typeof value !== 'string') return key;
  return Object.entries(params).reduce((acc, [k, v]) => acc.replace(`{${k}}`, v), value);
};

vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: translate, language: state.lang }),
}));
vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({ visualSettings: state.settings }),
}));

import Footer from '@/components/Footer';

const PROD = {
  ...DEFAULT_VISUAL_SETTINGS,
  useGradient: true,
  primaryColor: '#3499dc',
  secondaryColor: '#9333ea',
};
const PRESET = { ...PROD, ...BRAND_PRESET };
const POISON = { primaryColor: '#abcdef', secondaryColor: '#fedcba', accentColor: '#123456' };
const POISON_RGB = ['rgb(171, 205, 239)', 'rgb(254, 220, 186)', 'rgb(18, 52, 86)'];

const mount = (settings, props = {}) => {
  state.settings = settings;
  const view = render(<Footer onNavigate={vi.fn()} {...props} />);
  const footer = view.container.querySelector('footer');
  return { ...view, footer, cssVar: (name) => footer.style.getPropertyValue(name) };
};

const hasClass = (el, name) => el.className.split(/\s+/).includes(name);

describe('Footer brand theme (S4)', () => {
  beforeEach(() => {
    state.lang = 'es';
    state.settings = {};
  });

  it('exposes the footer colours as CSS variables on the footer root', () => {
    const { footer, cssVar } = mount(PRESET);
    expect(footer.style.backgroundColor).toBe('rgb(255, 255, 255)');
    expect(cssVar('--ftr-link')).toBe('#171717');
    expect(cssVar('--ftr-link-hover')).toBe('#605B52');
    expect(cssVar('--ftr-text')).toBe('#605B52');
    expect(cssVar('--ftr-brand')).toBe('#171717');
  });

  it('keeps the production look until the preset is applied (blue links, primary-coloured name)', () => {
    const { cssVar } = mount(PROD);
    expect(cssVar('--ftr-link')).toBe('#2563eb');
    expect(cssVar('--ftr-sig-hover')).toBe('#9333ea');
    expect(cssVar('--ftr-link-hover')).toBe('#2563eb');
    expect(cssVar('--ftr-brand')).toBe('#3499dc');
    expect(cssVar('--ftr-text-opacity')).toBe('0.8');
  });

  it('does not depend on primary/secondary/accent colours once the preset is applied (poisoned settings)', () => {
    const { container } = mount({ ...PRESET, ...POISON });
    const html = container.innerHTML.toLowerCase();
    Object.values(POISON).forEach((hex) => expect(html).not.toContain(hex));
    POISON_RGB.forEach((rgb) => expect(html).not.toContain(rgb));
  });

  it('hover and focus come from classes: no inline colour on the signature link and no mouse handlers', () => {
    const { footer } = mount(PRESET);
    const dev = within(footer).getByRole('link', { name: /Juan A\. Centelles/ });
    expect(dev.getAttribute('style')).toBeNull();
    expect(hasClass(dev, 'text-[color:var(--ftr-link)]')).toBe(true);
    expect(hasClass(dev, 'hover:text-[color:var(--ftr-sig-hover)]')).toBe(true);
    expect(dev.className).toMatch(/focus-visible:ring-2/);
    fireEvent.mouseEnter(dev);
    expect(dev.getAttribute('style')).toBeNull();
  });

  it('gives every legal link and the cookie preferences button the link colour and a visible focus ring', () => {
    const { footer } = mount(PRESET);
    const nav = within(footer).getByRole('navigation', { name: ES.legal.nav.label });
    const items = [
      ...within(nav).getAllByRole('link'),
      within(nav).getByRole('button', { name: ES.cookieConsent.preferencesLink }),
    ];
    expect(items).toHaveLength(4);
    for (const item of items) {
      expect(hasClass(item, 'text-[color:var(--ftr-link)]'), item.textContent).toBe(true);
      expect(hasClass(item, 'hover:text-[color:var(--ftr-link-hover)]'), item.textContent).toBe(true);
      expect(item.className, item.textContent).toMatch(/focus-visible:ring-2/);
      expect(item.getAttribute('style'), item.textContent).toBeNull();
    }
  });

  it('styles the company name from the footer brand variable, never an inline colour', () => {
    const { footer } = mount(PRESET);
    const names = within(footer).getAllByText(DEFAULT_VISUAL_SETTINGS.companyName);
    expect(names.length).toBeGreaterThanOrEqual(2);
    for (const name of names) {
      expect(hasClass(name, 'text-[color:var(--ftr-brand)]')).toBe(true);
      expect(name.getAttribute('style')).toBeNull();
    }
  });

  it('keeps the legal notice text and the legal links exactly as they were', () => {
    const { footer } = mount(PRESET);
    const note = within(footer).getByRole('note');
    for (const key of ['notBank', 'zelleIrreversible', 'deliveryEstimates', 'ofac']) {
      expect(note.textContent).toContain(ES.legal.notice[key]);
    }
    expect(within(note).getByRole('link', { name: ES.legal.notice.seeTerms })).toBeInTheDocument();
    for (const label of [ES.legal.links.terms, ES.legal.links.privacy, ES.legal.links.refunds]) {
      expect(within(footer).getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(within(footer).getByText(ES.footer.copyright, { exact: false })).toBeInTheDocument();
  });

  it('hides the notice when showNotice is false and still renders the rest', () => {
    const { footer } = mount(PRESET, { showNotice: false });
    expect(within(footer).queryByRole('note')).toBeNull();
    expect(within(footer).getByRole('navigation', { name: ES.legal.nav.label })).toBeInTheDocument();
  });

  it('renders the same structure in English', () => {
    state.lang = 'en';
    const { footer } = mount(PRESET);
    expect(within(footer).getByRole('link', { name: EN.legal.links.terms })).toBeInTheDocument();
    expect(screen.getByText(EN.footer.copyright, { exact: false })).toBeInTheDocument();
  });
});
