import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key, params) => (params ? `${key}|${Object.entries(params).map(([k, v]) => `${k}=${v}`).join('|')}` : key),
    language: 'es',
  }),
}));

import CommissionChangeNotice from '@/components/CommissionChangeNotice';
import CommissionProposalBadge from '@/components/admin/CommissionProposalBadge';

const KEY = 'remittances.commissionChange';
const remittance = {
  id: 'r1', remittance_number: 'REM-1', amount_sent: 100, exchange_rate: 800,
  currency_sent: 'USD', currency_delivered: 'CUP', status: 'payment_pending',
};
const pending = { id: 'p1', status: 'pending', direction: 'increase', baseline_commission: '2.50', new_commission: '6.00' };
const informed = { id: 'p2', status: 'informed', direction: 'decrease', baseline_commission: '2.50', new_commission: '1.00' };

const setup = (props = {}) => {
  const handlers = { onAccept: vi.fn(), onDecline: vi.fn(), onDismiss: vi.fn() };
  render(<CommissionChangeNotice remittance={remittance} proposal={pending} {...handlers} {...props} />);
  return handlers;
};

describe('CommissionChangeNotice - pending raise', () => {
  it('is a polite status region (aria-live, per card) naming the remittance, with before -> now for the fee and for what the recipient gets', () => {
    setup();
    const region = screen.getByRole('status');
    expect(region).toHaveAccessibleName(`${KEY}.title|number=REM-1`);
    const text = region.textContent;
    expect(text).toContain('2.50');
    expect(text).toContain('6.00');
    expect(text).toContain('78000.00');
    expect(text).toContain('75200.00');
    expect(within(region).getAllByText(`${KEY}.before`, { exact: false }).length).toBeGreaterThan(0);
    expect(within(region).getAllByText(`${KEY}.after`, { exact: false }).length).toBeGreaterThan(0);
    expect(within(region).getByText(`${KEY}.unchanged`)).toBeInTheDocument(); // you pay: no change
  });

  it('uses a description list (not color alone) for the comparison', () => {
    setup();
    expect(document.querySelector('dl')).not.toBeNull();
    expect(screen.getByRole('status').querySelectorAll('dt').length).toBeGreaterThanOrEqual(3);
  });

  it('offers Accept and Cancel remittance as >= 44px buttons wired to the handlers', () => {
    const h = setup();
    const accept = screen.getByRole('button', { name: `${KEY}.accept` });
    const decline = screen.getByRole('button', { name: `${KEY}.decline` });
    for (const b of [accept, decline]) expect(b.className).toMatch(/min-h-\[44px\]/);
    fireEvent.click(accept);
    expect(h.onAccept).toHaveBeenCalledTimes(1);
    fireEvent.click(decline);
    expect(h.onDecline).toHaveBeenCalledTimes(1);
  });

  it('stacks the buttons on narrow screens (320px) and puts them in a row from sm', () => {
    setup();
    const group = screen.getByRole('button', { name: `${KEY}.accept` }).parentElement;
    expect(group.className).toMatch(/flex-col/);
    expect(group.className).toMatch(/sm:flex-row/);
  });

  it('while busy: buttons are disabled and the region is aria-busy', () => {
    setup({ busy: true });
    expect(screen.getByRole('button', { name: `${KEY}.accepting` })).toBeDisabled();
    expect(screen.getByRole('button', { name: `${KEY}.decline` })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });

  it('shows an error message linked to the region and never any admin reason', () => {
    setup({ error: `${KEY}.errors.notOpen` });
    const region = screen.getByRole('status');
    expect(region).toHaveTextContent(`${KEY}.errors.notOpen`);
    expect(region.textContent).not.toMatch(/reason|motivo/i);
  });
});

describe('CommissionChangeNotice - informed decrease', () => {
  it('is a polite status with the new amount and a dismiss button, no accept/cancel', () => {
    const h = setup({ proposal: informed });
    const region = screen.getByRole('status');
    expect(region).toHaveTextContent('75200'.replace('75200', '79200.00'));
    expect(screen.queryByRole('button', { name: `${KEY}.accept` })).toBeNull();
    expect(screen.queryByRole('button', { name: `${KEY}.decline` })).toBeNull();
    const dismiss = screen.getByRole('button', { name: `${KEY}.dismiss` });
    expect(dismiss.className).toMatch(/min-h-\[44px\]/);
    fireEvent.click(dismiss);
    expect(h.onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('CommissionProposalBadge (admin)', () => {
  it('shows text, not only color, for a pending proposal', () => {
    render(<CommissionProposalBadge proposal={pending} />);
    expect(screen.getByText('remittances.admin.commissionProposal.pending')).toBeInTheDocument();
  });
  it('shows the informed state and renders nothing without a proposal', () => {
    const { container, rerender } = render(<CommissionProposalBadge proposal={informed} />);
    expect(screen.getByText('remittances.admin.commissionProposal.informed')).toBeInTheDocument();
    rerender(<CommissionProposalBadge proposal={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
