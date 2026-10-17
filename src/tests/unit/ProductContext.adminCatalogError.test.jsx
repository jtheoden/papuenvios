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
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ userRole: 'admin' }) }));

import { ProductProvider, useProducts } from '@/contexts/ProductContext';
import { clearCatalogCache } from '@/lib/catalogCache';
import { AppError } from '@/lib/errorHandler';
import { ADMIN_COST_RPC_UNAVAILABLE } from '@/lib/adminCostService';

let ctx;
const Probe = () => {
  ctx = useProducts();
  return null;
};
const mount = () => render(<ProductProvider><Probe /></ProductProvider>);
const rpcMissing = () => new AppError('missing', ADMIN_COST_RPC_UNAVAILABLE, 503);

describe('ProductContext: admin cost reads fail visibly (adminCatalogError), never as an empty screen', () => {
  beforeEach(() => {
    clearCatalogCache();
    Object.values(mocks).forEach((m) => m.mockReset());
    mocks.getProductRows.mockResolvedValue([{ id: 'p1', name_es: 'P1', final_price: 5 }]);
    mocks.getProducts.mockResolvedValue([{ id: 'p1', name_es: 'P1', final_price: 5, base_price: 4 }]);
    mocks.getProductStock.mockResolvedValue({ stock: {}, expiry: {} });
    mocks.getCategories.mockResolvedValue([]);
    mocks.getTestimonials.mockResolvedValue([]);
    mocks.getCarouselSlides.mockResolvedValue([]);
    mocks.getCombos.mockResolvedValue([]);
  });

  it('starts without an admin error', async () => {
    mount();
    await waitFor(() => expect(ctx.loading).toBe(false));
    expect(ctx.adminCatalogError).toBeNull();
  });

  it('refreshProducts(true) failing because the RPC is missing sets kind "adminCosts" (public catalogError untouched)', async () => {
    mount();
    await waitFor(() => expect(ctx.loading).toBe(false));
    mocks.getProducts.mockRejectedValue(rpcMissing());
    await act(async () => { await ctx.refreshProducts(true); });
    expect(ctx.adminCatalogError).toEqual({ kind: 'adminCosts' });
    expect(ctx.catalogError).toBeNull();
  });

  it('refreshCombos(true) failing sets the admin error', async () => {
    mount();
    await waitFor(() => expect(ctx.loading).toBe(false));
    mocks.getCombos.mockRejectedValue(rpcMissing());
    await act(async () => { await ctx.refreshCombos(true); });
    expect(ctx.adminCatalogError).toEqual({ kind: 'adminCosts' });
  });

  it('the admin categories (margins) failing sets the admin error and not the public one', async () => {
    mocks.getCategories.mockImplementation(async (opts) => {
      if (opts?.includeMargin) throw rpcMissing();
      return [];
    });
    mount();
    await waitFor(() => expect(ctx.loading).toBe(false));
    await waitFor(() => expect(ctx.adminCatalogError).toEqual({ kind: 'adminCosts' }));
    expect(ctx.catalogError).toBeNull();
  });

  it('a later successful admin refresh clears the error', async () => {
    mount();
    await waitFor(() => expect(ctx.loading).toBe(false));
    mocks.getProducts.mockRejectedValueOnce(rpcMissing());
    await act(async () => { await ctx.refreshProducts(true); });
    expect(ctx.adminCatalogError).not.toBeNull();
    await act(async () => { await ctx.refreshProducts(true); });
    expect(ctx.adminCatalogError).toBeNull();
  });
});
