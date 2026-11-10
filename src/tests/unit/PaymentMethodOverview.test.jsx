import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PaymentMethodOverview from '@/components/settings/PaymentMethodOverview';

vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ language: 'en' }) }));

describe('PaymentMethodOverview', () => {
  it('provides a theme-token overview while keeping rates, status and actions optional', () => {
    render(
      <PaymentMethodOverview
        title="Bizum"
        description="Collect EUR payments"
        rates={<span>EUR rates</span>}
        status={<span>Ready</span>}
        actions={<button type="button">Add account</button>}
      />
    );

    const overview = screen.getByTestId('payment-method-overview');
    expect(overview).toHaveClass('border-theme-accent-line', 'bg-white/70');
    expect(screen.getByRole('heading', { name: 'Bizum' })).toBeInTheDocument();
    expect(screen.getByText('EUR rates')).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add account' })).toBeInTheDocument();
  });

  it('does not render empty optional slots', () => {
    render(<PaymentMethodOverview title="Zelle" description="Collect USD" />);
    expect(screen.queryByTestId('payment-method-rates')).not.toBeInTheDocument();
    expect(screen.queryByTestId('payment-method-status')).not.toBeInTheDocument();
    expect(screen.queryByTestId('payment-method-actions')).not.toBeInTheDocument();
  });
});
