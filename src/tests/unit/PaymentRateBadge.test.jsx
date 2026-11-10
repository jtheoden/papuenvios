import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PaymentRateBadge from '@/components/settings/PaymentRateBadge';
import { getActiveRate } from '@/lib/currencyService';

vi.mock('@/lib/currencyService', () => ({ getActiveRate: vi.fn() }));

describe('PaymentRateBadge', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the active source-to-payout quote and active theme tokens', async () => {
    getActiveRate.mockResolvedValue({ rate: 400, effective_date: '2026-11-08' });
    render(<PaymentRateBadge sourceCurrency="USD" targetCurrency="CUP" language="en" />);

    const badge = await screen.findByRole('status');
    expect(badge).toHaveAttribute('data-rate-status', 'active');
    expect(badge).toHaveTextContent('1 USD = 400 CUP');
    expect(badge.getAttribute('style')).toContain('var(--t-accent)');
  });

  it('clearly marks a missing pair rather than implying a fallback rate', async () => {
    getActiveRate.mockResolvedValue(null);
    render(<PaymentRateBadge sourceCurrency="EUR" targetCurrency="CUP" language="es" />);

    const badge = await screen.findByRole('status');
    expect(badge).toHaveAttribute('data-rate-status', 'missing');
    expect(badge).toHaveTextContent('Sin tasa activa EUR/CUP');
  });
});
