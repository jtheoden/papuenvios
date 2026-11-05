import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';

const lang = vi.hoisted(() => ({ current: 'es' }));

const translate = (key, params = {}) => {
  const dict = lang.current === 'es' ? ES : EN;
  const value = key.split('.').reduce((acc, k) => (acc ? acc[k] : undefined), dict);
  if (typeof value !== 'string') return key;
  return Object.entries(params).reduce((acc, [k, v]) => acc.replace(`{${k}}`, v), value);
};

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: translate, language: lang.current }),
}));

import BeforePayingNotice, { formatEasternTime } from '@/components/BeforePayingNotice';

// 2026-11-05 15:04 UTC = 10:04 Eastern (EST, UTC-5)
const CHECKED_AT = new Date('2026-11-05T15:04:00Z');

describe('BeforePayingNotice', () => {
  beforeEach(() => {
    lang.current = 'es';
  });

  it('formats the rate time in US Eastern time regardless of the machine zone', () => {
    expect(formatEasternTime(CHECKED_AT, 'en')).toBe('10:04 AM');
    expect(formatEasternTime(CHECKED_AT, 'es')).toMatch(/^10:04/);
  });

  it('shows the irreversibility warning, the full breakdown, the estimate and the legal links', () => {
    render(
      <BeforePayingNotice
        onNavigate={vi.fn()}
        rate="1 USD = 100 CUP"
        rateCheckedAt={CHECKED_AT}
        fee="1.00 USD"
        deliveryCost="0.00 USD"
        total="50.00 USD"
        recipientReceives="4900.00 CUP"
      />
    );
    const region = screen.getByRole('region', { name: ES.beforePaying.title });
    const text = region.textContent;
    expect(text).toContain('Los pagos por Zelle no se pueden revertir. Revise los datos del destinatario y el total antes de enviar.');
    expect(text).toContain('1 USD = 100 CUP');
    expect(text).toMatch(/10:04/);
    expect(text).toContain(ES.beforePaying.easternTime);
    for (const value of ['1.00 USD', '0.00 USD', '50.00 USD', '4900.00 CUP']) expect(text).toContain(value);
    expect(text).toContain(ES.beforePaying.estimate);
    expect(text).not.toMatch(/\d+\s*-\s*\d+\s*(horas|hours|días|days)/);
    expect(within(region).getByRole('link', { name: ES.legal.links.terms })).toHaveAttribute('href', '/terms');
    expect(within(region).getByRole('link', { name: ES.legal.links.refunds }).getAttribute('href')).toBe('/terms#refunds');
  });

  it('omits the rows it was not given (orders: no rate, fee or recipient amount)', () => {
    render(<BeforePayingNotice onNavigate={vi.fn()} deliveryCost="6.00 USD" total="8.90 USD" />);
    const region = screen.getByRole('region', { name: ES.beforePaying.title });
    expect(region.textContent).not.toContain(ES.beforePaying.rate);
    expect(region.textContent).not.toContain(ES.beforePaying.fee);
    expect(region.textContent).not.toContain(ES.beforePaying.recipientReceives);
    expect(region.textContent).toContain('6.00 USD');
    expect(region.textContent).toContain('8.90 USD');
  });

  it('has the required English sentence', () => {
    lang.current = 'en';
    render(<BeforePayingNotice onNavigate={vi.fn()} total="8.90 USD" />);
    expect(screen.getByRole('region', { name: EN.beforePaying.title }).textContent).toContain(
      'Zelle payments cannot be reversed. Check the recipient details and total before sending.'
    );
  });
});
