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

const never = () => new Promise(() => {});

describe('ProductContext catalog loading flag', () => {
  beforeEach(() => {
    clearCatalogCache();
    Object.values(mocks).forEach((m) => m.mockReset());
    mocks.getProductRows.mockResolvedValue([{ id: 'p1', name_es: 'P1', final_price: 5 }]);
    mocks.getProductStock.mockResolvedValue({ stock: { p1: 5 }, expiry: {} });
    mocks.getCombos.mockResolvedValue([]);
  });

  it('ends when products and combos are in, without waiting for categories, testimonials or the carousel', async () => {
    mocks.getCategories.mockImplementation(never);
    mocks.getTestimonials.mockImplementation(never);
    mocks.getCarouselSlides.mockImplementation(never);
    mount();
    await waitFor(() => expect(ctx.loading).toBe(false));
    expect(ctx.products).toHaveLength(1);
  });
});
