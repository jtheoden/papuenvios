import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

const authUser = vi.hoisted(() => ({ id: 'u1', email: 'u@test.com' }));

const ORDER = {
  id: 'o1',
  order_number: 'ORD-1',
  status: 'pending',
  payment_status: 'pending',
  subtotal: 10,
  total_amount: 10,
  discount_amount: 0,
  shipping_cost: 0,
  created_at: '2026-10-15T05:29:42.995Z',
  order_items: [
    { item_type: 'product', item_id: 'p-sugar', item_name_es: 'Azucar', item_name_en: 'Sugar', quantity: 3, unit_price: 2, total_price: 6 },
    { item_type: 'combo', item_id: 'combo-10', item_name_es: 'COMBO 10', item_name_en: 'COMBO 10', quantity: 1, unit_price: 4, total_price: 4 }
  ]
};

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: authUser, userRole: 'user', userCategory: 'regular' })
}));
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'en' })
}));
vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({ visualSettings: {}, notificationSettings: {} })
}));
vi.mock('@/contexts/ModalContext', () => ({
  useModal: () => ({ showModal: vi.fn().mockResolvedValue(true) })
}));
vi.mock('@/hooks/useUserDiscounts', () => ({
  useUserDiscounts: () => ({ categoryDiscountPercent: 0 })
}));
vi.mock('@/hooks/useRealtimeSubscription', () => ({
  useRealtimeRemittances: vi.fn(),
  useRealtimeOrders: vi.fn()
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
  PAYMENT_STATUS: { PENDING: 'pending', REJECTED: 'rejected', VALIDATED: 'validated' }
}));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/testimonialService', () => ({
  getUserTestimonial: vi.fn(async () => null),
  createTestimonial: vi.fn()
}));
vi.mock('@/lib/remittanceService', () => ({
  getMyRemittances: vi.fn(async () => ({ success: true, remittances: [] })),
  generateProofSignedUrl: vi.fn()
}));
vi.mock('@/lib/publicationService', () => ({ getPublications: vi.fn(async () => []) }));
vi.mock('@/lib/whatsappService', async (importOriginal) => ({
  ...(await importOriginal()),
  generateWhatsAppURL: vi.fn()
}));
vi.mock('@/lib/notificationSettingsService', () => ({ getActiveWhatsappRecipient: vi.fn(() => null) }));
vi.mock('@/lib/discountDisplayService', () => ({ derivePercentFromAmount: vi.fn(() => 0) }));
vi.mock('@/components/CategoryBadge', () => ({ default: () => null }));

const fetchComboDefinitionsMock = vi.fn();
const fetchProductUnitsMock = vi.fn();
vi.mock('@/lib/orderComboService', () => ({
  fetchComboDefinitions: (...args) => fetchComboDefinitionsMock(...args),
  fetchProductUnits: (...args) => fetchProductUnitsMock(...args)
}));

import UserPanel from '@/components/UserPanel';
import { getUserOrders, getOrderById } from '@/lib/orderService';
import { toComboDefinitionMap, toProductUnitMap } from '@/lib/orderItemsPure';

const definition = (unit) =>
  toComboDefinitionMap([
    {
      id: 'combo-10',
      combo_items: [
        { product_id: 'p1', quantity: 2, created_at: '2026-10-11T08:00:00Z', products: { name_es: 'Arroz', name_en: 'Rice', unit } }
      ]
    }
  ]);

const openDetail = async () => {
  render(<UserPanel onNavigate={vi.fn()} />);
  fireEvent.click(await screen.findByText('ORD-1'));
};

describe('UserPanel order detail units', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserOrders.mockResolvedValue([ORDER]);
    getOrderById.mockResolvedValue(ORDER);
  });

  it('shows units on product lines and combo components', async () => {
    fetchProductUnitsMock.mockResolvedValue(toProductUnitMap([{ id: 'p-sugar', unit: 'lb' }]));
    fetchComboDefinitionsMock.mockResolvedValue(definition('lb'));
    await openDetail();

    const list = await screen.findByRole('list', { name: 'orderCombo.contains' });
    expect(within(list).getByText('2 lb × Rice')).toBeInTheDocument();
    expect(await screen.findByText(/Qty: 3 lb/)).toBeInTheDocument();
    expect(fetchProductUnitsMock).toHaveBeenCalledWith(['p-sugar']);
  });

  it('keeps plain quantities when no unit is set', async () => {
    fetchProductUnitsMock.mockResolvedValue(new Map());
    fetchComboDefinitionsMock.mockResolvedValue(definition(null));
    await openDetail();

    const list = await screen.findByRole('list', { name: 'orderCombo.contains' });
    expect(within(list).getByText('2 × Rice')).toBeInTheDocument();
    expect(screen.getByText(/Qty: 3$/)).toBeInTheDocument();
  });

  it('keeps plain quantities when the unit lookup fails', async () => {
    fetchProductUnitsMock.mockRejectedValue(new Error('boom'));
    fetchComboDefinitionsMock.mockResolvedValue(definition(null));
    await openDetail();

    await screen.findByRole('list', { name: 'orderCombo.contains' });
    expect(screen.getByText(/Qty: 3$/)).toBeInTheDocument();
  });
});
