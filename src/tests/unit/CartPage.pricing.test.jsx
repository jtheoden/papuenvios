import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// ─── Mutable test state read by the mocked contexts ─────────────────────────
const state = {
  cart: [],
  combos: [],
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
    combos: state.combos,
    updateCartQuantity: vi.fn(),
    removeFromCart: vi.fn(),
    clearCart: vi.fn(),
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
  useModal: () => ({ showModal: vi.fn() }),
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
  pickAvailableZelleAccount: vi.fn(),
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

const rawCatalogProduct = (overrides = {}) => ({
  id: 'p1',
  name: 'Producto de prueba',
  name_es: 'Producto de prueba',
  base_price: 1,
  profit_margin: 45,
  final_price: 1.45,
  base_currency_id: USD,
  quantity: 2,
  ...overrides,
});

const unitPriceLine = () => screen.getByText(/Precio unitario:/);

describe('CartPage pricing - products added from the catalog list', () => {
  beforeEach(() => {
    state.financialSettings = { productProfit: 40, comboProfit: 35 };
  });

  it('shows the catalog final_price as the unit price, not base_price with the global margin', () => {
    state.cart = [rawCatalogProduct()];
    render(<CartPage onNavigate={vi.fn()} />);

    // 1.45 (catalog) and 2.90 (2 units). The legacy path would show 1.40 / 2.80.
    expect(unitPriceLine()).toHaveTextContent('$1.45 USD');
    expect(unitPriceLine()).not.toHaveTextContent('$1.40 USD');
    expect(screen.getByText(/^Subtotal:/)).toHaveTextContent('$2.90 USD');
  });

  it('does not change the charged price when the global product margin setting changes', () => {
    state.financialSettings = { productProfit: 90, comboProfit: 35 };
    state.cart = [rawCatalogProduct()];
    render(<CartPage onNavigate={vi.fn()} />);

    expect(unitPriceLine()).toHaveTextContent('$1.45 USD');
  });

  it('converts a product priced in another currency to USD like the catalog does', () => {
    // 1000 CUP / 770 = 1.2987 -> 1.30 USD
    state.cart = [rawCatalogProduct({ final_price: 1000, base_currency_id: CUP, quantity: 1 })];
    render(<CartPage onNavigate={vi.fn()} />);

    expect(unitPriceLine()).toHaveTextContent('$1.30 USD');
  });

  it('fails closed for old cart entries that have no final_price: visible alert, never a base_price price', () => {
    state.cart = [rawCatalogProduct({ final_price: undefined, profit_margin: undefined, quantity: 1 })];
    render(<CartPage onNavigate={vi.fn()} />);

    expect(screen.getByRole('alert')).toHaveTextContent('cart.invalidItems');
    expect(screen.queryByText(/\$1\.40/)).toBeNull();
  });
});

describe('CartPage pricing - combos already in the cart before the stored price was carried', () => {
  const staleCombo = (overrides = {}) => ({
    id: 'c1', name: 'Combo viejo', products: ['a'], baseTotalPrice: 100, profitMargin: 20, quantity: 1, ...overrides,
  });

  beforeEach(() => {
    state.combos = [];
  });

  it('prices the stale combo from the live catalog final price', () => {
    state.cart = [staleCombo()];
    state.combos = [{ id: 'c1', finalPrice: 66.5 }];
    render(<CartPage onNavigate={vi.fn()} />);

    expect(unitPriceLine()).toHaveTextContent('$66.50 USD');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('fails closed with a visible alert when the combo is gone from the catalog', () => {
    state.cart = [staleCombo()];
    render(<CartPage onNavigate={vi.fn()} />);

    expect(screen.getByRole('alert')).toHaveTextContent('cart.invalidItems');
  });
});
