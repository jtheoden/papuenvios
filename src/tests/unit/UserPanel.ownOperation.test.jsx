/**
 * Separation of duties: an admin looking at his OWN order in UserPanel gets the admin actions disabled, with a visible reason.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const authUser = vi.hoisted(() => ({ id: 'admin-1', email: 'a@test.com' }));
const ORDER = {
  id: 'o1',
  order_number: 'ORD-1',
  status: 'dispatched',
  payment_status: 'validated',
  subtotal: 10,
  total_amount: 10,
  discount_amount: 0,
  shipping_cost: 0,
  created_at: '2026-01-01T00:00:00Z',
  order_items: [],
  user_id: 'admin-1',
};

vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: authUser, userRole: 'admin', userCategory: 'regular' }),
}));
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'en' }),
}));
vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({ visualSettings: {}, notificationSettings: {} }),
}));
vi.mock('@/contexts/ModalContext', () => ({
  useModal: () => ({ showModal: vi.fn().mockResolvedValue(true) }),
}));
vi.mock('@/hooks/useUserDiscounts', () => ({ useUserDiscounts: () => ({ categoryDiscountPercent: 0 }) }));
vi.mock('@/hooks/useRealtimeSubscription', () => ({
  useRealtimeRemittances: vi.fn(),
  useRealtimeOrders: vi.fn(),
}));
vi.mock('@/lib/orderService', () => ({
  getUserOrders: vi.fn(),
  getOrderById: vi.fn(),
  getAllOrders: vi.fn(),
  getPendingOrdersCount: vi.fn(),
  validatePayment: vi.fn(),
  rejectPayment: vi.fn(),
  cancelOrderByUser: vi.fn(),
  uploadPaymentProof: vi.fn(),
  markOrderAsDispatched: vi.fn(),
  markOrderAsDelivered: vi.fn(),
  completeOrder: vi.fn(),
  reopenOrder: vi.fn(),
  ORDER_STATUS: { PENDING: 'pending', COMPLETED: 'completed', CANCELLED: 'cancelled' },
  PAYMENT_STATUS: { PENDING: 'pending', REJECTED: 'rejected', VALIDATED: 'validated' },
}));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/testimonialService', () => ({ getUserTestimonial: vi.fn(async () => null), createTestimonial: vi.fn() }));
vi.mock('@/lib/remittanceService', () => ({ getMyRemittances: vi.fn(), generateProofSignedUrl: vi.fn() }));
vi.mock('@/lib/publicationService', () => ({ getPublications: vi.fn(async () => []) }));
vi.mock('@/lib/whatsappService', async (importOriginal) => ({ ...(await importOriginal()), generateWhatsAppURL: vi.fn() }));
vi.mock('@/lib/notificationSettingsService', () => ({ getActiveWhatsappRecipient: vi.fn(() => null) }));
vi.mock('@/lib/discountDisplayService', () => ({ derivePercentFromAmount: vi.fn(() => 0) }));
vi.mock('@/components/CategoryBadge', () => ({ default: () => null }));

import UserPanel from '@/components/UserPanel';
import { getUserOrders, getAllOrders, getPendingOrdersCount, getOrderById } from '@/lib/orderService';
import { getMyRemittances } from '@/lib/remittanceService';


const open = async (order) => {
  getUserOrders.mockResolvedValue([order]);
  getAllOrders.mockResolvedValue([order]);
  getOrderById.mockResolvedValue(order);
  getPendingOrdersCount.mockResolvedValue(0);
  getMyRemittances.mockResolvedValue({ success: true, remittances: [] });
  render(<UserPanel onNavigate={vi.fn()} />);
  fireEvent.click(await screen.findByText('ORD-1'));
};

describe('UserPanel - own order of an admin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it.each([
    ['pending', 'proof_uploaded', [/Validate Payment/, /Reject/]],
    ['dispatched', 'validated', [/adminOrders\.action\.markAsDelivered/]]
  ])('%s / %s: admin buttons are disabled and point to the visible reason', async (status, payment_status, names) => {
    await open({ ...ORDER, status, payment_status });
    const note = await screen.findByRole('note');
    expect(note.textContent).toContain('common.ownOperationReason');
    for (const name of names) {
      const button = await screen.findByRole('button', { name });
      expect(button.disabled).toBe(true);
      expect(document.getElementById(button.getAttribute('aria-describedby'))).toBe(note);
    }
  });

  it('an order of somebody else keeps the buttons enabled and shows no note', async () => {
    await open({ ...ORDER, user_id: 'customer-9', status: 'dispatched', payment_status: 'validated' });
    const button = await screen.findByRole('button', { name: /adminOrders\.action\.markAsDelivered/ });
    expect(button.disabled).toBe(false);
    expect(screen.queryByRole('note')).toBeNull();
  });
});
