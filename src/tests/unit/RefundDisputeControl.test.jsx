import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const setRefundDispute = vi.hoisted(() => vi.fn());
vi.mock('@/lib/refundService', () => ({ setRefundDispute }));
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ language: 'en', t: (key, params) => (params ? `${key}|${Object.values(params).join('|')}` : key) })
}));

import RefundDisputeControl from '@/components/admin/RefundDisputeControl';

const refund = { id: 'r1', operation_number: 'ORD-1', status: 'refunded' };

describe('RefundDisputeControl (single toggle driven by the real state)', () => {
  beforeEach(() => {
    setRefundDispute.mockReset();
  });

  it('offers only "open" when there is no dispute, and confirms with the state the RPC returned', async () => {
    setRefundDispute.mockResolvedValue({ ok: true, open: true });
    render(<RefundDisputeControl refund={refund} open={false} />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'refundAudit.dispute.closeAria|ORD-1' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'refundAudit.dispute.openAria|ORD-1' }));
    await waitFor(() => expect(setRefundDispute).toHaveBeenCalledWith('r1', true));
    expect(await screen.findByText('refundAudit.dispute.opened')).toBeInTheDocument();
    // the same button now closes
    expect(screen.getByRole('button', { name: 'refundAudit.dispute.closeAria|ORD-1' })).toBeInTheDocument();
  });

  it('offers only "close" (and a visible badge) when a dispute is open', async () => {
    setRefundDispute.mockResolvedValue({ ok: true, open: false });
    render(<RefundDisputeControl refund={refund} open />);
    expect(screen.getByText('refundAudit.dispute.badge')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'refundAudit.dispute.closeAria|ORD-1' }));
    await waitFor(() => expect(setRefundDispute).toHaveBeenCalledWith('r1', false));
    expect(await screen.findByText('refundAudit.dispute.closed')).toBeInTheDocument();
    expect(screen.queryByText('refundAudit.dispute.badge')).toBeNull();
  });

  it('is disabled for the admin who is the customer of the refund and never calls the RPC', () => {
    render(<RefundDisputeControl refund={refund} open={false} isOwn />);
    const button = screen.getByRole('button', { name: 'refundAudit.dispute.openAria|ORD-1' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(button);
    expect(setRefundDispute).not.toHaveBeenCalled();
    expect(screen.getByText('refundAudit.dispute.ownBlocked')).toBeInTheDocument();
  });

  it('keeps the state and shows an alert when the RPC fails', async () => {
    setRefundDispute.mockRejectedValue(new Error('x'));
    render(<RefundDisputeControl refund={refund} open={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'refundAudit.dispute.openAria|ORD-1' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('refundAudit.dispute.failed');
    expect(screen.getByRole('button', { name: 'refundAudit.dispute.openAria|ORD-1' })).toBeInTheDocument();
  });
});
