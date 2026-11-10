import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

const authUser = vi.hoisted(() => ({ id: 'admin-1', email: 'a@test.com' }));
const ctx = vi.hoisted(() => ({ role: 'admin', ordersCount: 3, remittances: [], active: 0, maxActive: 0 }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: authUser, userRole: ctx.role, userCategory: 'regular' })
}));
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'en' })
}));
vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({ visualSettings: {}, notificationSettings: {} })
}));
vi.mock('@/contexts/ModalContext', () => ({
  useModal: () => ({ showModal: vi.fn().mockResolvedValue(false) })
}));
vi.mock('@/hooks/useUserDiscounts', () => ({
  useUserDiscounts: () => ({ categoryDiscountPercent: 0 })
}));
vi.mock('@/hooks/useRealtimeSubscription', async () => {
  const React = await import('react');
  return {
    useRealtimeOrders: vi.fn(),
    useRealtimeRemittances: vi.fn(({ enabled }) => {
      React.useEffect(() => {
        if (!enabled) return undefined;
        ctx.active += 1;
        ctx.maxActive = Math.max(ctx.maxActive, ctx.active);
        return () => {
          ctx.active -= 1;
        };
      }, [enabled]);
    })
  };
});
vi.mock('@/lib/orderService', () => ({
  getUserOrders: vi.fn(async () => []),
  getOrderById: vi.fn(),
  getAllOrders: vi.fn(async () => []),
  getPendingOrdersCount: vi.fn(async () => ctx.ordersCount),
  validatePayment: vi.fn(),
  rejectPayment: vi.fn(),
  cancelOrderByUser: vi.fn(),
  uploadPaymentProof: vi.fn(),
  markOrderAsDispatched: vi.fn(),
  markOrderAsDelivered: vi.fn(),
  completeOrder: vi.fn(),
  reopenOrder: vi.fn(),
  ORDER_STATUS: { PENDING: 'pending', COMPLETED: 'completed', CANCELLED: 'cancelled' },
  PAYMENT_STATUS: { PENDING: 'pending', REJECTED: 'rejected', VALIDATED: 'validated' }
}));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/testimonialService', () => ({
  getUserTestimonial: vi.fn(async () => null),
  createTestimonial: vi.fn()
}));
vi.mock('@/lib/remittanceService', () => {
  const groups = {
    needs_validation: ['payment_proof_uploaded'],
    needs_delivery: ['payment_validated', 'processing'],
    awaiting_customer: ['payment_pending']
  };
  return {
    getMyRemittances: vi.fn(async () => ({ success: true, remittances: [] })),
    generateProofSignedUrl: vi.fn(),
    getAdminWorkRemittances: vi.fn(async () => ctx.remittances),
    REMITTANCE_WORK_GROUPS: groups,
    TO_PROCESS_STATUSES: ['payment_pending', 'payment_proof_uploaded'],
    groupRemittancesByWork: (list) =>
      Object.fromEntries(Object.keys(groups).map((k) => [k, list.filter((r) => groups[k].includes(r.status))])),
    validatePayment: vi.fn(),
    rejectPayment: vi.fn(),
    startProcessing: vi.fn(),
    confirmDelivery: vi.fn()
  };
});
vi.mock('@/lib/remittanceCalculations', () => ({ calcTotalToPay: () => 0 }));
vi.mock('@/components/ImageProofModal', () => ({ default: () => null }));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/lib/publicationService', () => ({ getPublications: vi.fn(async () => []) }));
vi.mock('@/lib/whatsappService', async (importOriginal) => ({
  ...(await importOriginal()),
  generateWhatsAppURL: vi.fn()
}));
vi.mock('@/lib/notificationSettingsService', () => ({ getActiveWhatsappRecipient: vi.fn(() => null) }));
vi.mock('@/lib/discountDisplayService', () => ({ derivePercentFromAmount: vi.fn(() => 0) }));
vi.mock('@/components/CategoryBadge', () => ({ default: () => null }));

import UserPanel from '@/components/UserPanel';

const rem = (id, status, hoursAgo = 1) => ({
  id,
  remittance_number: `REM-${id}`,
  status,
  amount_sent: 10,
  currency_sent: 'USD',
  recipient_name: 'Maria',
  sender_name: 'Juan',
  created_at: new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString()
});

const tab = (name) => screen.getByRole('tab', { name: new RegExp(name) });

describe('UserPanel admin work tabs', () => {
  beforeEach(() => {
    ctx.role = 'admin';
    ctx.ordersCount = 3;
    ctx.remittances = [rem('1', 'payment_pending'), rem('2', 'payment_proof_uploaded'), rem('3', 'processing')];
    ctx.active = 0;
    ctx.maxActive = 0;
    window.history.replaceState({}, '', '/user-panel');
  });

  it('renders an accessible tablist with order, remittance and refund tabs for admins', async () => {
    render(<UserPanel onNavigate={() => {}} />);
    const tablist = await screen.findByRole('tablist');
    expect(tablist.getAttribute('aria-label')).toBe('adminInbox.tablistLabel');
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(tab('adminInbox.ordersTab').getAttribute('aria-selected')).toBe('true');
    expect(tab('adminInbox.remittancesTab').getAttribute('aria-selected')).toBe('false');
    expect(tab('adminInbox.ordersTab').getAttribute('aria-controls')).toBe(
      screen.getByRole('tabpanel').getAttribute('id')
    );
  });

  it('shows counts with sr-only text and an aria-hidden visible number', async () => {
    render(<UserPanel onNavigate={() => {}} />);
    await waitFor(() => expect(within(tab('adminInbox.remittancesTab')).getByText('2')).toBeTruthy());
    const remittancesTab = tab('adminInbox.remittancesTab');
    expect(within(remittancesTab).getByText('2').getAttribute('aria-hidden')).toBe('true');
    expect(remittancesTab.querySelector('.sr-only').textContent).toContain('adminInbox.countSr');
    expect(within(tab('adminInbox.ordersTab')).getByText('3').getAttribute('aria-hidden')).toBe('true');
  });

  it('shows no count (instead of 0) on the remittances tab when loading failed', async () => {
    const { getAdminWorkRemittances } = await import('@/lib/remittanceService');
    getAdminWorkRemittances.mockRejectedValueOnce(new Error('boom'));
    render(<UserPanel onNavigate={() => {}} />);
    await within(await screen.findByRole('tablist')).findByText('3');
    await waitFor(() => expect(getAdminWorkRemittances).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    const remittancesTab = tab('adminInbox.remittancesTab');
    expect(remittancesTab.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(remittancesTab.querySelector('.sr-only')).toBeNull();
  });

  it('switches to the remittances panel on click and writes ?tab=remittances', async () => {
    render(<UserPanel onNavigate={() => {}} />);
    await screen.findByRole('tablist');
    fireEvent.click(tab('adminInbox.remittancesTab'));

    expect(tab('adminInbox.remittancesTab').getAttribute('aria-selected')).toBe('true');
    expect(window.location.search).toContain('tab=remittances');
    const panel = screen.getByRole('tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe(tab('adminInbox.remittancesTab').getAttribute('id'));
    await waitFor(() => expect(within(panel).getAllByRole('listitem').length).toBe(2));
  });

  it('supports arrow, Home and End keys with roving tabindex', async () => {
    render(<UserPanel onNavigate={() => {}} />);
    await screen.findByRole('tablist');
    const orders = tab('adminInbox.ordersTab');
    const remittances = tab('adminInbox.remittancesTab');
    expect(orders.getAttribute('tabindex')).toBe('0');
    expect(remittances.getAttribute('tabindex')).toBe('-1');

    fireEvent.keyDown(orders, { key: 'ArrowRight' });
    expect(remittances.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(remittances);

    const refunds = tab('adminRefunds.tab');
    fireEvent.keyDown(remittances, { key: 'ArrowRight' });
    expect(refunds.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(refunds, { key: 'ArrowRight' });
    expect(orders.getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(orders, { key: 'End' });
    expect(refunds.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(refunds, { key: 'Home' });
    expect(orders.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(orders, { key: 'ArrowLeft' });
    expect(refunds.getAttribute('aria-selected')).toBe('true');
  });

  it('opens the remittances tab when the URL says ?tab=remittances', async () => {
    window.history.replaceState({}, '', '/user-panel?tab=remittances');
    render(<UserPanel onNavigate={() => {}} />);
    await screen.findByRole('tablist');
    expect(tab('adminInbox.remittancesTab').getAttribute('aria-selected')).toBe('true');
  });

  it('defaults to remittances when there is no URL param, no pending orders and pending remittances', async () => {
    ctx.ordersCount = 0;
    render(<UserPanel onNavigate={() => {}} />);
    await waitFor(() => expect(tab('adminInbox.remittancesTab').getAttribute('aria-selected')).toBe('true'));
  });

  it('stays on orders by default when there are pending orders', async () => {
    render(<UserPanel onNavigate={() => {}} />);
    await waitFor(() => expect(within(tab('adminInbox.remittancesTab')).getByText('2')).toBeTruthy());
    expect(tab('adminInbox.ordersTab').getAttribute('aria-selected')).toBe('true');
  });

  it('does not override an explicit choice of orders in the URL', async () => {
    ctx.ordersCount = 0;
    window.history.replaceState({}, '', '/user-panel?tab=orders');
    render(<UserPanel onNavigate={() => {}} />);
    await waitFor(() => expect(within(tab('adminInbox.remittancesTab')).getByText('2')).toBeTruthy());
    expect(tab('adminInbox.ordersTab').getAttribute('aria-selected')).toBe('true');
  });

  it('opens exactly one realtime remittance subscription for admins', async () => {
    render(<UserPanel onNavigate={() => {}} />);
    await screen.findByRole('tablist');
    fireEvent.click(tab('adminInbox.remittancesTab'));
    fireEvent.click(tab('adminInbox.ordersTab'));
    expect(ctx.maxActive).toBe(1);
  });

  it('uses the translated heading for the orders card instead of a hardcoded string', async () => {
    render(<UserPanel onNavigate={() => {}} />);
    expect(await screen.findByText('adminInbox.ordersHeading')).toBeTruthy();
    expect(screen.queryByText('Pedidos Pendientes')).toBeNull();
  });

  it('leaves the regular user panel unchanged: no tabs, no admin remittance loading', async () => {
    ctx.role = 'user';
    const { getAdminWorkRemittances } = await import('@/lib/remittanceService');
    getAdminWorkRemittances.mockClear();
    render(<UserPanel onNavigate={() => {}} />);
    await screen.findByText('userPanel.myOrders');
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(getAdminWorkRemittances).not.toHaveBeenCalled();
  });
});
