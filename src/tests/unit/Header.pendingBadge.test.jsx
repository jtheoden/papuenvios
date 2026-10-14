import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';

const state = { orders: 2, remittances: 1, role: 'admin', handlers: {} };

vi.mock('@/lib/orderService', () => ({
  getPendingOrdersCount: vi.fn(async () => state.orders)
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
  useLanguage: () => ({ language: 'es', setLanguage: vi.fn(), t: (k) => k })
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
});
