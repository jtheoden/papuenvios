import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (k) => k, language: 'es' })
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'a@b.com' }, isSuperAdmin: false })
}));
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    convertAmountAsync: vi.fn().mockResolvedValue(0),
    getCurrencyById: () => ({ id: 'usd', code: 'USD', symbol: '$' })
  })
}));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/lib/imageUtils', () => ({ validateAndProcessImage: vi.fn() }));
vi.mock('@/lib/imageStorage', () => ({
  isImageUploadError: () => false,
  getImageUploadMessageKey: () => 'images.uploadFailed'
}));
vi.mock('@/lib/productService', () => ({
  createProduct: vi.fn().mockResolvedValue({ id: 'new' }),
  deleteProduct: vi.fn(),
  setProductActiveState: vi.fn(),
  updateProduct: vi.fn().mockResolvedValue({})
}));
vi.mock('@/lib/bulkDeleteService', () => ({
  bulkDeleteProducts: vi.fn(),
  previewBulkDeleteProducts: vi.fn()
}));
vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn() }));
vi.mock('@/components/tables/BulkDeleteBar', () => ({ default: () => null }));
vi.mock('@/components/vendor/ProductTableConfig', () => ({
  getTableColumns: () => [],
  getModalColumns: () => []
}));
vi.mock('@/components/tables/ResponsiveTableWrapper', () => ({
  default: ({ data = [], onRowClick }) => (
    <div>
      {data.map((row) => (
        <button key={row.id} onClick={() => onRowClick(row)}>{`row-${row.id}`}</button>
      ))}
    </div>
  )
}));

import VendorInventoryTab from '@/components/vendor/VendorInventoryTab';
import { createProduct, updateProduct } from '@/lib/productService';

const currencies = [{ id: 'usd', code: 'USD', symbol: '$', is_base: true }];
const categories = [{ id: 'cat-1', name_es: 'Alimentos', name_en: 'Food', profit_margin: 25 }];

const makeProduct = (overrides = {}) => ({
  id: 'p1',
  name_es: 'Arroz',
  name_en: 'Rice',
  base_price: 10,
  base_currency_id: 'usd',
  category_id: 'cat-1',
  category: { id: 'cat-1', name_es: 'Alimentos', name_en: 'Food' },
  profit_margin: 30,
  stock: 5,
  is_active: true,
  ...overrides
});

const renderTab = (products = []) =>
  render(
    <VendorInventoryTab
      products={products}
      categories={categories}
      currencies={currencies}
      visualSettings={{}}
      baseCurrencyId="usd"
      selectedCurrency="usd"
      exchangeRates={[]}
      financialSettings={{ productProfit: 45, comboProfit: 35 }}
      onSelectedCurrencyChange={vi.fn()}
      onProductsRefresh={vi.fn()}
    />
  );

const unitSelect = () => screen.getByTestId('product-unit-select');

describe('VendorInventoryTab unit of measure select', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offers an empty option plus every catalog unit, defaulting to empty on a new product', () => {
    renderTab();
    fireEvent.click(screen.getByText('vendor.actions.addProduct').closest('button'));
    const select = unitSelect();
    expect(select.value).toBe('');
    const values = Array.from(select.options).map((o) => o.value);
    expect(values[0]).toBe('');
    expect(values).toEqual(expect.arrayContaining(['lb', 'kg', 'pack', 'unit']));
  });

  it('preselects the stored unit when editing', () => {
    renderTab([makeProduct({ unit: 'lb' })]);
    fireEvent.click(screen.getByText('row-p1'));
    fireEvent.click(screen.getByText('common.edit').closest('button'));
    expect(unitSelect().value).toBe('lb');
  });

  it('keeps an unknown stored unit selectable so it is not silently wiped on save', () => {
    renderTab([makeProduct({ unit: 'furlong' })]);
    fireEvent.click(screen.getByText('row-p1'));
    fireEvent.click(screen.getByText('common.edit').closest('button'));
    expect(unitSelect().value).toBe('furlong');
  });

  it('sends the chosen unit to updateProduct', async () => {
    renderTab([makeProduct({ unit: null })]);
    fireEvent.click(screen.getByText('row-p1'));
    fireEvent.click(screen.getByText('common.edit').closest('button'));
    fireEvent.change(unitSelect(), { target: { value: 'kg' } });
    fireEvent.click(screen.getByText('vendor.addProduct.save').closest('button'));
    await waitFor(() => expect(updateProduct).toHaveBeenCalled());
    expect(updateProduct.mock.calls[0][1].unit).toBe('kg');
  });

  it('sends null when the empty option is chosen', async () => {
    renderTab([makeProduct({ unit: 'lb' })]);
    fireEvent.click(screen.getByText('row-p1'));
    fireEvent.click(screen.getByText('common.edit').closest('button'));
    fireEvent.change(unitSelect(), { target: { value: '' } });
    fireEvent.click(screen.getByText('vendor.addProduct.save').closest('button'));
    await waitFor(() => expect(updateProduct).toHaveBeenCalled());
    expect(updateProduct.mock.calls[0][1].unit).toBeNull();
    expect(createProduct).not.toHaveBeenCalled();
  });
});
