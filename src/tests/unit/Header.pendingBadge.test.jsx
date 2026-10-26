import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';

const state = { orders: 2, remittances: 1, refunds: { actionable: 0, overdue: 0 }, refundsFail: false, role: 'admin', handlers: {} };

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
    userCategory: 'regular'
  })
}));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/components/ui/user-avatar', () => ({ UserAvatar: () => <span data-testid="avatar" /> }));

import Header from '@/components/Header';

describe('Header pending badge', () => {
  beforeEach(() => {
    state.orders = 2;
    state.remittances = 1;
    state.refunds = { actionable: 0, overdue: 0 };
    state.refundsFail = false;
    state.role = 'admin';
    state.handlers = {};
  });

  it('shows pending orders plus pending remittances on the avatar badge', async () => {
    render(<Header currentPage="home" onNavigate={() => {}} />);
    expect(await screen.findByText('3')).toBeTruthy();
  });

  it('updates the badge in real time when a new remittance is registered', async () => {
    render(<Header currentPage="home" onNavigate={() => {}} />);
    await screen.findByText('3');

    state.remittances = 2;
    await act(async () => {
      state.handlers.remittances({ eventType: 'INSERT' });
    });

    await waitFor(() => expect(screen.getByText('4')).toBeTruthy());
  });

  it('updates the badge in real time when an order changes', async () => {
    render(<Header currentPage="home" onNavigate={() => {}} />);
    await screen.findByText('3');

    state.orders = 5;
    await act(async () => {
      state.handlers.orders({ eventType: 'INSERT' });
    });

    await waitFor(() => expect(screen.getByText('6')).toBeTruthy());
  });

  it('does not show a badge to non-admin users', async () => {
    state.role = 'user';
    render(<Header currentPage="home" onNavigate={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('avatar')).toBeTruthy());
    expect(screen.queryByText('3')).toBeNull();
  });

  it('exposes an accessible count: sr-only text and an aria-hidden visible number', async () => {
    render(<Header currentPage="home" onNavigate={() => {}} />);
    const visible = await screen.findByText('3');
    expect(visible.getAttribute('aria-hidden')).toBe('true');
    expect(visible.className).toContain('bg-red-600');
    expect(screen.getByText('adminInbox.badgeAria:3').className).toContain('sr-only');
  });

  it('caps the visible badge at 99+ while the sr-only text keeps the real count', async () => {
    state.orders = 100;
    state.remittances = 20;
    render(<Header currentPage="home" onNavigate={() => {}} />);
    const visible = await screen.findByText('99+');
    expect(visible.className).toContain('min-w-[1.25rem]');
    expect(visible.className).toContain('px-1');
    expect(visible.className).toContain('text-[11px]');
    expect(screen.getByText('adminInbox.badgeAria:120')).toBeTruthy();
  });

  describe('refunds', () => {
    it('adds the actionable refunds to the badge (orders 2 + remittances 1 + refunds 2)', async () => {
      state.refunds = { actionable: 2, overdue: 0 };
      render(<Header currentPage="home" onNavigate={() => {}} />);
      expect(await screen.findByText('5')).toBeTruthy();
      expect(screen.queryByText('!')).toBeNull();
    });

    it('shows a ! marker and extra sr-only text when a refund is overdue', async () => {
      state.refunds = { actionable: 2, overdue: 1 };
      render(<Header currentPage="home" onNavigate={() => {}} />);
      await screen.findByText('5');
      const marker = screen.getByText('!');
      expect(marker.getAttribute('aria-hidden')).toBe('true');
      expect(screen.getByText('adminRefunds.badge.overdueSr:1').className).toContain('sr-only');
    });

    it('a failing refunds source counts 0 without hiding orders and remittances', async () => {
      state.refundsFail = true;
      render(<Header currentPage="home" onNavigate={() => {}} />);
      expect(await screen.findByText('3')).toBeTruthy();
      expect(screen.queryByText('!')).toBeNull();
    });

    it('shows the badge when only refunds are pending', async () => {
      state.orders = 0;
      state.remittances = 0;
      state.refunds = { actionable: 1, overdue: 0 };
      render(<Header currentPage="home" onNavigate={() => {}} />);
      expect(await screen.findByText('1')).toBeTruthy();
    });

    it('re-reads the badge when the refunds screen announces a change (resolved a refund)', async () => {
      state.refunds = { actionable: 2, overdue: 0 };
      render(<Header currentPage="home" onNavigate={() => {}} />);
      await screen.findByText('5');
      state.refunds = { actionable: 1, overdue: 0 };
      await act(async () => {
        window.dispatchEvent(new Event('papuenvios:refunds-changed'));
      });
      await waitFor(() => expect(screen.getByText('4')).toBeTruthy());
    });

    it('re-reads the refunds on a realtime order event (an overdue state can appear)', async () => {
      render(<Header currentPage="home" onNavigate={() => {}} />);
      await screen.findByText('3');
      state.refunds = { actionable: 1, overdue: 1 };
      await act(async () => {
        state.handlers.orders({ eventType: 'UPDATE' });
      });
      await waitFor(() => expect(screen.getByText('4')).toBeTruthy());
      expect(screen.getByText('!')).toBeTruthy();
    });
  });
});
