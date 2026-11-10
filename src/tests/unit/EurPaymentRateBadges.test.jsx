import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import EurPaymentRateBadges from '@/components/settings/EurPaymentRateBadges';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ language: 'es' })
}));

vi.mock('@/components/settings/PaymentRateBadge', () => ({
  default: ({ sourceCurrency, targetCurrency }) => (
    <span data-testid={`rate-${targetCurrency}`}>{sourceCurrency} to {targetCurrency}</span>
  )
}));

describe('EUR payment-method rate badges', () => {
  it('shows the two required source-currency pairs', () => {
    render(<EurPaymentRateBadges />);
    expect(screen.getByTestId('rate-USD')).toHaveTextContent('EUR to USD');
    expect(screen.getByTestId('rate-CUP')).toHaveTextContent('EUR to CUP');
  });

  it('is reused in both the Bizum and IBAN detail views', () => {
    const bizum = readFileSync('src/components/settings/SettingsBizumSection.jsx', 'utf8');
    const iban = readFileSync('src/components/settings/SettingsIbanStatus.jsx', 'utf8');
    expect(bizum).toMatch(/import EurPaymentRateBadges from .*EurPaymentRateBadges/);
    expect(bizum).toMatch(/<EurPaymentRateBadges\s*\/>/);
    expect(iban).toMatch(/import EurPaymentRateBadges from .*EurPaymentRateBadges/);
    expect(iban).toMatch(/<EurPaymentRateBadges\b[^>]*\/>/);
  });
});
