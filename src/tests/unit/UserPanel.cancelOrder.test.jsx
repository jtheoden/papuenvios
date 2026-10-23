import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const authUser = vi.hoisted(() => ({ id: 'u1', email: 'u@test.com' }));
const showModal = vi.hoisted(() => vi.fn());
const order = (status, payment_status) => ({
  id: 'o1',
  order_number: 'ORD-1',
  status,
  payment_status,
  subtotal: 10,
  total_amount: 10,
  discount_amount: 0,
  shipping_cost: 0,
  created_at: '2026-01-01T00:00:00Z',
  order_items: [],
});

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: authUser, userRole: 'user', userCategory: 'regular' }),
}));
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key, params) => (params?.days ? `${key}|${params.days}` : key), language: 'en' }),
}));
vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({ visualSettings: {}, notificationSettings: {} }),
}));
vi.mock('@/contexts/ModalContext', () => ({ useModal: () => ({ showModal }) }));
vi.mock('@/components/LegalContact', () => ({ default: () => <span data-testid="legal-contact" /> }));
vi.mock('@/hooks/useUserDiscounts', () => ({ useUserDiscounts: () => ({ categoryDiscountPercent: 0 }) }));
vi.mock('@/hooks/useRealtimeSubscription', () => ({
  useRealtimeRemittances: vi.fn(),
  useRealtimeOrders: vi.fn(),
}));
vi.mock('@/lib/orderService', () => ({
  getUserOrders: vi.fn(),
  getOrderById: vi.fn(),
  getAllOrders: vi.fn(),
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
  getMyRemittances: vi.fn(async () => ({ success: true, remittances: [] })),
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
import { getUserOrders, getOrderById, cancelOrderByUser } from '@/lib/orderService';

const WARNING = 'userPanel.cancelProofUploadedWarning';
const cancelButton = () => screen.queryByRole('button', { name: 'Cancel order' });
const settle = () => new Promise((resolve) => setTimeout(resolve, 40));

const openOrder = async (status, paymentStatus) => {
  const o = order(status, paymentStatus);
  getUserOrders.mockResolvedValue([o]);
  getOrderById.mockResolvedValue(o);
  render(<UserPanel onNavigate={vi.fn()} />);
  fireEvent.click(await screen.findByText('ORD-1'));
  await settle();
};

const clickCancel = async () => {
  await waitFor(() => expect(cancelButton()).toBeInTheDocument());
  fireEvent.click(cancelButton());
};

describe('UserPanel - customer cancels an order until the payment is validated', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    showModal.mockResolvedValue(true);
    cancelOrderByUser.mockResolvedValue({});
  });

  it.each(['pending', 'proof_uploaded', 'rejected'])('shows the cancel button when payment_status is %s', async (ps) => {
    await openOrder('pending', ps);
    await waitFor(() => expect(cancelButton()).toBeInTheDocument());
  });

  it('does not show it once the payment is validated', async () => {
    await openOrder('pending', 'validated');
    expect(cancelButton()).not.toBeInTheDocument();
  });

  it('does not show it when the order is no longer pending', async () => {
    await openOrder('processing', 'proof_uploaded');
    expect(cancelButton()).not.toBeInTheDocument();
  });

  it('with the proof uploaded it shows the refund policy notice (days, Terms link, contact) and cancels only after confirming', async () => {
    await openOrder('pending', 'proof_uploaded');
    await clickCancel();
    await waitFor(() => expect(cancelOrderByUser).toHaveBeenCalledWith('o1', 'u1', 'cancelled_by_user'));
    const { container } = render(<div>{showModal.mock.calls[0][0].message}</div>);
    expect(container).toHaveTextContent(`${WARNING}|5`);
    expect(container.querySelector('a[href="/terms#refunds"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="legal-contact"]')).not.toBeNull();
  });

  it.each(['pending', 'rejected', 'proof_uploaded'])('keeps the order when the customer declines the confirmation (%s)', async (ps) => {
    showModal.mockResolvedValue(false);
    await openOrder('pending', ps);
    await clickCancel();
    await waitFor(() => expect(showModal).toHaveBeenCalled());
    await settle();
    expect(cancelOrderByUser).not.toHaveBeenCalled();
  });

  it.each(['pending', 'rejected'])('asks a simple confirmation, without the refund notice, when payment_status is %s', async (ps) => {
    await openOrder('pending', ps);
    await clickCancel();
    await waitFor(() => expect(cancelOrderByUser).toHaveBeenCalledWith('o1', 'u1', 'cancelled_by_user'));
    expect(showModal).toHaveBeenCalledTimes(1);
    const { container } = render(<div>{showModal.mock.calls[0][0].message}</div>);
    expect(container).not.toHaveTextContent(WARNING);
    expect(container.querySelector('a[href="/terms#refunds"]')).toBeNull();
  });

  it('reloads the orders and closes the detail when someone else already moved the order (status conflict)', async () => {
    cancelOrderByUser.mockRejectedValue({ code: 'CONFLICT', context: { reason: 'invalid_transition' }, message: 'x' });
    await openOrder('pending', 'pending');
    const before = getUserOrders.mock.calls.length;
    await clickCancel();
    await waitFor(() => expect(getUserOrders.mock.calls.length).toBeGreaterThan(before));
    await waitFor(() => expect(cancelButton()).not.toBeInTheDocument());
  });
});
