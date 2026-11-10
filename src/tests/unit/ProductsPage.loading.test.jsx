import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

const USD = 'usd-id';
const state = { products: [], combos: [], catalogError: null, loading: false };

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'en' })
}));
vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({
    products: state.products,
    combos: state.combos,
    categories: [],
    addToCart: vi.fn(),
    refreshProducts: vi.fn(),
    visualSettings: {},
    catalogError: state.catalogError,
    loading: state.loading
  })
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, isAdmin: false }) }));
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    selectedCurrency: USD,
    setSelectedCurrency: vi.fn(),
    currencySymbol: '$',
    currencyCode: 'USD',
    convertAmount: (amount) => amount,
    currencyMap: new Map([[USD, { id: USD, is_base: true }]])
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

const product = (i) => ({ id: `p${i}`, name_es: `Producto ${i}`, name_en: `Product ${i}`, final_price: 4, base_currency_id: USD, stock: 5 });
const combo = { id: 'c1', name: 'Combo Uno', products: ['p1'], productQuantities: { p1: 1 }, finalPrice: 8, is_active: true };
const advance = (ms) => act(() => { vi.advanceTimersByTime(ms); });

describe('ProductsPage loading state', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    state.products = [];
    state.combos = [];
    state.catalogError = null;
    state.loading = false;
  });
  afterEach(() => { vi.useRealTimers(); });

  it('shows a busy skeleton with the loading label, never the empty state, while the catalog loads', () => {
    state.loading = true;
    render(<ProductsPage onNavigate={vi.fn()} />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status.querySelectorAll('[data-skeleton]').length).toBeGreaterThan(0);
    expect(screen.queryByText('products.noProducts')).not.toBeInTheDocument();

    advance(300);
    expect(screen.getByText('common.loading')).toBeInTheDocument();
    expect(screen.queryByText('products.noProducts')).not.toBeInTheDocument();
  });

  it('never flashes the empty state on the render where the data arrives', () => {
    state.loading = true;
    const { rerender } = render(<ProductsPage onNavigate={vi.fn()} />);
    state.products = [product(1)];
    state.combos = [combo];
    state.loading = false;
    rerender(<ProductsPage onNavigate={vi.fn()} />);
    expect(screen.queryByText('products.noProducts')).not.toBeInTheDocument();
    expect(screen.getByText('Product 1')).toBeInTheDocument();
    expect(screen.getByText('Combo Uno')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows the real empty state only after loading ends with no items', () => {
    render(<ProductsPage onNavigate={vi.fn()} />);
    expect(screen.getByText('products.noProducts')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('drops the skeleton and shows the error state when the catalog fails', () => {
    state.loading = true;
    state.catalogError = { kind: 'load' };
    render(<ProductsPage onNavigate={vi.fn()} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('staggers the entrance of at most 6 cards, only under motion-safe', () => {
    state.products = Array.from({ length: 8 }, (_, i) => product(i + 1));
    render(<ProductsPage onNavigate={vi.fn()} />);
    const cards = state.products.map(p => screen.getByText(p.name_en).closest('div.glass-effect'));
    cards.slice(0, 6).forEach((card, i) => {
      expect(card.className).toContain('motion-safe:animate-enter');
      expect(card.style.getPropertyValue('--stagger-index')).toBe(String(i));
    });
    cards.slice(6).forEach(card => expect(card.className).not.toContain('animate-enter'));
    cards.forEach(card => expect(card).toHaveClass('hover-lift'));
  });
});
