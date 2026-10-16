import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';

const lang = { current: 'es' };
const settings = { current: {} };

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
  useBusiness: () => ({ visualSettings: settings.current }),
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
  settings.current = {};
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

describe('RegulatoryNotice card variant', () => {
  it('keeps the boxed list presentation by default', () => {
    render(<RegulatoryNotice onNavigate={vi.fn()} />);
    const note = screen.getByRole('note', { name: ES.legal.notice.title });
    expect(note.className).toMatch(/bg-blue-50/);
    expect(note.className).toMatch(/border-blue-100/);
    expect(within(note).getAllByRole('listitem')).toHaveLength(4);
    [
      ES.legal.notice.notBank,
      ES.legal.notice.zelleIrreversible,
      ES.legal.notice.deliveryEstimates,
      ES.legal.notice.ofac,
    ].forEach((text) => expect(within(note).getByText(text)).toBeInTheDocument());
    expect(within(note).getByRole('link')).toHaveAttribute('href', '/terms');
  });
});

describe('Footer notice (compact)', () => {
  const renderFooter = () => render(<Footer onNavigate={vi.fn()} />);
  const sentences = () => [
    ES.legal.notice.notBank,
    ES.legal.notice.zelleIrreversible,
    ES.legal.notice.deliveryEstimates,
    ES.legal.notice.ofac,
  ];

  it('renders an unboxed note without list markup or blue box classes', () => {
    renderFooter();
    const note = screen.getByRole('note', { name: ES.legal.notice.title });
    expect(note.querySelector('ul')).toBeNull();
    expect(within(note).queryAllByRole('listitem')).toHaveLength(0);
    [note, ...note.querySelectorAll('*')].forEach((el) => {
      expect(el.getAttribute('class') || '').not.toMatch(/bg-blue-|border-blue-|rounded/);
    });
  });

  it('keeps each sentence as its own span inside a single paragraph', () => {
    renderFooter();
    const note = screen.getByRole('note', { name: ES.legal.notice.title });
    expect(note.querySelectorAll('p')).toHaveLength(1);
    sentences().forEach((text) => {
      const el = within(note).getByText(text);
      expect(el.tagName).toBe('SPAN');
    });
  });

  it('links to the terms with a persistent underline and navigates in-app', () => {
    const onNavigate = vi.fn();
    render(<Footer onNavigate={onNavigate} />);
    const note = screen.getByRole('note', { name: ES.legal.notice.title });
    const link = within(note).getByRole('link', { name: ES.legal.notice.seeTerms });
    expect(link).toHaveAttribute('href', '/terms');
    expect(link.className).toMatch(/\bunderline\b/);
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith('terms');
    expect(note.getAttribute('aria-label')).not.toBe(ES.legal.nav.label);
  });

  it('uses the footer theme colours with fallbacks and does not dim the link', () => {
    settings.current = {
      footerTextColor: '#e5e7eb',
      footerLinkColor: '#93c5fd',
      footerBgColor: '#111827',
    };
    const { unmount } = renderFooter();
    let note = screen.getByRole('note', { name: ES.legal.notice.title });
    expect(note).toHaveStyle({ color: '#e5e7eb' });
    expect(within(note).getByRole('link')).toHaveStyle({ color: '#93c5fd' });
    expect(note.className).not.toMatch(/opacity-/);
    unmount();

    settings.current = {};
    renderFooter();
    note = screen.getByRole('note', { name: ES.legal.notice.title });
    expect(note).toHaveStyle({ color: '#374151' });
    expect(within(note).getByRole('link')).toHaveStyle({ color: '#2563eb' });
  });

  it('keeps the three legal links when the notice is hidden', () => {
    render(<Footer onNavigate={vi.fn()} showNotice={false} />);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: ES.legal.links.terms })).toHaveAttribute('href', '/terms');
    expect(screen.getByRole('link', { name: ES.legal.links.privacy })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: ES.legal.links.refunds })).toHaveAttribute(
      'href',
      '/terms#refunds'
    );
  });

  it.each([
    ['es', ES],
    ['en', EN],
  ])('keeps the %s notice copy within the approved subset', (code, dict) => {
    lang.current = code;
    renderFooter();
    const text = screen.getByRole('note').textContent;
    const lower = text.toLowerCase();
    expect(lower).not.toMatch(/licencia|licensed|licenced|autorizad|registrad/);
    expect(lower).not.toMatch(
      /financial institution|institución financiera|31 cfr|límites aplicables|applicable limits/
    );
    expect(text).toContain('OFAC');
    expect(text).toContain(dict.legal.notice.notBank);
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
