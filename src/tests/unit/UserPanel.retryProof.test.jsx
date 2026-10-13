import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const authUser = vi.hoisted(() => ({ id: 'u1', email: 'u@test.com' }));
const VALID_PHONE = '+13055551234';
const REJECTED_ORDER = {
  id: 'o1',
  order_number: 'ORD-1',
  status: 'pending',
  payment_status: 'rejected',
  subtotal: 10,
  total_amount: 10,
  discount_amount: 0,
  shipping_cost: 0,
  created_at: '2026-01-01T00:00:00Z',
  order_items: [],
};

// ─── Context / hook mocks ────────────────────────────────────────────────────
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

// ─── Service mocks ───────────────────────────────────────────────────────────
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
import { getUserOrders, getOrderById, uploadPaymentProof } from '@/lib/orderService';

const retryButton = () => screen.getByRole('button', { name: /Retry payment/ });
const phoneInput = () => screen.getByPlaceholderText('E.g.: +1 305 555 0100');

const openRetryForm = async () => {
  const { container } = render(<UserPanel onNavigate={vi.fn()} />);
  fireEvent.click(await screen.findByText('ORD-1'));
  await screen.findByText('Upload new payment proof');
  return container;
};

const fillProofAndPayer = (container) => {
  const file = new File(['x'], 'proof.png', { type: 'image/png' });
  fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });
  fireEvent.change(screen.getByPlaceholderText('E.g.: John Smith / ABC Corp LLC'), {
    target: { value: '  John Payer  ' },
  });
  return file;
};

describe('UserPanel - late payment proof retry form', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserOrders.mockResolvedValue([REJECTED_ORDER]);
    getOrderById.mockResolvedValue(REJECTED_ORDER);
    uploadPaymentProof.mockResolvedValue('https://files/proof.png');
  });

  it('keeps the retry button disabled and never uploads without a valid payer phone', async () => {
    const container = await openRetryForm();
    fillProofAndPayer(container);

    expect(retryButton()).toBeDisabled();
    fireEvent.click(retryButton());

    fireEvent.change(phoneInput(), { target: { value: 'abc' } });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(retryButton()).toBeDisabled();
    fireEvent.click(retryButton());

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(uploadPaymentProof).not.toHaveBeenCalled();
  });

  it('uploads with the trimmed payer phone and clears the phone field after success', async () => {
    const container = await openRetryForm();
    const file = fillProofAndPayer(container);

    fireEvent.change(phoneInput(), { target: { value: `  ${VALID_PHONE}  ` } });
    await waitFor(() => expect(retryButton()).not.toBeDisabled());
    fireEvent.click(retryButton());

    await waitFor(() => expect(uploadPaymentProof).toHaveBeenCalledTimes(1));
    expect(uploadPaymentProof).toHaveBeenCalledWith(file, 'o1', 'u1', 'John Payer', { payerPhone: VALID_PHONE });

    await waitFor(() => expect(phoneInput()).toHaveValue(''));
  });
});
