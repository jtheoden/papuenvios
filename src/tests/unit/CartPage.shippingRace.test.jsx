import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';

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

// Manually controlled promises, keyed by municipality, to force response ordering.
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const pending = {};

const pickRecipient = async (province, municipality) => {
  state.pick = { province, municipality };
  fireEvent.click(await screen.findByRole('button', { name: 'pick-recipient' }));
};

const continueButton = () => screen.getByRole('button', { name: /Continuar al Pago/ });

const flushMicrotasks = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('CartPage - shipping cost requests resolving out of order', () => {
  beforeEach(() => {
    state.cart = [{
      id: 'p1', name: 'Producto', name_es: 'Producto', base_price: 1, profit_margin: 45,
      final_price: 1.45, base_currency_id: USD, quantity: 2,
    }];
    state.zones = liveZones();
    Object.keys(pending).forEach((k) => delete pending[k]);
    state.calcImpl = (_province, _total, municipality) => {
      pending[municipality] = deferred();
      return pending[municipality].promise;
    };
  });

  const startAt = async (province, municipality) => {
    state.pick = { province, municipality };
    render(<CartPage onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'cart.checkout' }));
    fireEvent.click(await screen.findByRole('button', { name: 'pick-recipient' }));
    await waitFor(() => expect(pending[municipality]).toBeDefined());
  };

  it('keeps the newer destination cost when the older response arrives last', async () => {
    await startAt('Camagüey', 'Camagüey');
    await pickRecipient('Camagüey', 'Guáimaro');
    await waitFor(() => expect(pending['Guáimaro']).toBeDefined());

    await act(async () => {
      pending['Guáimaro'].resolve({ cost: 6 });
    });
    expect(await screen.findByText('$6.00')).toBeInTheDocument();

    await act(async () => {
      pending['Camagüey'].resolve({ cost: 5 });
    });
    await flushMicrotasks();

    expect(screen.getByText('$6.00')).toBeInTheDocument();
    expect(screen.queryByText('$5.00')).toBeNull();
    expect(continueButton()).not.toBeDisabled();
  });

  it('ignores a stale failure that arrives after the newer destination resolved', async () => {
    await startAt('Camagüey', 'Camagüey');
    await pickRecipient('Camagüey', 'Guáimaro');
    await waitFor(() => expect(pending['Guáimaro']).toBeDefined());

    await act(async () => {
      pending['Guáimaro'].resolve({ cost: 6 });
    });
    expect(await screen.findByText('$6.00')).toBeInTheDocument();

    await act(async () => {
      pending['Camagüey'].reject(new Error('stale boom'));
    });
    await flushMicrotasks();

    expect(screen.queryByText('cart.shippingUnavailable')).toBeNull();
    expect(screen.getByText('$6.00')).toBeInTheDocument();
    expect(continueButton()).not.toBeDisabled();
  });

  it('does not let a stale response un-block a destination that is unavailable', async () => {
    await startAt('Camagüey', 'Camagüey');
    // Artemisa has no available zone: blocked synchronously, no request is made.
    await pickRecipient('Artemisa', 'Artemisa');
    expect(await screen.findByText('cart.shippingUnavailable')).toBeInTheDocument();

    await act(async () => {
      pending['Camagüey'].resolve({ cost: 5 });
    });
    await flushMicrotasks();

    expect(continueButton()).toBeDisabled();
    expect(screen.getByText('cart.shippingUnavailable')).toBeInTheDocument();
    expect(screen.queryByText('$5.00')).toBeNull();
  });
});
