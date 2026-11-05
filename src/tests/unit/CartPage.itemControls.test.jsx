import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// RB-04: cart line controls need an accessible name and the line layout must not force the grid wider than the viewport.

const USD = 'usd-id';
const state = { cart: [] };
const updateCartQuantity = vi.fn();
const removeFromCart = vi.fn();

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key, params) => (params?.name ? `${key}|${params.name}` : key), language: 'es' }),
}));
vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({
    cart: state.cart,
    updateCartQuantity,
    removeFromCart,
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
    loading: false,
    currencyCode: 'USD',
    currencySymbol: '$',
    convertAmount: (amount) => amount,
  }),
}));
vi.mock('@/contexts/ModalContext', () => ({ useModal: () => ({ showModal: vi.fn() }) }));
vi.mock('@/hooks/useUserDiscounts', () => ({
  useUserDiscounts: () => ({ categoryInfo: { category: 'regular' }, categoryDiscountPercent: 0 }),
}));

vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/shippingService', () => ({
  getActiveShippingZones: vi.fn(async () => []),
  calculateShippingCost: vi.fn(async () => ({ cost: 0 })),
}));
vi.mock('@/lib/cubanLocations', () => ({ getMunicipalitiesByProvince: () => [] }));
vi.mock('@/lib/currencyService', () => ({ convertCurrency: vi.fn(async (amount) => amount) }));
vi.mock('@/lib/whatsappService', async (importOriginal) => ({
  ...(await importOriginal()),
  generateWhatsAppURL: vi.fn(),
  buildAdminNewPaymentWhatsAppUrl: vi.fn(),
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
vi.mock('@/lib/orderDiscountService', () => ({ validateAndGetOffer: vi.fn(), recordOfferUsage: vi.fn() }));
vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock('@/lib/imageUtils', () => ({ processImage: vi.fn() }));
vi.mock('@/lib/styleUtils', () => ({
  getHeadingStyle: () => ({}),
  getPrimaryButtonStyle: () => ({}),
  getAlertStyle: () => ({}),
}));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/components/RecipientSelector', () => ({ default: () => null }));
vi.mock('@/components/FileUploadWithPreview', () => ({ default: () => null }));
vi.mock('@/components/ZelleAccountSelector', () => ({ default: () => null }));
vi.mock('@/components/ZelleAccountAlert', () => ({ default: () => null }));
vi.mock('@/components/CurrencySelector', () => ({ default: () => null }));
vi.mock('@/components/ui/ConfirmationModal', () => ({ default: () => null }));
vi.mock('@/components/shared/ZelleAccountDisplay', () => ({ default: () => null }));

import CartPage from '@/components/CartPage';

const item = (id, name, quantity) => ({ id, name, name_es: name, final_price: 10, base_currency_id: USD, quantity });

describe('CartPage line controls (RB-04)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.cart = [item('p1', 'Aceite', 2), item('p2', 'Arroz', 1)];
  });

  it('names the quantity and remove buttons of every line after the product', async () => {
    render(<CartPage onNavigate={vi.fn()} />);

    for (const name of ['Aceite', 'Arroz']) {
      expect(await screen.findByRole('button', { name: `cart.item.decrease|${name}` })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: `cart.item.increase|${name}` })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: `cart.item.remove|${name}` })).toBeInTheDocument();
    }
  });

  it('keeps the controls wired to the cart actions', async () => {
    render(<CartPage onNavigate={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'cart.item.increase|Aceite' }));
    expect(updateCartQuantity).toHaveBeenLastCalledWith('p1', 3);
    fireEvent.click(screen.getByRole('button', { name: 'cart.item.decrease|Aceite' }));
    expect(updateCartQuantity).toHaveBeenLastCalledWith('p1', 1);
    fireEvent.click(screen.getByRole('button', { name: 'cart.item.remove|Arroz' }));
    expect(removeFromCart).toHaveBeenCalledWith('p2');
  });

  it('forces a single shrinkable grid track so a wide line cannot push the summary off screen', async () => {
    render(<CartPage onNavigate={vi.fn()} />);

    const remove = await screen.findByRole('button', { name: 'cart.item.remove|Aceite' });
    const grid = remove.closest('.grid');
    expect(grid).not.toBeNull();
    expect(grid.className).toContain('grid-cols-1');
    // the controls live in their own group, so the row can stack below sm
    const controls = remove.parentElement;
    expect(within(controls).getAllByRole('button')).toHaveLength(3);
  });
});

describe('cart item control translations', () => {
  const load = (file) => JSON.parse(readFileSync(resolve(__dirname, `../../translations/${file}.json`), 'utf8'));
  const es = load('ES');
  const en = load('EN');

  it.each(['decrease', 'increase', 'remove'])('has %s in both languages with the {name} placeholder', (key) => {
    expect(es.cart.item[key]).toContain('{name}');
    expect(en.cart.item[key]).toContain('{name}');
  });
});
