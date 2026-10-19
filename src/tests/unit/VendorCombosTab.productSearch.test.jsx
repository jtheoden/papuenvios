import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  createCombo: vi.fn(),
  updateCombo: vi.fn(),
  toast: vi.fn()
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    t: (k, p) => (p && Object.keys(p).length ? `${k}:${Object.values(p).join('/')}` : k),
    language: 'en'
  })
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'a@b.com' } })
}));
vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({ refreshCombos: vi.fn() })
}));
vi.mock('@/components/ui/use-toast', () => ({ toast: (...a) => mocks.toast(...a) }));
vi.mock('@/lib/imageUtils', () => ({ validateAndProcessImage: vi.fn() }));
vi.mock('@/lib/imageStorage', () => ({
  isImageUploadError: () => false,
  getImageUploadMessageKey: () => 'images.uploadFailed'
}));
vi.mock('@/lib/comboService', () => ({
  createCombo: (...a) => mocks.createCombo(...a),
  updateCombo: (...a) => mocks.updateCombo(...a),
  deleteCombo: vi.fn(),
  setComboActiveState: vi.fn()
}));
vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn() }));

import VendorCombosTab from '@/components/vendor/VendorCombosTab';

const currencies = [{ id: 'usd', code: 'USD', symbol: '$', is_base: true }];
const base = { base_price: 5, final_price: 6, base_currency_id: 'usd', is_active: true, stock: 20 };
const products = [
  { ...base, id: 'p1', name_es: 'Azúcar', name_en: 'Sugar', sku: 'SUG-1' },
  { ...base, id: 'p2', name_es: 'Piña', name_en: 'Pineapple', sku: 'PIN-2' },
  { ...base, id: 'p3', name_es: 'Café', name_en: 'Coffee', sku: 'COF-3', stock: 0 },
  { ...base, id: 'p4', name_es: 'Arroz', name_en: 'Rice', sku: 'RIC-4' }
];
const combo = {
  id: 'c1',
  name: 'Breakfast',
  profitMargin: 10,
  baseTotalPrice: 10,
  items: [{ product: { id: 'p1' }, quantity: 2 }],
  products: ['p1'],
  productQuantities: { p1: 2 }
};

const renderTab = (combos = [combo]) =>
  render(
    <VendorCombosTab
      combos={combos}
      products={products}
      currencies={currencies}
      visualSettings={{}}
      financialSettings={{ comboProfit: 10 }}
      exchangeRates={{}}
      selectedCurrency="usd"
      onSelectedCurrencyChange={vi.fn()}
      onCombosRefresh={vi.fn().mockResolvedValue(undefined)}
    />
  );

const openEdit = () => fireEvent.click(screen.getByRole('button', { name: 'vendor.combos.edit' }));
const openNew = () => fireEvent.click(screen.getByText('vendor.combos.new').closest('button'));
const searchBox = () => screen.getByRole('searchbox', { name: 'vendor.combos.searchProducts' });
const type = (value) => fireEvent.change(searchBox(), { target: { value } });
const row = (name) => screen.queryByRole('checkbox', { name });
const chips = () => screen.getByRole('group', { name: 'vendor.combos.selectedProducts' });

describe('VendorCombosTab product search', () => {
  beforeEach(() => {
    mocks.createCombo.mockReset().mockResolvedValue({ id: 'new' });
    mocks.updateCombo.mockReset().mockResolvedValue({});
    mocks.toast.mockReset();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('renders an accessible search input in the edit form', () => {
    renderTab();
    openEdit();
    const input = searchBox();
    expect(input.getAttribute('type')).toBe('search');
    expect(input.getAttribute('inputmode')).toBe('search');
  });

  it('renders the same search input when creating a combo', () => {
    renderTab([]);
    openNew();
    expect(searchBox()).toBeTruthy();
  });

  it('filters the list by name ignoring accents and case', () => {
    renderTab();
    openEdit();
    type('PINA');
    expect(row('Piña')).toBeTruthy();
    expect(row('Azúcar')).toBeNull();
    expect(row('Arroz')).toBeNull();
  });

  it('finds products by name_en and by sku', () => {
    renderTab();
    openEdit();
    type('rice');
    expect(row('Arroz')).toBeTruthy();
    expect(row('Piña')).toBeNull();
    type('cof-3');
    expect(row('Café')).toBeTruthy();
    expect(row('Arroz')).toBeNull();
  });

  it('treats a whitespace-only query as no filter', () => {
    renderTab();
    openEdit();
    type('   ');
    expect(screen.getAllByRole('checkbox', { name: /^(Azúcar|Piña|Café|Arroz)$/ })).toHaveLength(4);
  });

  it('shows an empty state when nothing matches', () => {
    renderTab();
    openEdit();
    type('zzzz');
    expect(screen.getByText('vendor.combos.noProductResults')).toBeTruthy();
    expect(row('Piña')).toBeNull();
  });

  it('shows the result counter', () => {
    renderTab();
    openEdit();
    expect(screen.getByText('vendor.combos.resultsCount:4/4')).toBeTruthy();
    type('pina');
    expect(screen.getByText('vendor.combos.resultsCount:1/4')).toBeTruthy();
  });

  it('clears the query with the clear button', () => {
    renderTab();
    openEdit();
    type('pina');
    fireEvent.click(screen.getByRole('button', { name: 'vendor.combos.clearSearch' }));
    expect(searchBox().value).toBe('');
    expect(row('Azúcar')).toBeTruthy();
  });

  it('keeps selected products visible as chips when the filter hides their row', () => {
    renderTab();
    openEdit();
    type('pina');
    expect(row('Azúcar')).toBeNull();
    const group = chips();
    expect(within(group).getByText(/Azúcar/)).toBeTruthy();
    expect(within(group).getByText(/2/)).toBeTruthy();
  });

  it('does not alter the selection or the saved payload when filtering', async () => {
    renderTab();
    openEdit();
    type('pina');
    type('zzzz');
    type('');
    expect(row('Azúcar').checked).toBe(true);
    fireEvent.click(screen.getByText('vendor.combos.save').closest('button'));
    await waitFor(() => expect(mocks.updateCombo).toHaveBeenCalledTimes(1));
    const [id, data] = mocks.updateCombo.mock.calls[0];
    expect(id).toBe('c1');
    expect(data.productsWithQuantities).toEqual([{ productId: 'p1', quantity: 2 }]);
  });

  it('adds a product found through search and saves both with their quantities', async () => {
    renderTab();
    openEdit();
    type('pina');
    fireEvent.click(row('Piña'));
    type('');
    expect(row('Piña').checked).toBe(true);
    expect(row('Azúcar').checked).toBe(true);
    fireEvent.click(screen.getByText('vendor.combos.save').closest('button'));
    await waitFor(() => expect(mocks.updateCombo).toHaveBeenCalledTimes(1));
    expect(mocks.updateCombo.mock.calls[0][1].productsWithQuantities).toEqual([
      { productId: 'p1', quantity: 2 },
      { productId: 'p2', quantity: 1 }
    ]);
  });

  it('removes a product from the combo through its chip', async () => {
    renderTab();
    openEdit();
    fireEvent.click(screen.getByRole('button', { name: 'vendor.combos.removeProduct:Azúcar' }));
    expect(row('Azúcar').checked).toBe(false);
    expect(screen.queryByRole('group', { name: 'vendor.combos.selectedProducts' })).toBeNull();
  });

  it('"selected only" lists just the selected rows and combines with the query', () => {
    renderTab();
    openEdit();
    fireEvent.click(screen.getByRole('checkbox', { name: 'vendor.combos.onlySelected' }));
    expect(row('Azúcar')).toBeTruthy();
    expect(row('Piña')).toBeNull();
    type('pina');
    expect(row('Azúcar')).toBeNull();
    expect(screen.getByText('vendor.combos.noProductResults')).toBeTruthy();
  });

  it('keeps out-of-stock products disabled', () => {
    renderTab();
    openEdit();
    expect(row('Café').disabled).toBe(true);
  });

  it('resets the search state when the editor is closed and reopened', () => {
    renderTab();
    openEdit();
    type('pina');
    fireEvent.click(screen.getByRole('checkbox', { name: 'vendor.combos.onlySelected' }));
    fireEvent.click(screen.getByText('common.cancel').closest('button'));
    openEdit();
    expect(searchBox().value).toBe('');
    expect(screen.getByRole('checkbox', { name: 'vendor.combos.onlySelected' }).checked).toBe(false);
    expect(row('Piña')).toBeTruthy();
  });
});
