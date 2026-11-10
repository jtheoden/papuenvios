import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';

const getRefundMetrics = vi.hoisted(() => vi.fn());
vi.mock('@/lib/refundService', () => ({ getRefundMetrics }));
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ language: 'en', t: (key, params) => (params ? `${key}|${Object.values(params).join('|')}` : key) })
}));

import RefundKpiCards from '@/components/admin/RefundKpiCards';

const metrics = (over = {}) => ({
  total_refunded: 8, total_pending: 3, pct_on_time: 87.5, pct_with_proof: 100,
  time_to_refund_from_cancel_hours: { p50: 60.25, p90: 90, avg: 70 }, ...over
});

describe('RefundKpiCards (dashboard)', () => {
  beforeEach(() => {
    getRefundMetrics.mockReset();
  });

  it('does nothing while disabled', () => {
    const { container } = render(<RefundKpiCards enabled={false} />);
    expect(getRefundMetrics).not.toHaveBeenCalled();
    expect(container.firstChild).toBeNull();
  });

  it('asks for the last 30 days and shows the KPIs', async () => {
    getRefundMetrics.mockResolvedValue(metrics());
    render(<RefundKpiCards enabled now={new Date('2026-11-01T00:00:00Z')} />);
    const group = await screen.findByRole('group', { name: 'refundAudit.kpi.region' });
    const arg = getRefundMetrics.mock.calls[0][0];
    expect(new Date(arg.to).toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(new Date(arg.from).toISOString()).toBe('2026-10-02T00:00:00.000Z');
    expect(group).toHaveTextContent('8');
    expect(group).toHaveTextContent('3');
    expect(group).toHaveTextContent('refundAudit.kpi.percent|87.5');
    expect(group).toHaveTextContent('refundAudit.kpi.hours|60.3');
  });

  it('shows "no data" for percentages that are null (nothing refunded yet)', async () => {
    getRefundMetrics.mockResolvedValue(metrics({ total_refunded: 0, pct_on_time: null, pct_with_proof: null, time_to_refund_from_cancel_hours: { p50: null } }));
    render(<RefundKpiCards enabled />);
    await screen.findByRole('group');
    expect(screen.getAllByText('refundAudit.kpi.noData').length).toBeGreaterThanOrEqual(2);
  });

  it.each([[null], [undefined]])('renders nothing when metrics are unavailable (%s)', async (value) => {
    getRefundMetrics.mockResolvedValue(value);
    const { container } = render(<RefundKpiCards enabled />);
    await waitFor(() => expect(getRefundMetrics).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the call rejects', async () => {
    getRefundMetrics.mockRejectedValue(new Error('x'));
    const { container } = render(<RefundKpiCards enabled />);
    await waitFor(() => expect(getRefundMetrics).toHaveBeenCalled());
    await act(async () => {});
    expect(container.firstChild).toBeNull();
  });
});
