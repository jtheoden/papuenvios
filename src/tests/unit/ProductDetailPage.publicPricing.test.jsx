import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const USD = 'usd-id';

const state = { products: [], combos: [], isAdmin: false, addToCart: vi.fn() };

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'en' })
}));
vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({
    products: state.products,
    combos: state.combos,
    categories: [],
    addToCart: state.addToCart,
    visualSettings: {},
    catalogError: null
  })
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ isAdmin: state.isAdmin }) }));
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    selectedCurrency: USD,
    setSelectedCurrency: vi.fn(),
    currencySymbol: '$',
    currencyCode: 'USD',
    currencies: [{ id: USD, is_base: true }],
    convertAmount: (amount) => amount,
    loading: false
  })
}));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/components/CurrencySelector', () => ({ CurrencySelector: () => null, default: () => null }));

import ProductDetailPage from '@/components/ProductDetailPage';

const product = (overrides = {}) => ({
  id: 'p1', name_es: 'Arroz', name_en: 'Rice', final_price: 4.5, base_currency_id: USD, ...overrides
});
const combo = (overrides = {}) => ({
  id: 'c1', name: 'Combo Uno', products: ['p1'], productQuantities: { p1: 2 }, finalPrice: 8, ...overrides
});

describe('ProductDetailPage prices from stored values only', () => {
  beforeEach(() => {
    state.products = [product()];
    state.combos = [combo()];
    state.isAdmin = false;
    state.addToCart = vi.fn();
  });

  it('adds a combo to the cart with the stored final price as the displayed snapshot', () => {
    render(<ProductDetailPage onNavigate={vi.fn()} itemId="c1" itemType="combo" />);
    fireEvent.click(screen.getByRole('button', { name: 'products.addToCart' }));
    expect(state.addToCart).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'combo', displayed_price: 8, displayed_currency_id: USD })
    );
  });

  it('compares against the components priced from their stored final_price', () => {
    render(<ProductDetailPage onNavigate={vi.fn()} itemId="c1" itemType="combo" />);
    // components: 4.50 x 2 = 9.00 against the combo at 8.00 -> saves 1.00
    expect(screen.getAllByText(/\$9\.00/).length).toBeGreaterThan(0);
    expect(screen.getByText(/\$1\.00!/)).toBeInTheDocument();
  });

  it('shows unavailable and blocks the cart for a combo stored with final price 0', () => {
    state.combos = [combo({ finalPrice: '0.00' })];
    render(<ProductDetailPage onNavigate={vi.fn()} itemId="c1" itemType="combo" />);
    const button = screen.getByRole('button', { name: 'products.priceUnavailable' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(state.addToCart).not.toHaveBeenCalled();
    expect(screen.queryByText(/\$0\.00/)).toBeNull();
  });

  it('hides the savings comparison when a component has no stored price', () => {
    state.products = [product({ final_price: undefined, base_price: 3 })];
    render(<ProductDetailPage onNavigate={vi.fn()} itemId="c1" itemType="combo" />);
    expect(screen.queryByText('products.detail.saveWithCombo')).toBeNull();
    expect(screen.queryByText(/products\.detail\.youSave/)).toBeNull();
  });

  it('does not expose the combo margin even to an admin viewing the public rows', () => {
    state.isAdmin = true;
    state.combos = [combo({ profitMargin: 45 })];
    render(<ProductDetailPage onNavigate={vi.fn()} itemId="c1" itemType="combo" />);
    expect(screen.queryByText(/45%/)).toBeNull();
  });

  it('shows the product price from final_price and unavailable when it is missing', () => {
    const { unmount } = render(<ProductDetailPage onNavigate={vi.fn()} itemId="p1" itemType="product" />);
    expect(screen.getAllByText(/4\.50/).length).toBeGreaterThan(0);
    unmount();

    state.products = [product({ final_price: undefined, base_price: 3 })];
    render(<ProductDetailPage onNavigate={vi.fn()} itemId="p1" itemType="product" />);
    expect(screen.getAllByText('products.priceUnavailable').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'products.priceUnavailable' })).toBeDisabled();
  });
});
