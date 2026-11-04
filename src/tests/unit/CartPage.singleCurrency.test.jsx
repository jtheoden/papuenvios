import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

// ─── Mutable test state read by the mocks ───────────────────────────────────
const state = {
  cart: [],
  zones: [],
  pick: { province: '', municipality: '' },
  discountPercent: 0,
};

const USD = 'usd-id';
const CUP = 'cup-id';
const RATE = 770; // 1 USD = 770 CUP
const VALID_PHONE = '+13055551234';

let nextId = 1;
const zone = (province, municipality, cost) => ({
  id: nextId++,
  province_name: province,
  municipality_name: municipality,
  shipping_cost: cost,
  free_shipping: false,
  is_active: true,
});

const liveZones = () => [
  zone('Artemisa', null, 0),
  zone('Camagüey', null, 0),
  zone('Camagüey', 'Guáimaro', 6),
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
    selectedCurrency: CUP,
    setSelectedCurrency: vi.fn(),
    currencies: [{ id: USD, code: 'USD', is_base: true }, { id: CUP, code: 'CUP', is_base: false }],
    currencyCode: 'CUP',
    currencySymbol: '₱',
    convertAmount: (amount, from, to) => {
      if (from === to) return amount;
      if (from === CUP && to === USD) return amount / RATE;
      if (from === USD && to === CUP) return amount * RATE;
      return NaN;
    },
  }),
}));

vi.mock('@/contexts/ModalContext', () => ({
  useModal: () => ({ showModal: vi.fn().mockResolvedValue(true) }),
}));

vi.mock('@/hooks/useUserDiscounts', () => ({
  useUserDiscounts: () => ({ categoryInfo: { category: 'regular' }, categoryDiscountPercent: state.discountPercent }),
}));

// ─── Service / helper mocks ──────────────────────────────────────────────────
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/shippingService', () => ({
  getActiveShippingZones: vi.fn(async () => state.zones),
  calculateShippingCost: vi.fn(async (province, _total, municipality) => {
    const rows = state.zones.filter((z) => z.province_name === province);
    const row = rows.find((z) => z.municipality_name === municipality) || rows.find((z) => !z.municipality_name);
    return { cost: parseFloat(row.shipping_cost) };
  }),
}));
vi.mock('@/lib/cubanLocations', () => ({ getMunicipalitiesByProvince: () => [] }));
vi.mock('@/lib/currencyService', () => ({
  convertCurrency: vi.fn(async (amount, from, to) => (from === 'USD' && to === 'CUP' ? amount * RATE : amount)),
}));
vi.mock('@/lib/whatsappService', async (importOriginal) => ({
  ...(await importOriginal()),
  generateWhatsAppURL: vi.fn(),
  buildAdminNewPaymentWhatsAppUrl: vi.fn(() => 'https://wa.me/5355550000?text=x'),
  openWhatsAppChat: vi.fn(),
}));
vi.mock('@/lib/notificationSettingsService', () => ({
  getActiveWhatsappRecipient: vi.fn(() => '+5355550000'),
  getFreshWhatsappRecipient: vi.fn(),
  getGuidedWhatsappPhone: vi.fn(() => '+5355550000'),
  getFreshNotificationSettings: vi.fn(async () => ({})),
}));
vi.mock('@/lib/orderService', () => ({ createOrder: vi.fn(), uploadPaymentProof: vi.fn() }));
vi.mock('@/lib/zelleService', () => ({
  pickAvailableZelleAccount: vi.fn(async () => ({ id: 'z1' })),
  registerZelleTransaction: vi.fn(),
  ZELLE_TRANSACTION_TYPES: { PRODUCT: 'product' },
}));
vi.mock('@/lib/orderDiscountService', () => ({
  validateAndGetOffer: vi.fn(),
  recordOfferUsage: vi.fn(),
}));
vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock('@/lib/imageUtils', () => ({ processImage: vi.fn() }));
vi.mock('@/lib/styleUtils', () => ({
  getHeadingStyle: () => ({}),
  getPrimaryButtonStyle: () => ({}),
  getAlertStyle: () => ({}),
}));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));

// ─── Child component stubs (not under test) ──────────────────────────────────
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
// The upload stub forwards the file input change exactly like the real component does.
vi.mock('@/components/FileUploadWithPreview', () => ({
  default: ({ onChange }) => <input type="file" data-testid="proof-input" onChange={onChange} />,
}));
vi.mock('@/components/ZelleAccountSelector', () => ({
  default: ({ onSelect }) => (
    <button type="button" onClick={() => onSelect({ id: 'z1', email: 'z@test.com' })}>
      pick-zelle
    </button>
  ),
}));
vi.mock('@/components/ZelleAccountAlert', () => ({ default: () => null }));
vi.mock('@/components/CurrencySelector', () => ({ default: () => null }));
vi.mock('@/components/ui/ConfirmationModal', () => ({
  default: ({ isOpen, total, currency }) => (isOpen ? <div data-testid="confirmation-modal">{`${total} ${currency}`}</div> : null),
}));
vi.mock('@/components/shared/ZelleAccountDisplay', () => ({ default: () => null }));

import CartPage from '@/components/CartPage';
import { createOrder, uploadPaymentProof } from '@/lib/orderService';

const confirmButton = () => screen.getByRole('button', { name: 'cart.payment.confirm' });

// Product of 10 USD. Detail page (selected currency CUP) stores the price shown: 7700 CUP.
const detailItem = {
  id: 'p1', name: 'Detalle', final_price: 10, base_currency_id: USD,
  displayed_price: 7700, displayed_currency_id: CUP, displayed_currency_code: 'CUP', quantity: 1,
};
// Same price added from the catalog list: no snapshot, 10 USD.
const catalogItem = { id: 'p2', name: 'Catalogo', final_price: 10, base_currency_id: USD, quantity: 1 };

const reachPaymentStep = async () => {
  state.pick = { province: 'Camagüey', municipality: 'Guáimaro' };
  render(<CartPage onNavigate={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'cart.checkout' }));
  fireEvent.click(await screen.findByRole('button', { name: 'pick-zelle' }));
  fireEvent.click(await screen.findByRole('button', { name: 'pick-recipient' }));
  const next = await screen.findByRole('button', { name: /Continuar al Pago/ });
  await waitFor(() => expect(next).not.toBeDisabled());
  fireEvent.click(next);
  await screen.findByTestId('proof-input');
};

const submitOrder = async () => {
  await reachPaymentStep();
  const file = new File(['x'], 'proof.png', { type: 'image/png' });
  fireEvent.change(screen.getByTestId('proof-input'), { target: { files: [file] } });
  await waitFor(() => expect(screen.queryByText('cart.payment.missingProof')).toBeNull());
  fireEvent.change(screen.getByPlaceholderText('cart.payment.payerPlaceholder'), { target: { value: 'John Payer' } });
  fireEvent.change(screen.getByPlaceholderText('cart.payment.payerPhonePlaceholder'), { target: { value: VALID_PHONE } });
  await waitFor(() => expect(confirmButton()).not.toBeDisabled());
  fireEvent.click(confirmButton());
  await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(1));
  return { orderData: createOrder.mock.calls[0][0], items: createOrder.mock.calls[0][1] };
};

describe('CartPage - one currency unit with a non-base currency selected (1 USD = 770 CUP)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.zones = liveZones();
    state.discountPercent = 0;
    state.cart = [detailItem, catalogItem];
    createOrder.mockResolvedValue({ id: 'o1', order_number: 'ORD-1', payment_status: 'pending' });
    uploadPaymentProof.mockResolvedValue('https://files/proof.png');
  });

  it('shows each line in CUP from its base price (10 USD -> 7700 CUP), never 5.9M', async () => {
    render(<CartPage onNavigate={vi.fn()} />);
    const lineSubtotals = await screen.findAllByText(/^Subtotal:/);
    expect(lineSubtotals).toHaveLength(2);
    lineSubtotals.forEach((line) => expect(line).toHaveTextContent('₱7700.00 CUP'));
    expect(document.body.textContent).not.toContain('5929000');
  });

  it('creates the order in the base currency with USD amounts for every line', async () => {
    const { orderData, items } = await submitOrder();

    expect(items.map((i) => i.unitPrice)).toEqual([10, 10]);
    expect(items.map((i) => i.totalPrice)).toEqual([10, 10]);
    expect(orderData.subtotal).toBe(20);
    expect(orderData.shippingCost).toBe(6);
    expect(orderData.totalAmount).toBe(26);
    expect(orderData.currencyId).toBe(USD);
  });

  it('labels the payment step and the confirmation modal as USD', async () => {
    await submitOrder();

    expect(screen.getAllByText('$20.00 USD').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$26.00 USD').length).toBeGreaterThan(0);
    expect(await screen.findByTestId('confirmation-modal')).toHaveTextContent('26 USD');
  });
});
