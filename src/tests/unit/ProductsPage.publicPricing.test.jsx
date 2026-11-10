import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

const USD = 'usd-id';
const CUP = 'cup-id';

const state = { products: [], combos: [], catalogError: null, addToCart: vi.fn() };

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'en' })
}));
vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({
    products: state.products,
    combos: state.combos,
    categories: [],
    addToCart: state.addToCart,
    refreshProducts: vi.fn(),
    visualSettings: {},
    catalogError: state.catalogError
  })
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, isAdmin: false }) }));
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    selectedCurrency: USD,
    setSelectedCurrency: vi.fn(),
    currencySymbol: '$',
    currencyCode: 'USD',
    convertAmount: (amount, from, to) => (from === to ? amount : amount * 2),
    currencyMap: new Map([[USD, { id: USD, is_base: true }], [CUP, { id: CUP }]])
  })
}));
vi.mock('@/hooks/useUserDiscounts', () => ({
  useUserDiscounts: () => ({ categoryInfo: { category: 'regular' }, categoryDiscountPercent: 0 })
}));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/components/CurrencySelector', () => ({ default: () => null }));
vi.mock('@/components/PriceDisplay', () => ({ default: () => null }));
vi.mock('@/lib/storage', () => ({ uploadProductImage: vi.fn(), deleteProductImage: vi.fn() }));
vi.mock('@/lib/productService', () => ({ setProductImageUrl: vi.fn() }));
vi.mock('@/lib/imageUtils', () => ({ validateAndProcessImage: vi.fn() }));

import ProductsPage from '@/components/ProductsPage';

const product = (overrides = {}) => ({
  id: 'p1', name_es: 'Arroz', name_en: 'Rice', final_price: 4.5, base_currency_id: USD, stock: 10, ...overrides
});
const combo = (overrides = {}) => ({
  id: 'c1', name: 'Combo Uno', products: ['p1'], productQuantities: { p1: 2 }, finalPrice: 8, is_active: true, ...overrides
});

const cardOf = (name) => screen.getByText(name).closest('div.glass-effect');

describe('ProductsPage shows the stored price and never a computed or zero one', () => {
  beforeEach(() => {
    state.products = [product()];
    state.combos = [];
    state.catalogError = null;
    state.addToCart = vi.fn();
  });

  it('shows the product final_price and allows adding it to the cart', () => {
    render(<ProductsPage onNavigate={vi.fn()} />);
    const card = cardOf('Rice');
    expect(within(card).getByText(/\$4\.50/)).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: 'products.addToCart' }));
    expect(state.addToCart).toHaveBeenCalledTimes(1);
  });

  it('shows "price unavailable" and blocks the cart when final_price is missing, ignoring base_price', () => {
    state.products = [product({ final_price: undefined, base_price: 3, profit_margin: 40 })];
    render(<ProductsPage onNavigate={vi.fn()} />);
    const card = cardOf('Rice');
    expect(within(card).getAllByText('products.priceUnavailable').length).toBeGreaterThan(0);
    expect(within(card).queryByText(/\$\d/)).toBeNull();
    expect(within(card).getByRole('button', { name: 'products.priceUnavailable' })).toBeDisabled();
  });

  it('prices a combo from its stored finalPrice, not from the components', () => {
    state.combos = [combo({ finalPrice: 8 })];
    render(<ProductsPage onNavigate={vi.fn()} />);
    const card = cardOf('Combo Uno');
    expect(within(card).getByText(/\$8\.00/)).toBeInTheDocument();
  });

  it('treats a combo stored with final_price 0.00 as unavailable and blocks the cart', () => {
    state.combos = [combo({ finalPrice: '0.00' })];
    render(<ProductsPage onNavigate={vi.fn()} />);
    const card = cardOf('Combo Uno');
    expect(within(card).getAllByText('products.priceUnavailable').length).toBeGreaterThan(0);
    expect(within(card).getByRole('button', { name: 'products.priceUnavailable' })).toBeDisabled();
    expect(state.addToCart).not.toHaveBeenCalled();
  });

  it('shows the catalog error alert when the context reports a failed load', () => {
    state.products = [];
    state.catalogError = { kind: 'permission' };
    render(<ProductsPage onNavigate={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('products.catalogError.permission');
  });
});
