/**
 * W6a: the admin block of a dispatched order in UserPanel opens the same optional-photo dialog.
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
import { getUserOrders, getAllOrders, getPendingOrdersCount, getOrderById, markOrderAsDelivered } from '@/lib/orderService';
import { getMyRemittances } from '@/lib/remittanceService';

describe('UserPanel - admin delivery of a dispatched order', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    getUserOrders.mockResolvedValue([ORDER]);
    getAllOrders.mockResolvedValue([ORDER]);
    getPendingOrdersCount.mockResolvedValue(3);
    getOrderById.mockResolvedValue(ORDER);
    getMyRemittances.mockResolvedValue({ success: true, remittances: [] });
    markOrderAsDelivered.mockResolvedValue({ ...ORDER, status: 'delivered' });
  });

  const openDialog = async () => {
    render(<UserPanel onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByText('ORD-1'));
    fireEvent.click(await screen.findByRole('button', { name: /adminOrders\.action\.markAsDelivered/ }));
    return screen.findByRole('dialog');
  };

  it('has no inline mandatory file input any more; the button is enabled without a photo', async () => {
    render(<UserPanel onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByText('ORD-1'));
    const button = await screen.findByRole('button', { name: /adminOrders\.action\.markAsDelivered/ });
    expect(button.disabled).toBe(false);
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('confirming without a photo calls markOrderAsDelivered(id, null, adminId) and refreshes the order', async () => {
    await openDialog();
    getOrderById.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'adminOrders.deliveryModal.submit' }));
    await waitFor(() => expect(markOrderAsDelivered).toHaveBeenCalledWith('o1', null, 'admin-1'));
    await waitFor(() => expect(getOrderById).toHaveBeenCalledWith('o1'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('a failing refresh AFTER the delivery succeeded closes the dialog and never shows a delivery error', async () => {
    await openDialog();
    getOrderById.mockRejectedValue(new Error('refresh failed'));
    fireEvent.click(screen.getByRole('button', { name: 'adminOrders.deliveryModal.submit' }));
    await waitFor(() => expect(getOrderById).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(markOrderAsDelivered).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('refresh failed')).toBeNull();
  });
});

describe('UserPanel - customer view of a delivery without a photo', () => {
  it('still shows "Delivered on {date}" when there is no delivery photo', async () => {
    const delivered = { ...ORDER, status: 'delivered', delivered_at: '2026-01-05T15:00:00Z', delivery_proof_url: null };
    getUserOrders.mockResolvedValue([delivered]);
    getAllOrders.mockResolvedValue([delivered]);
    getOrderById.mockResolvedValue(delivered);
    getPendingOrdersCount.mockResolvedValue(3);
    getMyRemittances.mockResolvedValue({ success: true, remittances: [] });
    render(<UserPanel onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByText('ORD-1'));
    expect(await screen.findByText(/Delivered on/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Delivery Proof/);
  });
});
