import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const getRefundDisputeStates = vi.hoisted(() => vi.fn());
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ language: 'en', t: (key, params) => (params ? `${key}|${Object.values(params).join('|')}` : key) })
}));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/lib/refundService', () => ({ resolveRefund: vi.fn(), notifyRefundsChanged: vi.fn(), getRefundDisputeStates }));
vi.mock('@/components/ImageProofModal', () => ({ default: () => null }));
vi.mock('@/components/admin/RefundProofsMaintenance', () => ({ default: () => <div data-testid="maintenance" /> }));
vi.mock('@/components/admin/RefundDisputeControl', () => ({
  default: ({ refund, isOwn, open }) => <div data-testid={`dispute-${refund.id}`} data-own={String(isOwn)} data-open={String(open)} />
}));

import AdminRefundsInbox from '@/components/admin/AdminRefundsInbox';

const iso = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();
const row = (over) => ({
  amount: '10.00', currency: 'USD', payment_evidence: 'validated', eligible_at: iso(-10), due_at: iso(100), cancelled_at: iso(-60),
  cancelled_by_role: 'admin', operation_type: 'order', order_id: 'o', operation_number: 'ORD-1', user_id: 'someone', ...over
});
const refunds = [
  row({ id: 'p', status: 'pending' }),
  row({ id: 'r1', status: 'refunded', refunded_at: iso(-3), resolved_at: iso(-3), refund_reference: 'Z' }),
  row({ id: 'r2', status: 'refunded', user_id: 'me', refunded_at: iso(-3), resolved_at: iso(-3), refund_reference: 'Z' })
];
const showAll = () => fireEvent.click(screen.getByRole('button', { name: /adminRefunds\.filter\.all/ }));

describe('AdminRefundsInbox: retention wiring', () => {
  beforeEach(() => {
    getRefundDisputeStates.mockReset();
  });

  it('shows the maintenance panel and passes the REAL dispute state to the control of refunded rows only', async () => {
    getRefundDisputeStates.mockResolvedValue(['r1']);
    render(<AdminRefundsInbox currentUserId="me" refunds={refunds} />);
    expect(screen.getByTestId('maintenance')).toBeInTheDocument();
    showAll();
    const r1 = await screen.findByTestId('dispute-r1');
    expect(getRefundDisputeStates).toHaveBeenCalledWith(['r1', 'r2']);
    expect(r1).toHaveAttribute('data-open', 'true');
    expect(screen.getByTestId('dispute-r2')).toHaveAttribute('data-open', 'false');
    expect(screen.getByTestId('dispute-r2')).toHaveAttribute('data-own', 'true');
    expect(screen.queryByTestId('dispute-p')).toBeNull();
  });

  it.each([[null], ['reject']])('hides the dispute control when the state is unknown (%s)', async (mode) => {
    if (mode === 'reject') getRefundDisputeStates.mockRejectedValue(new Error('x'));
    else getRefundDisputeStates.mockResolvedValue(null);
    render(<AdminRefundsInbox currentUserId="me" refunds={refunds} />);
    showAll();
    await waitFor(() => expect(getRefundDisputeStates).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId(/dispute-/)).toBeNull());
  });
});
