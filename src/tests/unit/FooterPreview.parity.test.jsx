import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, within } from '@testing-library/react';
import ES from '@/translations/ES.json';
import { BRAND_PRESET } from '@/lib/brandPalette';
import { LINK, SIGNATURE, MUTED, BRAND } from '@/lib/footerStyles';

const state = vi.hoisted(() => ({ settings: {} }));

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
  useBusiness: () => ({ visualSettings: state.settings }),
}));

import Footer from '@/components/Footer';
import FooterPreview from '@/components/settings/FooterPreview';
import { DEFAULT_VISUAL_SETTINGS } from '@/lib/businessVisualSettingsService';

const PROD = { ...DEFAULT_VISUAL_SETTINGS, useGradient: true, primaryColor: '#3499dc', secondaryColor: '#9333ea' };
const PRESET = { ...PROD, ...BRAND_PRESET };

const tokens = (el) => el.className.split(/\s+/);
const includesAll = (el, classes) => classes.split(/\s+/).every((c) => tokens(el).includes(c));

describe.each([
  ['production row', PROD],
  ['brand preset', PRESET],
])('Settings footer preview matches the real footer (%s)', (_name, settings) => {
  beforeEach(() => {
    state.settings = settings;
  });

  const mount = () => {
    const real = render(<Footer onNavigate={vi.fn()} showNotice={false} />).container.querySelector('footer');
    const previewView = render(<FooterPreview settings={settings} />);
    const preview = within(previewView.container).getByTestId('footer-preview');
    return { real, preview };
  };

  it('resolves the same CSS variables and background', () => {
    const { real, preview } = mount();
    expect(preview.getAttribute('style')).toBe(real.getAttribute('style'));
  });

  it('draws the same border, text, signature and company name classes', () => {
    const { real, preview } = mount();
    expect(includesAll(real, 'border-t border-[color:var(--ftr-border)]')).toBe(true);
    expect(includesAll(preview, 'border-t border-[color:var(--ftr-border)]')).toBe(true);

    const sig = within(preview).getByTestId('footer-preview-signature');
    const realSig = within(real).getByRole('link', { name: /Juan A\. Centelles/ });
    expect(includesAll(sig, SIGNATURE)).toBe(true);
    expect(includesAll(realSig, SIGNATURE)).toBe(true);

    const text = within(preview).getByTestId('footer-preview-text');
    expect(includesAll(text, MUTED)).toBe(true);
    const name = within(preview).getByTestId('footer-preview-name');
    expect(includesAll(name, BRAND)).toBe(true);
    for (const el of within(real).getAllByText(settings.companyName)) {
      expect(includesAll(el, BRAND)).toBe(true);
    }
  });

  it('has no inline colour and no mouse handlers on its elements', () => {
    const { preview } = mount();
    for (const id of ['footer-preview-text', 'footer-preview-signature', 'footer-preview-name']) {
      expect(within(preview).getByTestId(id).getAttribute('style')).toBeNull();
    }
  });
});

describe('footer style constants', () => {
  it('link classes take colour and hover from the footer variables', () => {
    expect(LINK).toContain('text-[color:var(--ftr-link)]');
    expect(LINK).toContain('hover:text-[color:var(--ftr-link-hover)]');
    expect(SIGNATURE).toContain('hover:text-[color:var(--ftr-sig-hover)]');
  });
});
