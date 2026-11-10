import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const getRefundCounts = vi.hoisted(() => vi.fn());

vi.mock('@/lib/refundService', () => ({ getRefundCounts }));
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ language: 'en', t: (key, params) => (params ? `${key}|${Object.values(params).join('|')}` : key) })
}));

import RefundsAlertCard from '@/components/admin/RefundsAlertCard';

const counts = (over = {}) => ({ actionable: 0, onHold: 0, dueSoon: 0, overdue: 0, pendingAmountUsd: 0, ...over });

describe('RefundsAlertCard (dashboard summary)', () => {
  beforeEach(() => {
    getRefundCounts.mockReset();
    window.history.replaceState({}, '', '/dashboard');
  });

  it('renders nothing when no refund is pending', async () => {
    getRefundCounts.mockResolvedValue(counts());
    const { container } = render(<RefundsAlertCard enabled onNavigate={() => {}} />);
    await waitFor(() => expect(getRefundCounts).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing (no noise) when the counts cannot be read', async () => {
    getRefundCounts.mockRejectedValue(new Error('x'));
    const { container } = render(<RefundsAlertCard enabled onNavigate={() => {}} />);
    await waitFor(() => expect(getRefundCounts).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it('does not ask the backend when disabled', () => {
    render(<RefundsAlertCard enabled={false} onNavigate={() => {}} />);
    expect(getRefundCounts).not.toHaveBeenCalled();
  });

  it('is amber and a polite status when everything is within the deadline; the amount is labelled USD only', async () => {
    getRefundCounts.mockResolvedValue(counts({ actionable: 3, pendingAmountUsd: 410, onHold: 1 }));
    render(<RefundsAlertCard enabled onNavigate={() => {}} />);
    const card = await screen.findByTestId('refunds-alert-card');
    expect(card.getAttribute('role')).toBe('status');
    expect(card.className).toContain('bg-amber-50');
    expect(screen.getByText('adminRefunds.dashboard.title|3')).toBeTruthy();
    expect(screen.getByText(/adminRefunds\.dashboard\.amount\|\$410\.00/)).toBeTruthy();
    expect(screen.getByText('adminRefunds.dashboard.onHold|1|48')).toBeTruthy();
    expect(screen.queryByText(/adminRefunds\.dashboard\.overdue/)).toBeNull();
  });

  it('is red and an alert when something is overdue', async () => {
    getRefundCounts.mockResolvedValue(counts({ actionable: 3, overdue: 1, pendingAmountUsd: 410 }));
    render(<RefundsAlertCard enabled onNavigate={() => {}} />);
    const card = await screen.findByTestId('refunds-alert-card');
    expect(card.getAttribute('role')).toBe('alert');
    expect(card.className).toContain('bg-red-50');
    expect(screen.getByText('adminRefunds.dashboard.overdue|1')).toBeTruthy();
  });

  it('with only on-hold refunds it still shows (attenuated title), as a status', async () => {
    getRefundCounts.mockResolvedValue(counts({ onHold: 2 }));
    render(<RefundsAlertCard enabled onNavigate={() => {}} />);
    const card = await screen.findByTestId('refunds-alert-card');
    expect(card.getAttribute('role')).toBe('status');
    expect(screen.getByText('adminRefunds.dashboard.titleOnHold|2|48')).toBeTruthy();
  });

  it('the button (44 px) goes to the Refunds tab of the user panel', async () => {
    getRefundCounts.mockResolvedValue(counts({ actionable: 1 }));
    const onNavigate = vi.fn();
    render(<RefundsAlertCard enabled onNavigate={onNavigate} />);
    const button = await screen.findByRole('button', { name: 'adminRefunds.dashboard.cta' });
    expect(button.className).toContain('min-h-[44px]');
    fireEvent.click(button);
    expect(onNavigate).toHaveBeenCalledWith('user-panel');
    expect(window.location.pathname + window.location.search).toBe('/user-panel?tab=refunds');
  });
});
