import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock('@/contexts/LanguageContext', async () => {
  const { tEcho } = await import('./helpers/bizumTestUtils.js');
  return { useLanguage: () => ({ t: tEcho, language: 'en' }) };
});

import PaymentFxBadge from '@/components/settings/PaymentFxBadge';

describe('PaymentFxBadge', () => {
  it.each([
    ['ok', /green/],
    ['warn', /amber/],
    ['blocked', /red/],
    ['none', /gray/]
  ])('shows a text label (not only colour) for the %s state', (state, colour) => {
    render(<PaymentFxBadge status={{ state }} />);
    const badge = screen.getByTestId('fx-badge');
    expect(badge).toHaveAttribute('data-state', state);
    expect(badge).toHaveTextContent(`settings.fxRate.badge.${state}`);
    expect(badge.className).toMatch(colour);
  });

  it('renders nothing without a status (loading or failed read: the card owns the error)', () => {
    const { container } = render(<PaymentFxBadge status={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for an unknown state coming from the server', () => {
    const { container } = render(<PaymentFxBadge status={{ state: 'weird' }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
