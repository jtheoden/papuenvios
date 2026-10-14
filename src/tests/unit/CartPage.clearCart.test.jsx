import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// ─── Mutable test state read by the mocked contexts ─────────────────────────
const clearCartMock = vi.fn();
const showModalMock = vi.fn();
const state = {
  cart: [],
  financialSettings: { productProfit: 40, comboProfit: 35 },
};

const USD = 'usd-id';
const CUP = 'cup-id';

// 1 USD = 770 CUP, same shape as CurrencyContext.convertAmount(amount, fromId, toId)
const convertAmount = (amount, from, to) => {
  if (from === to) return amount;
  if (from === CUP && to === USD) return amount / 770;
  if (from === USD && to === CUP) return amount * 770;
  return amount;
};

// ─── Context mocks ───────────────────────────────────────────────────────────
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'es' }),
}));

vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({
    cart: state.cart,
    updateCartQuantity: vi.fn(),
    removeFromCart: vi.fn(),
    clearCart: clearCartMock,
    financialSettings: state.financialSettings,
    zelleAccounts: [],
    visualSettings: {},
    businessInfo: {},
    notificationSettings: {},
  }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: false, user: null }),
}));

vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    selectedCurrency: USD,
    setSelectedCurrency: vi.fn(),
    currencies: [
      { id: USD, code: 'USD', is_base: true },
      { id: CUP, code: 'CUP', is_base: false },
    ],
    currencyCode: 'USD',
    currencySymbol: '$',
    convertAmount,
  }),
}));

vi.mock('@/contexts/ModalContext', () => ({
  useModal: () => ({ showModal: showModalMock }),
}));

vi.mock('@/hooks/useUserDiscounts', () => ({
  useUserDiscounts: () => ({ categoryInfo: { category: 'regular' }, categoryDiscountPercent: 0 }),
}));

// ─── Service / helper mocks ──────────────────────────────────────────────────
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/shippingService', () => ({
  getActiveShippingZones: vi.fn().mockResolvedValue([]),
  calculateShippingCost: vi.fn().mockResolvedValue({ cost: 0 }),
}));
vi.mock('@/lib/cubanLocations', () => ({ getMunicipalitiesByProvince: () => [] }));
vi.mock('@/lib/currencyService', () => ({ convertCurrency: vi.fn(async (amount) => amount) }));
vi.mock('@/lib/whatsappService', () => ({
  generateWhatsAppURL: vi.fn(),
  notifyAdminNewPayment: vi.fn(),
  openWhatsAppChat: vi.fn(),
}));
vi.mock('@/lib/notificationSettingsService', () => ({
  getActiveWhatsappRecipient: vi.fn(),
  getFreshWhatsappRecipient: vi.fn(),
  getGuidedWhatsappPhone: vi.fn(() => ''),
  getFreshNotificationSettings: vi.fn(),
}));
vi.mock('@/lib/orderService', () => ({ createOrder: vi.fn(), uploadPaymentProof: vi.fn() }));
vi.mock('@/lib/zelleService', () => ({
  reserveZelleAccount: vi.fn(),
  registerZelleTransaction: vi.fn(),
  ZELLE_TRANSACTION_TYPES: {},
}));
vi.mock('@/lib/orderDiscountService', () => ({
  validateAndGetOffer: vi.fn(),
  recordOfferUsage: vi.fn(),
}));
vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/imageUtils', () => ({ processImage: vi.fn() }));
vi.mock('@/lib/styleUtils', () => ({
  getHeadingStyle: () => ({}),
  getPrimaryButtonStyle: () => ({}),
  getAlertStyle: () => ({}),
}));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));

// ─── Child component stubs (not under test) ──────────────────────────────────
vi.mock('@/components/RecipientSelector', () => ({ default: () => null }));
vi.mock('@/components/ZelleAccountSelector', () => ({ default: () => null }));
vi.mock('@/components/ZelleAccountAlert', () => ({ default: () => null }));
vi.mock('@/components/FileUploadWithPreview', () => ({ default: () => null }));
vi.mock('@/components/CurrencySelector', () => ({ default: () => null }));
vi.mock('@/components/ui/ConfirmationModal', () => ({ default: () => null }));
vi.mock('@/components/shared/ZelleAccountDisplay', () => ({ default: () => null }));

import CartPage from '@/components/CartPage';
import { fireEvent, waitFor } from '@testing-library/react';

const product = () => ({
  id: 'p1',
  name: 'Producto de prueba',
  name_es: 'Producto de prueba',
  base_price: 1,
  final_price: 1.45,
  base_currency_id: USD,
  quantity: 1,
});

const clearButton = () => screen.queryByRole('button', { name: 'cart.clearAll.button' });

describe('CartPage - clear cart', () => {
  beforeEach(() => {
    clearCartMock.mockClear();
    showModalMock.mockReset();
    state.cart = [product()];
  });

  it('shows the clear-cart button when the cart has items', () => {
    render(<CartPage onNavigate={vi.fn()} />);
    expect(clearButton()).toBeInTheDocument();
  });

  it('does not show the button when the cart is empty', () => {
    state.cart = [];
    render(<CartPage onNavigate={vi.fn()} />);
    expect(clearButton()).not.toBeInTheDocument();
  });

  it('asks for confirmation with a danger modal and does not clear before confirming', async () => {
    showModalMock.mockResolvedValue(false);
    render(<CartPage onNavigate={vi.fn()} />);
    fireEvent.click(clearButton());

    await waitFor(() => expect(showModalMock).toHaveBeenCalledTimes(1));
    expect(showModalMock.mock.calls[0][0]).toMatchObject({ type: 'danger' });
    expect(clearCartMock).not.toHaveBeenCalled();
  });

  it('clears the cart when the user confirms', async () => {
    showModalMock.mockResolvedValue(true);
    render(<CartPage onNavigate={vi.fn()} />);
    fireEvent.click(clearButton());

    await waitFor(() => expect(clearCartMock).toHaveBeenCalled());
  });
});
