import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';

const state = { orders: 2, remittances: 1, refunds: { actionable: 0, overdue: 0 }, refundsFail: false, unresolved: false, role: 'admin', handlers: {} };

vi.mock('@/lib/orderService', () => ({
  getPendingOrdersCount: vi.fn(async () => state.orders)
}));
vi.mock('@/lib/refundService', () => ({
  REFUNDS_CHANGED_EVENT: 'papuenvios:refunds-changed',
  getRefundCounts: vi.fn(async () => {
    if (state.refundsFail) throw new Error('refund counts unavailable');
    return { actionable: state.refunds.actionable, onHold: 0, dueSoon: 0, overdue: state.refunds.overdue, pendingAmountUsd: 0 };
  })
}));
vi.mock('@/lib/remittanceService', () => ({
  getPendingRemittancesCount: vi.fn(async () => state.remittances)
}));
vi.mock('@/hooks/useRealtimeSubscription', () => ({
  useRealtimeOrders: vi.fn(({ onUpdate }) => {
    state.handlers.orders = onUpdate;
    return { isSubscribed: true };
  }),
  useRealtimeRemittances: vi.fn(({ onUpdate }) => {
    state.handlers.remittances = onUpdate;
    return { isSubscribed: true };
  })
}));
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ language: 'es', setLanguage: vi.fn(), t: (k, params) => (params ? `${k}:${params.count}` : k) })
}));
vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({ cart: [], visualSettings: {} })
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'a@b.c' },
    isAdmin: true,
    userRole: state.role,
    userCategory: 'regular',
    roleStatus: state.unresolved ? 'unresolved' : 'resolved',
    roleFetchFailed: Boolean(state.unresolved),
    retryRoleResolution: vi.fn()
  })
}));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/components/ui/user-avatar', () => ({ UserAvatar: () => <span data-testid="avatar" /> }));

vi.mock('@/components/help/HelpCenter', () => ({
  default: ({ currentPage }) => <div data-testid="help-center" data-current-page={String(currentPage)} />
}));

import Header from '@/components/Header';

describe('Header help launcher', () => {
  it('tells the help assistant which page is active so it opens the matching guide', async () => {
    render(<Header currentPage="dashboard" onNavigate={() => {}} />);
    const help = await screen.findByTestId('help-center');
    expect(help).toHaveAttribute('data-current-page', 'dashboard');
  });
});
