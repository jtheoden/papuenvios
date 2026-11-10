import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';

const getMyOperationRefund = vi.hoisted(() => vi.fn());
vi.mock('@/lib/refundService', () => ({ getMyOperationRefund }));
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ language: 'en', t: (key, params) => (params ? `${key}|${Object.values(params).join('|')}` : key) })
}));

import MyOperationRefund from '@/components/refunds/MyOperationRefund';

const row = (over = {}) => ({
  status: 'pending', stage: 'on_hold', amount: 25, currency: 'USD', cancelled_at: '2026-10-20T10:00:00Z',
  eligible_at: '2026-10-22T10:00:00Z', due_at: '2026-10-29T10:00:00Z', refunded_at: null, ...over
});

describe('MyOperationRefund (customer)', () => {
  beforeEach(() => {
    getMyOperationRefund.mockReset();
  });

  it('renders nothing when there is no refund or the RPC does not exist yet', async () => {
    getMyOperationRefund.mockResolvedValue([]);
    const { container } = render(<MyOperationRefund kind="order" operationId="o1" />);
    await waitFor(() => expect(getMyOperationRefund).toHaveBeenCalledWith('order', 'o1'));
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing (no error) when the call rejects', async () => {
    getMyOperationRefund.mockRejectedValue(new Error('x'));
    const { container } = render(<MyOperationRefund kind="order" operationId="o1" />);
    await waitFor(() => expect(getMyOperationRefund).toHaveBeenCalled());
    await act(async () => {});
    expect(container.firstChild).toBeNull();
  });

  it.each([
    ['on_hold', 'myRefund.stage.on_hold'],
    ['processing', 'myRefund.stage.processing'],
    ['refunded', 'myRefund.stage.refunded'],
    ['not_applicable', 'myRefund.stage.not_applicable']
  ])('shows the %s stage in a labelled region', async (stage, key) => {
    getMyOperationRefund.mockResolvedValue([row({ stage, status: stage === 'on_hold' || stage === 'processing' ? 'pending' : stage, refunded_at: stage === 'refunded' ? '2026-10-24T10:00:00Z' : null })]);
    render(<MyOperationRefund kind="remittance" operationId="m1" />);
    const region = await screen.findByRole('region', { name: 'myRefund.region' });
    expect(region).toHaveTextContent(key);
  });

  it('never shows internal data', async () => {
    getMyOperationRefund.mockResolvedValue([row()]);
    const { container } = render(<MyOperationRefund kind="order" operationId="o1" />);
    await screen.findByRole('region');
    expect(container.textContent).not.toMatch(/proof|reference|admin|note/i);
  });
});
