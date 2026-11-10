import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const svc = vi.hoisted(() => ({ getMarginSummary: vi.fn() }));
vi.mock('@/lib/courierService', () => svc);

import CourierMarginCard from '@/components/admin/CourierMarginCard';

const t = (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key);

beforeEach(() => vi.clearAllMocks());

describe('CourierMarginCard', () => {
  it('renders nothing while the module is unavailable (migrations not applied)', async () => {
    svc.getMarginSummary.mockResolvedValue({ available: false, thresholdsSet: false, counts: null });
    const { container } = render(<CourierMarginCard t={t} />);
    await waitFor(() => expect(svc.getMarginSummary).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the owner has not set any threshold (no alerts)', async () => {
    svc.getMarginSummary.mockResolvedValue({ available: true, thresholdsSet: false, counts: null });
    const { container } = render(<CourierMarginCard t={t} />);
    await waitFor(() => expect(svc.getMarginSummary).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it('shows warning and critical counts with text, and unknown margin / unknown amount apart (never as 0 risk)', async () => {
    svc.getMarginSummary.mockResolvedValue({ available: true, thresholdsSet: true, counts: { warning: 2, critical: 1, unknown: 4, unknownAmount: 3 } });
    render(<CourierMarginCard t={t} />);
    const card = await screen.findByTestId('courier-margin-card');
    expect(card.textContent).toContain('dashboard.courierMargin.warning');
    expect(screen.getByTestId('margin-count-warning').textContent).toBe('2');
    expect(screen.getByTestId('margin-count-critical').textContent).toBe('1');
    expect(screen.getByTestId('margin-count-unknown').textContent).toBe('4');
    expect(screen.getByTestId('margin-count-unknownAmount').textContent).toBe('3');
  });

  it('is a labelled region', async () => {
    svc.getMarginSummary.mockResolvedValue({ available: true, thresholdsSet: true, counts: { warning: 0, critical: 0, unknown: 0, unknownAmount: 0 } });
    render(<CourierMarginCard t={t} />);
    expect(await screen.findByRole('region', { name: 'dashboard.courierMargin.title' })).toBeTruthy();
  });
});
