import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SettingsIbanStatus from '@/components/settings/SettingsIbanStatus';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'en',
    t: (key) => ({
      'settings.payments.ibanStatus.title': 'IBAN transfer (SEPA)',
      'settings.payments.ibanStatus.description': 'EUR collection readiness.',
      'settings.payments.ibanStatus.unavailable': 'Unavailable',
      'settings.payments.ibanStatus.blocker': 'Not approved or implemented.',
      'settings.payments.ibanAccounts.title': 'IBAN receiving accounts and limits',
      'settings.payments.ibanAccounts.description': 'PapuEnvios collection accounts only.',
      'settings.payments.ibanAccounts.limits': 'Minimum and maximum per transfer.',
      'settings.payments.ibanAccounts.routing': 'Separate order/remittance routing.',
      'settings.payments.ibanAccounts.unavailable': 'Secure setup not implemented. Do not enter bank details.'
    })[key] || key
  })
}));

vi.mock('@/components/settings/PaymentRateBadge', () => ({
  default: ({ sourceCurrency, targetCurrency }) => <span>{sourceCurrency} to {targetCurrency}</span>
}));

describe('SettingsIbanStatus', () => {
  it('shows the unavailable status, blocker, and EUR/USD reference without an enable control', () => {
    render(<SettingsIbanStatus method={{ code: 'iban', available: false }} />);
    expect(screen.getByTestId('iban-rollout-status')).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.getByText('Not approved or implemented.')).toBeInTheDocument();
    expect(screen.getByText('EUR to USD')).toBeInTheDocument();
    expect(screen.getByText('EUR to CUP')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'IBAN receiving accounts and limits' })).toBeInTheDocument();
    expect(screen.getByText('Minimum and maximum per transfer.')).toBeInTheDocument();
    expect(screen.getByText('Secure setup not implemented. Do not enter bank details.')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('still displays the IBAN option before the method catalog migration is deployed', () => {
    render(<SettingsIbanStatus />);
    expect(screen.getByTestId('iban-rollout-status')).toBeInTheDocument();
    expect(screen.getByText('EUR to USD')).toBeInTheDocument();
    expect(screen.getByText('EUR to CUP')).toBeInTheDocument();
  });

  it('keeps the status visible after catalog availability until payment processing exists', () => {
    const { container } = render(<SettingsIbanStatus method={{ code: 'iban', available: true }} />);
    expect(container).not.toBeEmptyDOMElement();
    expect(screen.getByTestId('iban-rollout-status')).toBeInTheDocument();
  });
});
