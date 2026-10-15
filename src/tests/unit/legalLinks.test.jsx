import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';

const lang = { current: 'es' };

const translate = (key, params = {}) => {
  const dict = lang.current === 'es' ? ES : EN;
  const value = key.split('.').reduce((acc, k) => (acc ? acc[k] : undefined), dict);
  if (typeof value !== 'string') return key;
  return Object.entries(params).reduce((acc, [k, v]) => acc.replace(`{${k}}`, v), value);
};

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: translate, language: lang.current }),
}));

vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({ visualSettings: {} }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ signInWithGoogle: vi.fn() }),
}));

vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));

import Footer from '@/components/Footer';
import LoginPage from '@/components/LoginPage';
import LegalConsentLine from '@/components/LegalConsentLine';
import RegulatoryNotice from '@/components/RegulatoryNotice';

beforeEach(() => {
  lang.current = 'es';
});

describe('translations parity for the legal namespace', () => {
  const flatten = (obj, prefix = '') =>
    Object.entries(obj).flatMap(([k, v]) =>
      typeof v === 'object' && v !== null ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]
    );

  it('has the same legal keys in ES and EN', () => {
    expect(ES.legal).toBeDefined();
    expect(EN.legal).toBeDefined();
    expect(flatten(ES.legal).sort()).toEqual(flatten(EN.legal).sort());
  });
});

describe('LegalConsentLine', () => {
  it('renders real links to /terms and /privacy and navigates without reloading', () => {
    const onNavigate = vi.fn();
    render(<LegalConsentLine variant="confirm" onNavigate={onNavigate} />);

    const terms = screen.getByRole('link', { name: ES.legal.links.terms });
    const privacy = screen.getByRole('link', { name: ES.legal.links.privacy });
    expect(terms).toHaveAttribute('href', '/terms');
    expect(privacy).toHaveAttribute('href', '/privacy');

    fireEvent.click(terms);
    expect(onNavigate).toHaveBeenCalledWith('terms');
    fireEvent.click(privacy);
    expect(onNavigate).toHaveBeenCalledWith('privacy');
  });

  it('does not hijack modified clicks (open in new tab)', () => {
    const onNavigate = vi.fn();
    render(<LegalConsentLine variant="continue" onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('link', { name: ES.legal.links.terms }), { ctrlKey: true });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('uses the English copy when the language is en', () => {
    lang.current = 'en';
    render(<LegalConsentLine variant="confirm" onNavigate={vi.fn()} />);
    expect(screen.getByRole('link', { name: EN.legal.links.terms })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(EN.legal.consent.confirm))).toBeInTheDocument();
  });
});

describe('RegulatoryNotice', () => {
  it('states the required points without any license claim', () => {
    render(<RegulatoryNotice onNavigate={vi.fn()} />);
    const note = screen.getByRole('note');
    const text = note.textContent;
    expect(text).toContain(ES.legal.notice.notBank);
    expect(text).toContain(ES.legal.notice.zelleIrreversible);
    expect(text).toContain(ES.legal.notice.deliveryEstimates);
    expect(text).toContain(ES.legal.notice.ofac);
    expect(text.toLowerCase()).not.toMatch(/licencia|licensed|autorizad|registrad/);
  });

  it('links to the terms', () => {
    const onNavigate = vi.fn();
    render(<RegulatoryNotice onNavigate={onNavigate} />);
    const link = within(screen.getByRole('note')).getByRole('link');
    expect(link).toHaveAttribute('href', '/terms');
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith('terms');
  });
});

describe('Footer legal links', () => {
  it('links to terms, privacy and the refund section, and shows the notice', () => {
    const onNavigate = vi.fn();
    render(<Footer onNavigate={onNavigate} />);

    expect(screen.getByRole('link', { name: ES.legal.links.terms })).toHaveAttribute('href', '/terms');
    expect(screen.getByRole('link', { name: ES.legal.links.privacy })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: ES.legal.links.refunds })).toHaveAttribute(
      'href',
      '/terms#refunds'
    );
    expect(screen.getByText(ES.legal.notice.notBank)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: ES.legal.links.refunds }));
    expect(onNavigate).toHaveBeenCalledWith('terms');
  });

  it('labels the legal links nav distinctly from the notice', () => {
    render(<Footer onNavigate={vi.fn()} />);
    expect(ES.legal.nav.label).not.toBe(ES.legal.notice.title);
    expect(screen.getByRole('navigation', { name: ES.legal.nav.label })).toBeInTheDocument();
    expect(screen.getByRole('note', { name: ES.legal.notice.title })).toBeInTheDocument();
  });

  it('omits the regulatory notice when showNotice is false but keeps the links', () => {
    render(<Footer onNavigate={vi.fn()} showNotice={false} />);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: ES.legal.links.terms })).toBeInTheDocument();
  });
});

describe('LoginPage consent line', () => {
  it('contains real links to terms and privacy', () => {
    const onNavigate = vi.fn();
    render(<LoginPage onNavigate={onNavigate} />);
    expect(screen.getByRole('link', { name: ES.legal.links.terms })).toHaveAttribute('href', '/terms');
    expect(screen.getByRole('link', { name: ES.legal.links.privacy })).toHaveAttribute('href', '/privacy');
  });
});
