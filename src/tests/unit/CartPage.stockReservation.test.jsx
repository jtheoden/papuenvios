import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

// ─── Mutable test state read by the mocks ───────────────────────────────────
const state = {
  clearCart: vi.fn(),
  refreshStock: vi.fn(),
  cart: [],
  zones: [],
  pick: { province: '', municipality: '' },
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
    clearCart: state.clearCart,
    refreshStock: state.refreshStock,
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
import { toast } from '@/components/ui/use-toast';
import { AppError, ERROR_CODES } from '@/lib/errorHandler';
import { buildAdminNewPaymentWhatsAppUrl } from '@/lib/whatsappService';

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

const submitOrder = async () => {
  await reachPaymentStep();
  await attachProof();
  fillPayer();
  typePhone(VALID_PHONE);
  await waitFor(() => expect(confirmButton()).not.toBeDisabled());
  fireEvent.click(confirmButton());
};

describe('CartPage - stock reservation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.clearCart = vi.fn();
    state.refreshStock = vi.fn();
    state.zones = liveZones();
    state.cart = [{
      id: 'p1', name: 'Producto', name_es: 'Producto', base_price: 1, profit_margin: 45,
      final_price: 1.45, base_currency_id: USD, quantity: 2,
    }];
    createOrder.mockResolvedValue({ id: 'o1', order_number: 'ORD-1', payment_status: 'pending' });
    uploadPaymentProof.mockResolvedValue('https://files/proof.png');
  });

  it('sends combos as itemType "combo" even when the cart item has no explicit type (detail-page add)', async () => {
    state.cart = [
      { id: 'c1', name: 'Combo', name_es: 'Combo', base_price: 5, profit_margin: 30, final_price: 6.5,
        base_currency_id: USD, quantity: 1, products: [{ product_id: 'p1', quantity: 2 }] },
      { id: 'p1', name: 'Producto', name_es: 'Producto', base_price: 1, profit_margin: 45,
        final_price: 1.45, base_currency_id: USD, quantity: 2 },
    ];

    await submitOrder();

    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(1));
    const orderItems = createOrder.mock.calls[0][1];
    expect(orderItems.map((i) => [i.itemId, i.itemType])).toEqual([['c1', 'combo'], ['p1', 'product']]);
  });

  it('refreshes the displayed stock once the order has been created', async () => {
    await submitOrder();

    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(state.refreshStock).toHaveBeenCalledTimes(1));
  });

  it('refreshes the displayed stock when the reservation is refused for lack of stock', async () => {
    createOrder.mockRejectedValue(
      new AppError('Stock reservation refused', ERROR_CODES.INSUFFICIENT_STOCK, 409, {
        reason: 'insufficient_stock', productId: 'p1', available: 0,
      })
    );

    await submitOrder();

    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(state.refreshStock).toHaveBeenCalledTimes(1);
  });

  it('shows the out-of-stock message naming the product, keeps the cart and shows no confirmation', async () => {
    createOrder.mockRejectedValue(
      new AppError('Stock reservation refused', ERROR_CODES.INSUFFICIENT_STOCK, 409, {
        reason: 'insufficient_stock', productId: 'p1', available: 1,
      })
    );

    await submitOrder();

    await waitFor(() => expect(toast).toHaveBeenCalled());
    const call = toast.mock.calls[toast.mock.calls.length - 1][0];
    expect(call.variant).toBe('destructive');
    expect(call.description).toContain('cart.stock.insufficientItem');
    expect(state.clearCart).not.toHaveBeenCalled();
    expect(uploadPaymentProof).not.toHaveBeenCalled();
  });

  it('falls back to the generic message when the product is not a cart item (combo component)', async () => {
    createOrder.mockRejectedValue(
      new AppError('Stock reservation refused', ERROR_CODES.INSUFFICIENT_STOCK, 409, {
        reason: 'insufficient_stock', productId: 'component-not-in-cart', available: 0,
      })
    );

    await submitOrder();

    await waitFor(() => expect(toast).toHaveBeenCalled());
    const call = toast.mock.calls[toast.mock.calls.length - 1][0];
    expect(call.description).toBe('cart.stock.insufficient');
  });

  it('shows the open-reservations limit message for too_many_open_reservations', async () => {
    createOrder.mockRejectedValue(
      new AppError('Stock operation refused', ERROR_CODES.INVALID_OPERATION, 409, {
        reason: 'too_many_open_reservations',
      })
    );

    await submitOrder();

    await waitFor(() => expect(toast).toHaveBeenCalled());
    const call = toast.mock.calls[toast.mock.calls.length - 1][0];
    expect(call.variant).toBe('destructive');
    expect(call.description).toBe('cart.stock.tooManyOpen');
    expect(state.clearCart).not.toHaveBeenCalled();
  });
});
