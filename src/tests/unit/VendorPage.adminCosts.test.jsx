import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({ adminCatalogError: null }));

vi.mock('@/lib/supabase', () => {
  const chain = {};
  ['select', 'eq', 'order'].forEach((m) => { chain[m] = () => chain; });
  chain.then = (resolve) => resolve({ data: [], error: null });
  return { supabase: { from: () => chain } };
});
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (key) => key, language: 'en' }) }));
vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({
    products: [], refreshProducts: vi.fn(), financialSettings: {}, categories: [], refreshCategories: vi.fn(),
    combos: [], refreshCombos: vi.fn(), testimonials: [], refreshTestimonials: vi.fn(), visualSettings: {},
    adminCatalogError: state.adminCatalogError
  })
}));
vi.mock('@/lib/styleUtils', () => ({ getHeadingStyle: () => ({}), getPrimaryButtonStyle: () => ({}) }));
vi.mock('@/lib/adminCatalogLoader', () => ({ loadAdminCatalog: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/components/TabsResponsive', () => ({ default: () => <div data-testid="tabs" /> }));
vi.mock('@/components/vendor/VendorCategoriesTab', () => ({ default: () => null }));
vi.mock('@/components/vendor/VendorCombosTab', () => ({ default: () => null }));
vi.mock('@/components/vendor/VendorManagementTab', () => ({ default: () => null }));
vi.mock('@/components/vendor/VendorInventoryTab', () => ({ default: () => null }));

import VendorPage from '@/components/VendorPage';

describe('VendorPage', () => {
  it('shows the admin cost-data alert above the tabs when the admin catalog failed to load', () => {
    state.adminCatalogError = { kind: 'adminCosts' };
    render(<VendorPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('products.catalogError.adminCosts');
    expect(screen.getByTestId('tabs')).toBeTruthy();
  });

  it('shows no alert when everything loaded', () => {
    state.adminCatalogError = null;
    render(<VendorPage />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
