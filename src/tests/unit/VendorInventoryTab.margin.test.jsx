import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (k) => k, language: 'en' })
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
  createProduct: vi.fn(),
  deleteProduct: vi.fn(),
  setProductActiveState: vi.fn(),
  updateProduct: vi.fn()
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
import { updateProduct } from '@/lib/productService';

const currencies = [{ id: 'usd', code: 'USD', symbol: '$', is_base: true }];

const categories = [
  { id: 'cat-25', name_es: 'Alimentos', name_en: 'Food', profit_margin: 25 },
  { id: 'cat-60', name_es: 'Ropa', name_en: 'Clothes', profit_margin: 60 },
  { id: 'cat-none', name_es: 'Otros', name_en: 'Other', profit_margin: null }
];

const GLOBAL = 45;

const makeProduct = (overrides = {}) => ({
  id: 'p1',
  name_es: 'Arroz',
  name_en: 'Rice',
  base_price: 10,
  base_currency_id: 'usd',
  category_id: 'cat-25',
  category: { id: 'cat-25', name_es: 'Alimentos', name_en: 'Food' },
  profit_margin: 30,
  final_price: 13,
  stock: 5,
  is_active: true,
  ...overrides
});

const renderTab = (products = [], financialSettings = { productProfit: GLOBAL, comboProfit: 35 }) =>
  render(
    <VendorInventoryTab
      products={products}
      categories={categories}
      currencies={currencies}
      visualSettings={{}}
      baseCurrencyId="usd"
      selectedCurrency="usd"
      exchangeRates={[]}
      financialSettings={financialSettings}
      onSelectedCurrencyChange={vi.fn()}
      onProductsRefresh={vi.fn()}
    />
  );

const marginInput = () => screen.getByTestId('product-profit-margin-input');
const sourceLabel = () => screen.getByTestId('product-margin-source');
const categorySelect = () =>
  screen.getAllByRole('combobox').find((s) => within(s).queryByText('Food'));
const chooseCategory = (id) => fireEvent.change(categorySelect(), { target: { value: id } });

const openNewForm = () => {
  renderTab();
  fireEvent.click(screen.getByText('vendor.actions.addProduct').closest('button'));
};

const openEditForm = (product) => {
  renderTab([product]);
  fireEvent.click(screen.getByText(`row-${product.id}`));
  fireEvent.click(screen.getByText('common.edit').closest('button'));
};

describe('VendorInventoryTab margin precedence (product > category > global)', () => {
  describe('new product', () => {
    it('starts with the global margin and labels its source as global', () => {
      openNewForm();
      expect(marginInput().value).toBe(String(GLOBAL));
      expect(sourceLabel().dataset.source).toBe('global');
    });

    it('pre-fills the category margin when the category has one', () => {
      openNewForm();
      chooseCategory('cat-25');
      expect(marginInput().value).toBe('25');
      expect(sourceLabel().dataset.source).toBe('category');
    });

    it('falls back to the global margin when the category has no margin', () => {
      openNewForm();
      chooseCategory('cat-25');
      chooseCategory('cat-none');
      expect(marginInput().value).toBe(String(GLOBAL));
      expect(sourceLabel().dataset.source).toBe('global');
    });

    it('re-suggests the margin when the category changes and the admin has not edited it', () => {
      openNewForm();
      chooseCategory('cat-25');
      chooseCategory('cat-60');
      expect(marginInput().value).toBe('60');
      expect(sourceLabel().dataset.source).toBe('category');
    });

    it('keeps the admin override (marginTouched) when the category changes afterwards', () => {
      openNewForm();
      chooseCategory('cat-25');
      fireEvent.change(marginInput(), { target: { value: '50' } });
      chooseCategory('cat-60');
      expect(marginInput().value).toBe('50');
      expect(sourceLabel().dataset.source).toBe('product');
    });

    it('treats a manual edit before choosing any category as an override too', () => {
      openNewForm();
      fireEvent.change(marginInput(), { target: { value: '12' } });
      chooseCategory('cat-60');
      expect(marginInput().value).toBe('12');
    });
  });

  describe('editing an existing product', () => {
    it('keeps the product own margin over the category margin', () => {
      openEditForm(makeProduct({ profit_margin: 30, category_id: 'cat-25' }));
      expect(marginInput().value).toBe('30');
      expect(sourceLabel().dataset.source).toBe('product');
    });

    it('does not re-suggest the margin when the category changes on a product with its own margin', () => {
      openEditForm(makeProduct({ profit_margin: 30 }));
      chooseCategory('cat-60');
      expect(marginInput().value).toBe('30');
    });

    it('honors an own margin of 0 instead of treating it as missing', () => {
      openEditForm(makeProduct({ profit_margin: 0 }));
      expect(marginInput().value).toBe('0');
      expect(sourceLabel().dataset.source).toBe('product');
    });

    it('documents products with profit_margin NULL: falls back to the category margin', () => {
      openEditForm(makeProduct({ profit_margin: null, category_id: 'cat-25' }));
      expect(marginInput().value).toBe('25');
      expect(sourceLabel().dataset.source).toBe('category');
    });

    it('documents products with profit_margin NULL and no category margin: falls back to global', () => {
      openEditForm(makeProduct({
        profit_margin: null,
        category_id: 'cat-none',
        category: { id: 'cat-none', name_es: 'Otros', name_en: 'Other' }
      }));
      expect(marginInput().value).toBe(String(GLOBAL));
      expect(sourceLabel().dataset.source).toBe('global');
    });

    it('recomputes the sell price preview from the suggested margin', () => {
      openEditForm(makeProduct({ profit_margin: null, category_id: 'cat-25', base_price: 10 }));
      fireEvent.click(screen.getAllByText(/vendor.addProduct.profitBySellPrice/)[0].closest('button'));
      expect(screen.getByDisplayValue('12.50')).toBeTruthy();
    });
  });
});

describe('VendorInventoryTab zero margin', () => {
  it('submits a 0% margin as 0 instead of the 40% default', async () => {
    updateProduct.mockClear();
    updateProduct.mockResolvedValue({ id: 'p1' });
    openEditForm(makeProduct({ profit_margin: 0 }));
    fireEvent.click(screen.getByText('vendor.addProduct.save').closest('button'));
    await waitFor(() => expect(updateProduct).toHaveBeenCalled());
    expect(updateProduct.mock.calls[0][1].profitMargin).toBe(0);
  });

  it('uses a configured global default of 0 to pre-fill a new product', () => {
    renderTab([], { productProfit: 0, comboProfit: 35 });
    fireEvent.click(screen.getByText('vendor.actions.addProduct').closest('button'));
    expect(marginInput().value).toBe('0');
  });
});
