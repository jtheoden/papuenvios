import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';
import { contrastRatio } from '@/lib/contrast';

const lang = { current: 'es' };

const translate = (key) => {
  const dict = lang.current === 'es' ? ES : EN;
  const value = key.split('.').reduce((acc, k) => (acc ? acc[k] : undefined), dict);
  return typeof value === 'string' ? value : key;
};

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: translate, language: lang.current }),
}));

import RegulatoryNotice from '@/components/RegulatoryNotice';

const NOTICE_KEYS = ['notBank', 'zelleIrreversible', 'deliveryEstimates', 'ofac'];

beforeEach(() => {
  lang.current = 'es';
});

describe('RegulatoryNotice strip variant', () => {
  const renderStrip = (onNavigate = vi.fn()) =>
    render(<RegulatoryNotice variant="strip" onNavigate={onNavigate} />);

  it('is a full-width note labelled with the notice title', () => {
    renderStrip();
    const note = screen.getByRole('note', { name: ES.legal.notice.title });
    expect(note.className).toMatch(/\bw-full\b/);
    expect(note.className).toMatch(/bg-slate-50/);
  });

  it('renders one paragraph with one span per sentence and no list or icon', () => {
    renderStrip();
    const note = screen.getByRole('note');
    expect(note.querySelectorAll('p')).toHaveLength(1);
    expect(note.querySelectorAll('ul, li, svg')).toHaveLength(0);
    NOTICE_KEYS.forEach((key) => {
      const el = within(note).getByText(ES.legal.notice[key]);
      expect(el.tagName).toBe('SPAN');
    });
  });

  it('uses readable text size and no dimmed or alert styling', () => {
    renderStrip();
    const note = screen.getByRole('note');
    const p = note.querySelector('p');
    expect(p.className).toMatch(/text-sm/);
    [note, ...note.querySelectorAll('*')].forEach((el) => {
      const cls = el.getAttribute('class') || '';
      expect(cls).not.toMatch(/opacity-|text-red|bg-red|amber|uppercase|font-bold|font-semibold/);
      expect(el.getAttribute('style') || '').toBe('');
    });
  });

  it('links to the terms with a persistent underline and navigates in-app', () => {
    const onNavigate = vi.fn();
    renderStrip(onNavigate);
    const link = within(screen.getByRole('note')).getByRole('link', {
      name: ES.legal.notice.seeTerms,
    });
    expect(link).toHaveAttribute('href', '/terms');
    expect(link.className).toMatch(/\bunderline\b/);
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith('terms');
  });

  it.each([
    ['es', ES],
    ['en', EN],
  ])('keeps the %s copy within the approved subset', (code, dict) => {
    lang.current = code;
    renderStrip();
    const text = screen.getByRole('note').textContent;
    NOTICE_KEYS.forEach((key) => expect(text).toContain(dict.legal.notice[key]));
    expect(text).toContain('OFAC');
    expect(text.toLowerCase()).not.toMatch(
      /licencia|licensed|licenced|autorizad|registrad|institución financiera|financial institution|31 cfr|límites aplicables|applicable limits/
    );
  });
});

describe('RegulatoryNotice strip contrast (WCAG 1.4.3)', () => {
  const SLATE_50 = '#f8fafc';
  it.each([
    ['text slate-700', '#334155'],
    ['link blue-700', '#1d4ed8'],
    ['link hover blue-800', '#1e40af'],
  ])('%s on slate-50 is at least 4.5:1', (_label, fg) => {
    expect(contrastRatio(fg, SLATE_50)).toBeGreaterThanOrEqual(4.5);
  });

  it('uses exactly those colour classes', () => {
    render(<RegulatoryNotice variant="strip" onNavigate={vi.fn()} />);
    const note = screen.getByRole('note');
    expect(note.querySelector('p').className).toMatch(/text-slate-700/);
    const link = within(note).getByRole('link');
    expect(link.className).toMatch(/text-blue-700/);
    expect(link.className).toMatch(/hover:text-blue-800/);
  });
});
