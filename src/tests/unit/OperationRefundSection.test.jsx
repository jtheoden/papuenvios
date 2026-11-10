import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';

const getOperationRefundDetail = vi.hoisted(() => vi.fn());
vi.mock('@/lib/refundService', () => ({ getOperationRefundDetail }));
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ language: 'en', t: (key, params) => (params ? `${key}|${Object.values(params).join('|')}` : key) })
}));

import OperationRefundSection from '@/components/refunds/OperationRefundSection';

const refund = (over = {}) => ({
  id: 'r1', status: 'pending', amount: 25, currency: 'USD', queue_state: 'on_hold',
  cancelled_at: '2026-10-20T10:00:00Z', eligible_at: '2026-10-22T10:00:00Z', due_at: '2026-10-29T10:00:00Z',
  resolved_at: null, refunded_at: null, self_resolved: false, proof_state: 'none', proof_expires_at: null, ...over
});

describe('OperationRefundSection (admin, read-only)', () => {
  beforeEach(() => {
    getOperationRefundDetail.mockReset();
  });

  it('renders nothing when the backend is not available', async () => {
    getOperationRefundDetail.mockResolvedValue(null);
    const { container } = render(<OperationRefundSection kind="order" operationId="o1" />);
    await waitFor(() => expect(getOperationRefundDetail).toHaveBeenCalledWith('order', 'o1'));
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('shows the refund state and a timeline list in order, with no file path or personal data', async () => {
    getOperationRefundDetail.mockResolvedValue({
      refunds: [refund({ proof_state: 'available' })],
      timeline: [
        { ts: '2026-10-20T10:00:00Z', source: 'status_history', kind: 'status_changed', summary: { from: 'pending', to: 'cancelled' } },
        { ts: '2026-10-20T10:00:01Z', source: 'refund_event', kind: 'created', summary: { to: 'pending' } },
        { ts: '2026-10-22T10:00:00Z', source: 'refund_marker', kind: 'refund_eligible', summary: { derived: true } }
      ]
    });
    render(<OperationRefundSection kind="remittance" operationId="m1" />);
    const region = await screen.findByRole('region', { name: 'refundAudit.section.title' });
    expect(within(region).getByText('refundAudit.status.pending')).toBeInTheDocument();
    expect(within(region).getByText('refundAudit.queue.on_hold')).toBeInTheDocument();
    expect(within(region).getByText('refundAudit.proof.available')).toBeInTheDocument();
    const items = within(region).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('refundAudit.timeline.statusChanged|refundAudit.opStatus.pending|refundAudit.opStatus.cancelled');
    expect(items[1]).toHaveTextContent('refundAudit.timeline.event.created');
    expect(items[2]).toHaveTextContent('refundAudit.timeline.markerEligible');
    expect(region.textContent).not.toMatch(/refunds\/|user_id|payment_evidence/);
  });

  it('shows the timeline and a "no refunds" note when the operation never had a refund', async () => {
    getOperationRefundDetail.mockResolvedValue({
      refunds: [],
      timeline: [{ ts: '2026-10-20T10:00:00Z', source: 'status_history', kind: 'status_changed', summary: { from: 'a', to: 'b' } }]
    });
    render(<OperationRefundSection kind="order" operationId="o1" />);
    expect(await screen.findByText('refundAudit.section.none')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('humanizes an unknown status code instead of leaking a translation key', async () => {
    getOperationRefundDetail.mockResolvedValue({
      refunds: [],
      timeline: [{ ts: '2026-10-20T10:00:00Z', source: 'status_history', kind: 'status_changed', summary: { from: 'some_new_state', to: 'cancelled' } }]
    });
    render(<OperationRefundSection kind="order" operationId="o1" />);
    expect(await screen.findByText(/some new state/)).toBeInTheDocument();
  });

  it('tells the admin when only part of the information loaded', async () => {
    getOperationRefundDetail.mockResolvedValue({ refunds: [refund()], timeline: [], incomplete: true });
    render(<OperationRefundSection kind="order" operationId="o1" />);
    expect(await screen.findByText('refundAudit.section.partial')).toBeInTheDocument();
  });

  it('formats the amount as currency', async () => {
    getOperationRefundDetail.mockResolvedValue({ refunds: [refund({ amount: 1234.5 })], timeline: [] });
    render(<OperationRefundSection kind="order" operationId="o1" />);
    expect(await screen.findByText('$1,234.50')).toBeInTheDocument();
  });

  it('falls back to a generic label for an unknown event kind', async () => {
    getOperationRefundDetail.mockResolvedValue({
      refunds: [refund()],
      timeline: [{ ts: '2026-10-20T10:00:00Z', source: 'refund_event', kind: 'brand_new_kind', summary: {} }]
    });
    render(<OperationRefundSection kind="order" operationId="o1" />);
    expect(await screen.findByText('refundAudit.timeline.event.unknown')).toBeInTheDocument();
  });

  it('marks a refund resolved by the customer-admin', async () => {
    getOperationRefundDetail.mockResolvedValue({
      refunds: [refund({ status: 'refunded', self_resolved: true, resolved_at: '2026-10-23T10:00:00Z', refunded_at: '2026-10-23T10:00:00Z', queue_state: null })],
      timeline: []
    });
    render(<OperationRefundSection kind="order" operationId="o1" />);
    expect(await screen.findByText('refundAudit.field.selfResolved')).toBeInTheDocument();
  });
});
