import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

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
import { parseSupabaseError } from '@/lib/errorHandler';

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

const permissionDenied = () => parseSupabaseError({ code: '42501', message: 'permission denied for table products' });

describe('ProductContext surfaces public catalog load failures instead of an empty screen', () => {
  beforeEach(() => {
    clearCatalogCache();
    Object.values(mocks).forEach((m) => m.mockReset());
    mocks.getProductRows.mockResolvedValue([{ id: 'p1', name_es: 'P1', final_price: 5 }]);
    mocks.getProductStock.mockResolvedValue({ stock: { p1: 5 }, expiry: {} });
    mocks.getCategories.mockResolvedValue([]);
    mocks.getTestimonials.mockResolvedValue([]);
    mocks.getCarouselSlides.mockResolvedValue([]);
    mocks.getCombos.mockResolvedValue([]);
  });

  it('has no catalog error when everything loads', async () => {
    mount();
    await waitFor(() => expect(ctx.loading).toBe(false));
    expect(ctx.catalogError).toBeNull();
  });

  it('reports a "permission" error when the products query is denied (42501)', async () => {
    mocks.getProductRows.mockRejectedValue(permissionDenied());
    mount();
    await waitFor(() => expect(ctx.loading).toBe(false));
    expect(ctx.products).toEqual([]);
    expect(ctx.catalogError).toEqual({ kind: 'permission' });
  });

  it('reports a "permission" error when the combos query is denied (42501)', async () => {
    mocks.getCombos.mockRejectedValue(permissionDenied());
    mount();
    await waitFor(() => expect(ctx.loading).toBe(false));
    expect(ctx.catalogError).toEqual({ kind: 'permission' });
  });

  it('reports a "load" error for any other products failure', async () => {
    mocks.getProductRows.mockRejectedValue(new Error('network down'));
    mount();
    await waitFor(() => expect(ctx.loading).toBe(false));
    expect(ctx.catalogError).toEqual({ kind: 'load' });
  });

  it('keeps the permission kind when both products and combos fail', async () => {
    mocks.getProductRows.mockRejectedValue(new Error('network down'));
    mocks.getCombos.mockRejectedValue(permissionDenied());
    mount();
    await waitFor(() => expect(ctx.loading).toBe(false));
    expect(ctx.catalogError).toEqual({ kind: 'permission' });
  });

  it('exposes the combo final price in the UI shape', async () => {
    mocks.getCombos.mockResolvedValue([
      { id: 'c1', name_es: 'Combo', is_active: true, final_price: '66.50', items: [{ quantity: 1, product: { id: 'p1' } }] }
    ]);
    mount();
    await waitFor(() => expect(ctx.loading).toBe(false));
    expect(ctx.combos[0].finalPrice).toBe('66.50');
  });
});
