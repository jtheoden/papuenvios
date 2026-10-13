import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const state = { role: null };

const getCategories = vi.fn(async () => []);

vi.mock('@/lib/productService', () => ({
  getProducts: vi.fn(async () => []),
  getCategories: (...args) => getCategories(...args)
}));
vi.mock('@/lib/comboService', () => ({ getCombos: vi.fn(async () => []) }));
vi.mock('@/lib/testimonialService', () => ({ getTestimonials: vi.fn(async () => []) }));
vi.mock('@/lib/carouselService', () => ({ getCarouselSlides: vi.fn(async () => []) }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ userRole: state.role })
}));

import { ProductProvider } from '@/contexts/ProductContext';

const renderProvider = () =>
  render(
    <ProductProvider>
      <span>child</span>
    </ProductProvider>
  );

const lastCallOptions = () => getCategories.mock.calls.at(-1)?.[0];

describe('ProductProvider category margin visibility', () => {
  beforeEach(() => {
    getCategories.mockClear();
    state.role = null;
  });

  it('loads categories without the margin for visitors', async () => {
    renderProvider();
    await waitFor(() => expect(getCategories).toHaveBeenCalled());
    expect(lastCallOptions()?.includeMargin).toBeFalsy();
  });

  it('loads categories without the margin for regular users', async () => {
    state.role = 'user';
    renderProvider();
    await waitFor(() => expect(getCategories).toHaveBeenCalled());
    expect(lastCallOptions()?.includeMargin).toBeFalsy();
  });

  it('reloads with the margin when the role resolves to admin after the first load', async () => {
    const view = renderProvider();
    await waitFor(() => expect(getCategories).toHaveBeenCalled());
    expect(lastCallOptions()?.includeMargin).toBeFalsy();

    state.role = 'admin';
    view.rerender(
      <ProductProvider>
        <span>child</span>
      </ProductProvider>
    );

    await waitFor(() => expect(lastCallOptions()).toEqual({ includeMargin: true }));
  });

  it('reloads without the margin when the admin signs out', async () => {
    state.role = 'admin';
    const view = renderProvider();
    await waitFor(() => expect(lastCallOptions()).toEqual({ includeMargin: true }));

    state.role = null;
    view.rerender(
      <ProductProvider>
        <span>child</span>
      </ProductProvider>
    );

    await waitFor(() => expect(lastCallOptions()?.includeMargin).toBeFalsy());
  });

  it.each(['admin', 'super_admin'])('loads categories with the margin for %s', async (role) => {
    state.role = role;
    renderProvider();
    await waitFor(() => expect(getCategories).toHaveBeenCalled());
    expect(lastCallOptions()).toEqual({ includeMargin: true });
  });
});
