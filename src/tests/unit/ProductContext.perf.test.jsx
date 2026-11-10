import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  getProducts: vi.fn(),
  getProductRows: vi.fn(),
  getProductStock: vi.fn(),
  getCategories: vi.fn(),
  getCombos: vi.fn(),
  getTestimonials: vi.fn(),
  getCarouselSlides: vi.fn()
}));

vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/productService', async (importOriginal) => ({
  ...(await importOriginal()),
  getProducts: (...a) => mocks.getProducts(...a),
  getProductRows: (...a) => mocks.getProductRows(...a),
  getProductStock: (...a) => mocks.getProductStock(...a),
  getCategories: (...a) => mocks.getCategories(...a)
}));
vi.mock('@/lib/comboService', () => ({ getCombos: (...a) => mocks.getCombos(...a) }));
vi.mock('@/lib/testimonialService', () => ({ getTestimonials: (...a) => mocks.getTestimonials(...a) }));
vi.mock('@/lib/carouselService', () => ({ getCarouselSlides: (...a) => mocks.getCarouselSlides(...a) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ userRole: null }) }));

import { ProductProvider, useProducts } from '@/contexts/ProductContext';
import { clearCatalogCache } from '@/lib/catalogCache';

let ctx;
const Probe = () => {
  ctx = useProducts();
  return null;
};
const mount = () =>
  render(
    <ProductProvider>
      <Probe />
    </ProductProvider>
  );

describe('ProductContext performance behaviour', () => {
  beforeEach(() => {
    clearCatalogCache();
    Object.values(mocks).forEach((m) => m.mockReset());
    mocks.getProductRows.mockResolvedValue([{ id: 'p1', name_es: 'P1' }]);
    mocks.getProductStock.mockResolvedValue({ stock: { p1: 5 }, expiry: {} });
    mocks.getProducts.mockResolvedValue([{ id: 'p1', stock: 5 }]);
    mocks.getCategories.mockResolvedValue([]);
    mocks.getTestimonials.mockResolvedValue([]);
    mocks.getCarouselSlides.mockResolvedValue([]);
    mocks.getCombos.mockResolvedValue([
      { id: 'c1', name_es: 'Combo', is_active: true, items: [{ quantity: 2, product: { id: 'p1' } }] }
    ]);
  });

  it('refreshStock re-reads only inventory and recomputes products and combos', async () => {
    mount();
    await waitFor(() => expect(ctx.loading).toBe(false));
    expect(ctx.products[0].stock).toBe(5);
    expect(ctx.combos[0].hasStockIssues).toBe(false);

    mocks.getProductStock.mockResolvedValue({ stock: { p1: 1 }, expiry: {} });
    await act(async () => {
      await ctx.refreshStock();
    });

    expect(ctx.products[0].stock).toBe(1);
    expect(ctx.combos[0].hasStockIssues).toBe(true);
    expect(mocks.getProductRows).toHaveBeenCalledTimes(1);
    expect(mocks.getCombos).toHaveBeenCalledTimes(1);
    expect(mocks.getProducts).not.toHaveBeenCalled();
  });

  it('refreshStock keeps the previous stock when the inventory read fails', async () => {
    mount();
    await waitFor(() => expect(ctx.loading).toBe(false));

    mocks.getProductStock.mockRejectedValue(new Error('down'));
    await act(async () => {
      await ctx.refreshStock();
    });

    expect(ctx.products[0].stock).toBe(5);
  });

  it('refreshCombos does not fetch products again when they are already loaded', async () => {
    mount();
    await waitFor(() => expect(ctx.loading).toBe(false));

    await act(async () => {
      await ctx.refreshCombos(true);
    });

    expect(mocks.getProducts).not.toHaveBeenCalled();
    expect(mocks.getProductRows).toHaveBeenCalledTimes(1);
  });

  it('refreshProducts resolves with the loaded products and refreshCombos accepts that promise', async () => {
    mount();
    await waitFor(() => expect(ctx.loading).toBe(false));
    mocks.getProducts.mockResolvedValue([{ id: 'p1', stock: 0 }]);

    await act(async () => {
      const productsPromise = ctx.refreshProducts(true);
      await ctx.refreshCombos(true, productsPromise);
    });

    expect(ctx.combos[0].hasStockIssues).toBe(true);
    expect(mocks.getProducts).toHaveBeenCalledTimes(1);
  });

  it('a second mount inside the TTL reuses cached rows but still reads stock fresh', async () => {
    const first = mount();
    await waitFor(() => expect(ctx.loading).toBe(false));
    first.unmount();

    mocks.getProductStock.mockResolvedValue({ stock: { p1: 9 }, expiry: {} });
    mount();
    await waitFor(() => expect(ctx.loading).toBe(false));

    expect(mocks.getProductRows).toHaveBeenCalledTimes(1);
    expect(mocks.getCombos).toHaveBeenCalledTimes(1);
    expect(mocks.getProductStock).toHaveBeenCalledTimes(2);
    expect(ctx.products[0].stock).toBe(9);
  });

  it('refreshProducts(true) bypasses and invalidates the public cache', async () => {
    mocks.getProducts.mockResolvedValue([{ id: 'p1', stock: 5, is_active: false }]);
    const first = mount();
    await waitFor(() => expect(ctx.loading).toBe(false));

    await act(async () => {
      await ctx.refreshProducts(true);
    });
    expect(mocks.getProducts).toHaveBeenCalledWith(true);
    first.unmount();

    mount();
    await waitFor(() => expect(ctx.loading).toBe(false));
    expect(mocks.getProductRows).toHaveBeenCalledTimes(2);
  });
});
