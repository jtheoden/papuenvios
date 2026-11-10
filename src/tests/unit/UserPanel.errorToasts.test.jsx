import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const authUser = vi.hoisted(() => ({ id: 'u1', email: 'u@test.com' }));
const toastMock = vi.hoisted(() => vi.fn());
const ORDER = {
  id: 'o1',
  order_number: 'ORD-1',
  status: 'pending',
  payment_status: 'pending',
  subtotal: 10,
  total_amount: 10,
  discount_amount: 0,
  shipping_cost: 0,
  created_at: '2026-01-01T00:00:00Z',
  order_items: [],
};

vi.mock('@/components/ui/use-toast', () => ({ toast: toastMock }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: authUser, userRole: 'user', userCategory: 'regular' }),
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
vi.mock('@/hooks/useUserDiscounts', () => ({
  useUserDiscounts: () => ({ categoryDiscountPercent: 0 }),
}));
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
vi.mock('@/lib/testimonialService', () => ({
  getUserTestimonial: vi.fn(async () => null),
  createTestimonial: vi.fn(),
}));
vi.mock('@/lib/remittanceService', () => ({
  getMyRemittances: vi.fn(),
  generateProofSignedUrl: vi.fn(),
}));
vi.mock('@/lib/publicationService', () => ({ getPublications: vi.fn(async () => []) }));
vi.mock('@/lib/whatsappService', async (importOriginal) => ({
  ...(await importOriginal()),
  generateWhatsAppURL: vi.fn(),
}));
vi.mock('@/lib/notificationSettingsService', () => ({ getActiveWhatsappRecipient: vi.fn(() => null) }));
vi.mock('@/lib/discountDisplayService', () => ({ derivePercentFromAmount: vi.fn(() => 0) }));
vi.mock('@/components/CategoryBadge', () => ({ default: () => null }));

import UserPanel from '@/components/UserPanel';
import { getUserOrders, getOrderById } from '@/lib/orderService';
import { getMyRemittances } from '@/lib/remittanceService';

const expectErrorToast = (descriptionKey) =>
  waitFor(() =>
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive', description: descriptionKey })
    )
  );

describe('UserPanel - silent errors surface as toasts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    getUserOrders.mockResolvedValue([ORDER]);
    getOrderById.mockResolvedValue(ORDER);
    getMyRemittances.mockResolvedValue({ success: true, remittances: [] });
  });

  it('toasts when orders fail to load', async () => {
    getUserOrders.mockRejectedValue(new Error('db down'));
    render(<UserPanel onNavigate={vi.fn()} />);
    await expectErrorToast('userPanel.loadOrdersError');
  });

  it('toasts when remittances fail to load', async () => {
    getMyRemittances.mockRejectedValue(new Error('db down'));
    render(<UserPanel onNavigate={vi.fn()} />);
    await expectErrorToast('userPanel.loadRemittancesError');
  });

  it('toasts when order details fail to load', async () => {
    getOrderById.mockRejectedValue(new Error('db down'));
    render(<UserPanel onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByText('ORD-1'));
    await expectErrorToast('userPanel.loadOrderDetailsError');
  });
});
