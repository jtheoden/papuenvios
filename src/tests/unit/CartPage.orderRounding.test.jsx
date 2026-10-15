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
vi.mock('@/lib/currencyService', () => ({ convertCurrency: vi.fn(async (amount) => amount) }));
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
vi.mock('@/components/ui/ConfirmationModal', () => ({ default: () => null }));
vi.mock('@/components/shared/ZelleAccountDisplay', () => ({ default: () => null }));

import CartPage from '@/components/CartPage';
import { createOrder, uploadPaymentProof } from '@/lib/orderService';
import { validateAndGetOffer } from '@/lib/orderDiscountService';

const confirmButton = () => screen.getByRole('button', { name: 'cart.payment.confirm' });

const reachPaymentStep = async () => {
  state.pick = { province: 'Camagüey', municipality: 'Guáimaro' };
  render(<CartPage onNavigate={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'cart.checkout' }));
  fireEvent.click(await screen.findByRole('button', { name: 'pick-zelle' }));
  fireEvent.click(await screen.findByRole('button', { name: 'pick-recipient' }));
  await screen.findByText('$6.00');
  const next = screen.getByRole('button', { name: /Continuar al Pago/ });
  await waitFor(() => expect(next).not.toBeDisabled());
  fireEvent.click(next);
  await screen.findByTestId('proof-input');
};

const attachProof = async () => {
  const file = new File(['x'], 'proof.png', { type: 'image/png' });
  fireEvent.change(screen.getByTestId('proof-input'), { target: { files: [file] } });
  // The proof is stored asynchronously (FileReader); the hint disappears once it is set
  await waitFor(() => expect(screen.queryByText('cart.payment.missingProof')).toBeNull());
};

const fillPayer = () => {
  fireEvent.change(screen.getByPlaceholderText('cart.payment.payerPlaceholder'), {
    target: { value: 'John Payer' },
  });
};

const typePhone = (value) => {
  fireEvent.change(screen.getByPlaceholderText('cart.payment.payerPhonePlaceholder'), {
    target: { value },
  });
};

const cents = (n) => Math.round(n * 100);

const submitOrder = async () => {
  await reachPaymentStep();
  await attachProof();
  fillPayer();
  typePhone(VALID_PHONE);
  await waitFor(() => expect(confirmButton()).not.toBeDisabled());
  fireEvent.click(confirmButton());
  await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(1));
  return { orderData: createOrder.mock.calls[0][0], items: createOrder.mock.calls[0][1] };
};

describe('CartPage - order amounts are cent-exact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.zones = liveZones();
    state.discountPercent = 0;
    createOrder.mockResolvedValue({ id: 'o1', order_number: 'ORD-1', payment_status: 'pending' });
    uploadPaymentProof.mockResolvedValue('https://files/proof.png');
    state.cart = [
      // Legacy combo: 30.9 * 1.45 = 44.805 -> 44.81 (the catalog price)
      { id: 'c1', name: 'Combo', products: [{}], baseTotalPrice: 30.9, profitMargin: 45, quantity: 2 },
      // Legacy product: 0.3899 * 1.4 = 0.54586 -> 0.55, high quantity
      { id: 'p1', name: 'Producto', base_price: 0.3899, quantity: 27 },
    ];
  });

  it('sends rounded unitPrice/totalPrice and totals that add up exactly', async () => {
    const { orderData, items } = await submitOrder();

    expect(items.map((i) => i.unitPrice)).toEqual([44.81, 0.55]);
    expect(items.map((i) => i.totalPrice)).toEqual([89.62, 14.85]);

    const sumOfLines = items.reduce((acc, i) => acc + cents(i.totalPrice), 0);
    expect(cents(orderData.subtotal)).toBe(sumOfLines);
    expect(orderData.subtotal).toBe(104.47);
    expect(orderData.shippingCost).toBe(6);
    expect(cents(orderData.totalAmount))
      .toBe(cents(orderData.subtotal) - cents(orderData.discountAmount) + cents(orderData.shippingCost));
    items.forEach((i) => expect(cents(i.totalPrice)).toBe(cents(i.unitPrice) * i.quantity));
  });

  it('applies a fixed offer with half-cent rounding and keeps the invariants', async () => {
    validateAndGetOffer.mockResolvedValue({
      valid: true,
      offer: { id: 'off1', code: 'SAVE', discount_type: 'fixed_amount', discount_value: 1.005 },
    });
    await reachPaymentStep();
    fireEvent.change(screen.getByPlaceholderText('cart.payment.enterCouponCode'), { target: { value: 'save' } });
    fireEvent.click(screen.getByRole('button', { name: 'cart.payment.apply' }));
    await screen.findByText('cart.payment.couponApplied', { exact: false });
    await attachProof();
    fillPayer();
    typePhone(VALID_PHONE);
    await waitFor(() => expect(confirmButton()).not.toBeDisabled());
    fireEvent.click(confirmButton());
    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(1));
    const [orderData, items] = createOrder.mock.calls[0];

    expect(orderData.discountAmount).toBe(1.01);
    expect(orderData.totalAmount).toBe(109.46);
    expect(orderData.offerId).toBe('off1');
    expect(cents(orderData.subtotal)).toBe(items.reduce((acc, i) => acc + cents(i.totalPrice), 0));
    expect(cents(orderData.totalAmount))
      .toBe(cents(orderData.subtotal) - cents(orderData.discountAmount) + cents(orderData.shippingCost));
  });

  it('keeps the invariants with a category discount', async () => {
    state.discountPercent = 7;
    const { orderData, items } = await submitOrder();

    expect(orderData.discountAmount).toBe(7.31);
    expect(orderData.totalAmount).toBe(103.16);
    expect(cents(orderData.subtotal)).toBe(items.reduce((acc, i) => acc + cents(i.totalPrice), 0));
    expect(cents(orderData.totalAmount))
      .toBe(cents(orderData.subtotal) - cents(orderData.discountAmount) + cents(orderData.shippingCost));
  });
});

describe('CartPage - fails closed on invalid cart lines', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.zones = liveZones();
    state.discountPercent = 0;
    createOrder.mockResolvedValue({ id: 'o1', order_number: 'ORD-1', payment_status: 'pending' });
  });

  const renderCart = () => render(<CartPage onNavigate={vi.fn()} />);

  it('blocks checkout when a line has a non-numeric price, instead of pricing it at 0', async () => {
    state.cart = [
      { id: 'a', name: 'A', displayed_price: 10, displayed_currency_id: USD, quantity: 1 },
      { id: 'b', name: 'B', displayed_price: 'x', displayed_currency_id: USD, quantity: 1 },
    ];
    renderCart();

    expect(await screen.findByText('cart.invalidItems')).toBeInTheDocument();
    const checkout = screen.getByRole('button', { name: 'cart.checkout' });
    expect(checkout).toBeDisabled();
    fireEvent.click(checkout);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('blocks checkout when a line has an invalid quantity', async () => {
    state.cart = [
      { id: 'a', name: 'A', displayed_price: 10, displayed_currency_id: USD, quantity: 1 },
      { id: 'b', name: 'B', displayed_price: 5, displayed_currency_id: USD, quantity: 'abc' },
    ];
    renderCart();

    expect(await screen.findByText('cart.invalidItems')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'cart.checkout' })).toBeDisabled();
  });

  it('does not show the warning nor block a valid cart', async () => {
    state.cart = [{ id: 'a', name: 'A', displayed_price: 10, displayed_currency_id: USD, quantity: 1 }];
    renderCart();

    const checkout = await screen.findByRole('button', { name: 'cart.checkout' });
    expect(checkout).not.toBeDisabled();
    expect(screen.queryByText('cart.invalidItems')).toBeNull();
  });
});

