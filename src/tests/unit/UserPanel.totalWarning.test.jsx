/**
 * RB-22: the admin payment-validation view warns (non-blocking) when the order money does not add up.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const authUser = vi.hoisted(() => ({ id: 'admin-1', email: 'a@test.com' }));
const auth = vi.hoisted(() => ({ role: 'admin' }));
const ORDER = {
  id: 'o1',
  order_number: 'ORD-1',
  status: 'pending',
  payment_status: 'proof_uploaded',
  subtotal: 50,
  total_amount: 0.01,
  discount_amount: 0,
  shipping_cost: 0,
  created_at: '2026-01-01T00:00:00Z',
  order_items: [{ id: 'i1', item_type: 'product', total_price: 50 }],
  user_id: 'customer-9',
};

vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: authUser, userRole: auth.role, userCategory: 'regular' }),
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
  await waitFor(() => expect(getOrderById).toHaveBeenCalled());
};

const KEY = 'adminOrders.totalWarning.total_below_formula';

describe('UserPanel - order total warning for admins (RB-22)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.role = 'admin';
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it.each(['pending', 'proof_uploaded'])('admin sees the alert with the cause when payment is %s and the total is incoherent', async (payment_status) => {
    await open({ ...ORDER, payment_status });
    const alert = await screen.findByText(KEY);
    expect(alert).toHaveAttribute('role', 'alert');
  });

  it('shows the subtotal cause when the items do not add up', async () => {
    await open({ ...ORDER, subtotal: 80, total_amount: 80 });
    expect((await screen.findByText('adminOrders.totalWarning.subtotal_mismatch')).getAttribute('role')).toBe('alert');
  });

  it('a non-admin owner does not see it', async () => {
    auth.role = 'user';
    await open({ ...ORDER, user_id: 'admin-1' });
    expect(screen.queryByText(KEY)).toBeNull();
  });

  it('is not shown once the payment is validated', async () => {
    await open({ ...ORDER, payment_status: 'validated', status: 'dispatched' });
    await screen.findByRole('button', { name: /adminOrders\.action\.markAsDelivered/ });
    expect(screen.queryByText(KEY)).toBeNull();
  });

  it('is not shown when the total is coherent', async () => {
    await open({ ...ORDER, total_amount: 50 });
    await screen.findByRole('button', { name: /Validate Payment/ });
    expect(screen.queryByText(/adminOrders\.totalWarning/)).toBeNull();
  });
});
