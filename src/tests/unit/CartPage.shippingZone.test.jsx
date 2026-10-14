import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

// ─── Mutable test state read by the mocks ───────────────────────────────────
const state = {
  cart: [],
  zones: [],
  pick: { province: '', municipality: '' },
  calcImpl: async () => ({ cost: 0 }),
};

const USD = 'usd-id';

let nextId = 1;
const zone = (province, municipality, cost, { free = false, active = true } = {}) => ({
  id: nextId++,
  province_name: province,
  municipality_name: municipality,
  shipping_cost: cost,
  free_shipping: free,
  is_active: active,
});

const liveZones = () => [
  zone('Artemisa', null, 0),
  zone('Camagüey', null, 0),
  zone('Camagüey', 'Camagüey', 5),
  zone('Camagüey', 'Guáimaro', 6),
  zone('Ciego de Ávila', null, 20),
  zone('Ciego de Ávila', 'Primero de Enero', 0, { free: true }),
];

// ─── Context mocks ───────────────────────────────────────────────────────────
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'es' }),
}));

vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({
    cart: state.cart,
    updateCartQuantity: vi.fn(),
    removeFromCart: vi.fn(),
    clearCart: vi.fn(),
    financialSettings: { productProfit: 40, comboProfit: 35 },
    zelleAccounts: [],
    visualSettings: {},
    businessInfo: {},
    notificationSettings: {},
  }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true, user: { id: 'u1', email: 'u@test.com' } }),
}));

vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    selectedCurrency: USD,
    setSelectedCurrency: vi.fn(),
    currencies: [{ id: USD, code: 'USD', is_base: true }],
    currencyCode: 'USD',
    currencySymbol: '$',
    convertAmount: (amount) => amount,
  }),
}));

vi.mock('@/contexts/ModalContext', () => ({
  useModal: () => ({ showModal: vi.fn().mockResolvedValue(true) }),
}));

vi.mock('@/hooks/useUserDiscounts', () => ({
  useUserDiscounts: () => ({ categoryInfo: { category: 'regular' }, categoryDiscountPercent: 0 }),
}));

// ─── Service / helper mocks ──────────────────────────────────────────────────
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/shippingService', () => ({
  getActiveShippingZones: vi.fn(async () => state.zones),
  calculateShippingCost: vi.fn((...args) => state.calcImpl(...args)),
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
// The recipient picker stub reports the destination configured in state.pick.
vi.mock('@/components/RecipientSelector', () => ({
  default: ({ onSelect }) => (
    <button
      type="button"
      onClick={() =>
        onSelect({
          isNew: true,
          formData: {
            full_name: 'Ana',
            phone: '+5355551234',
            province: state.pick.province,
            municipality: state.pick.municipality,
            address_line_1: 'Calle 1',
          },
        })
      }
    >
      pick-recipient
    </button>
  ),
}));
vi.mock('@/components/ZelleAccountSelector', () => ({ default: () => null }));
vi.mock('@/components/ZelleAccountAlert', () => ({ default: () => null }));
vi.mock('@/components/FileUploadWithPreview', () => ({ default: () => null }));
vi.mock('@/components/CurrencySelector', () => ({ default: () => null }));
vi.mock('@/components/ui/ConfirmationModal', () => ({ default: () => null }));
vi.mock('@/components/shared/ZelleAccountDisplay', () => ({ default: () => null }));

import CartPage from '@/components/CartPage';

const openRecipientStepWith = async (province, municipality) => {
  state.pick = { province, municipality };
  render(<CartPage onNavigate={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'cart.checkout' }));
  fireEvent.click(await screen.findByRole('button', { name: 'pick-recipient' }));
};

const continueButton = () => screen.getByRole('button', { name: /Continuar al Pago/ });

describe('CartPage - shipping zone availability blocks advancing', () => {
  beforeEach(() => {
    state.cart = [{
      id: 'p1', name: 'Producto', name_es: 'Producto', base_price: 1, profit_margin: 45,
      final_price: 1.45, base_currency_id: USD, quantity: 2,
    }];
    state.zones = liveZones();
    state.calcImpl = async (province, _total, municipality) => {
      // Mirrors shippingService: municipality row first, province row as fallback
      const rows = state.zones.filter((z) => z.province_name === province);
      const row = rows.find((z) => z.municipality_name === municipality) || rows.find((z) => !z.municipality_name);
      return { cost: row.free_shipping ? 0 : parseFloat(row.shipping_cost) };
    };
  });

  it('blocks a province with no available zone and shows the unavailable message', async () => {
    await openRecipientStepWith('Artemisa', 'Artemisa');
    expect(await screen.findByText('cart.shippingUnavailable')).toBeInTheDocument();
    await waitFor(() => expect(continueButton()).toBeDisabled());
    expect(screen.queryByText(/Envío Gratis/)).toBeNull();
  });

  it('blocks a municipality without its own row under a province fee of 0, instead of charging 0', async () => {
    await openRecipientStepWith('Camagüey', 'Najasa');
    expect(await screen.findByText('cart.shippingUnavailable')).toBeInTheDocument();
    await waitFor(() => expect(continueButton()).toBeDisabled());
    expect(screen.queryByText(/Envío Gratis/)).toBeNull();
  });

  it('allows a municipality with its own price in a province only selectable through municipalities', async () => {
    await openRecipientStepWith('Camagüey', 'Guáimaro');
    expect(await screen.findByText('$6.00')).toBeInTheDocument();
    expect(screen.queryByText('cart.shippingUnavailable')).toBeNull();
    expect(continueButton()).not.toBeDisabled();
  });

  it('still allows a genuinely free municipality', async () => {
    await openRecipientStepWith('Ciego de Ávila', 'Primero de Enero');
    expect(await screen.findByText(/¡Envío Gratis!/)).toBeInTheDocument();
    expect(continueButton()).not.toBeDisabled();
  });

  it('blocks instead of treating shipping as free when the cost calculation fails', async () => {
    state.calcImpl = async () => {
      throw new Error('boom');
    };
    await openRecipientStepWith('Ciego de Ávila', 'Bolivia');
    expect(await screen.findByText('cart.shippingUnavailable')).toBeInTheDocument();
    await waitFor(() => expect(continueButton()).toBeDisabled());
    expect(screen.queryByText(/Envío Gratis/)).toBeNull();
  });
});
