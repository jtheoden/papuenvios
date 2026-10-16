import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// ─── Mutable test state read by the mocked contexts ─────────────────────────
const state = {
  cart: [],
  combos: [],
  financialSettings: { productProfit: 40, comboProfit: 35 },
  currency: 'CUP',
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
    selectedCurrency: state.currency === 'CUP' ? CUP : USD,
    setSelectedCurrency: vi.fn(),
    currencies: [
      { id: USD, code: 'USD', is_base: true },
      { id: CUP, code: 'CUP', is_base: false },
    ],
    currencyCode: state.currency,
    currencySymbol: state.currency === 'CUP' ? '₱' : '$',
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
vi.mock('@/lib/currencyService', () => ({ convertCurrency: vi.fn() }));
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
import { convertCurrency } from '@/lib/currencyService';

const product = () => ({
  id: 'p1',
  name: 'Producto de prueba',
  name_es: 'Producto de prueba',
  final_price: 10,
  base_currency_id: USD,
  quantity: 2,
});

describe('CartPage - no valid exchange rate for the selected currency (fail closed)', () => {
  beforeEach(() => {
    state.cart = [product()];
    state.currency = 'CUP';
  });

  describe('rate unavailable', () => {
    beforeEach(() => {
      convertCurrency.mockReset();
      convertCurrency.mockRejectedValue(new Error('No exchange rate available'));
    });

    it('never labels a USD amount with the CUP code or symbol', async () => {
      const { container } = render(<CartPage onNavigate={vi.fn()} />);
      await waitFor(() => expect(convertCurrency).toHaveBeenCalled());
      await waitFor(() => expect(screen.getByText('cart.rateUnavailable.notice')).toBeTruthy());

      expect(container.textContent).not.toMatch(/CUP/);
      expect(container.textContent).not.toContain('₱');
      expect(container.textContent).toMatch(/\$20\.00 USD/);
    });

    it('announces the problem with an accessible alert', async () => {
      render(<CartPage onNavigate={vi.fn()} />);
      const alert = await screen.findByText('cart.rateUnavailable.notice');
      expect(alert.closest('[role="alert"]')).not.toBeNull();
    });

    it('does not allow checking out in a currency without a rate', async () => {
      render(<CartPage onNavigate={vi.fn()} />);
      await screen.findByText('cart.rateUnavailable.notice');
      expect(screen.getByRole('button', { name: 'cart.checkout' }).disabled).toBe(true);
    });

    it('treats a non-finite conversion result as unavailable too', async () => {
      convertCurrency.mockReset();
      convertCurrency.mockResolvedValue(NaN);
      const { container } = render(<CartPage onNavigate={vi.fn()} />);
      await screen.findByText('cart.rateUnavailable.notice');
      expect(container.textContent).not.toMatch(/CUP/);
    });
  });

  describe('rate available (regression)', () => {
    beforeEach(() => {
      convertCurrency.mockReset();
      convertCurrency.mockImplementation(async (amount) => amount * 770);
    });

    it('shows converted amounts with the CUP code, no alert, checkout enabled', async () => {
      const { container } = render(<CartPage onNavigate={vi.fn()} />);
      await waitFor(() => expect(container.textContent).toMatch(/15400\.00 CUP/));

      expect(screen.queryByText('cart.rateUnavailable.notice')).toBeNull();
      expect(screen.getByRole('button', { name: 'cart.checkout' }).disabled).toBe(false);
    });
  });

  it('USD selected: unchanged, no conversion call, checkout enabled', () => {
    state.currency = 'USD';
    convertCurrency.mockReset();
    render(<CartPage onNavigate={vi.fn()} />);
    expect(convertCurrency).not.toHaveBeenCalled();
    expect(screen.queryByText('cart.rateUnavailable.notice')).toBeNull();
    expect(screen.getByRole('button', { name: 'cart.checkout' }).disabled).toBe(false);
  });
});
