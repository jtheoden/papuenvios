import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ toast: vi.fn(), refreshCombos: vi.fn() }));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (k) => k, language: 'en' })
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'a@b.com' }, isSuperAdmin: false })
}));
vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({ refreshCombos: mocks.refreshCombos })
}));
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    convertAmountAsync: vi.fn().mockResolvedValue(0),
    getCurrencyById: () => ({ id: 'usd', code: 'USD', symbol: '$' })
  })
}));
vi.mock('@/components/ui/use-toast', () => ({ toast: (...a) => mocks.toast(...a) }));
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
vi.mock('@/lib/comboService', () => ({
  createCombo: vi.fn(),
  updateCombo: vi.fn(),
  deleteCombo: vi.fn(),
  setComboActiveState: vi.fn()
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
import VendorCombosTab from '@/components/vendor/VendorCombosTab';

const currencies = [{ id: 'usd', code: 'USD', symbol: '$', is_base: true }];
const categories = [{ id: 'cat-25', name_es: 'Alimentos', name_en: 'Food', profit_margin: 25 }];

const renderInventory = (product, onProductsRefresh = vi.fn()) => {
  render(
    <VendorInventoryTab
      products={[product]}
      categories={categories}
      currencies={currencies}
      visualSettings={{}}
      baseCurrencyId="usd"
      selectedCurrency="usd"
      exchangeRates={[]}
      financialSettings={{ productProfit: 45, comboProfit: 35 }}
      onSelectedCurrencyChange={vi.fn()}
      onProductsRefresh={onProductsRefresh}
    />
  );
  return onProductsRefresh;
};

describe('admin edit forms refuse rows that came from the public catalog', () => {
  beforeEach(() => {
    mocks.toast.mockClear();
    mocks.refreshCombos.mockClear();
  });

  it('product: a row without cost fields does not open the edit form, it reloads the admin data', () => {
    const publicRow = { id: 'p1', name_es: 'Arroz', name_en: 'Rice', final_price: 13, category_id: 'cat-25', stock: 5, is_active: true };
    const onProductsRefresh = renderInventory(publicRow);

    fireEvent.click(screen.getByText('row-p1'));
    fireEvent.click(screen.getByText('common.edit').closest('button'));

    expect(screen.queryByTestId('product-profit-margin-input')).toBeNull();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'vendor.adminDataPending' }));
    expect(onProductsRefresh).toHaveBeenCalledWith(true);
  });

  it('product: a full admin row still opens the edit form', () => {
    const adminRow = { id: 'p1', name_es: 'Arroz', name_en: 'Rice', base_price: 10, profit_margin: 30, final_price: 13, category_id: 'cat-25', base_currency_id: 'usd', stock: 5, is_active: true };
    renderInventory(adminRow);

    fireEvent.click(screen.getByText('row-p1'));
    fireEvent.click(screen.getByText('common.edit').closest('button'));

    expect(screen.getByTestId('product-profit-margin-input').value).toBe('30');
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('combo: a row without cost fields does not open the edit form, it reloads the admin data', () => {
    const publicCombo = { id: 'c1', name: 'Combo Uno', finalPrice: 66, is_active: true, items: [], products: [], productQuantities: {} };
    const onCombosRefresh = vi.fn();
    const { container } = render(
      <VendorCombosTab
        combos={[publicCombo]}
        products={[]}
        currencies={currencies}
        visualSettings={{}}
        financialSettings={{ productProfit: 45, comboProfit: 35 }}
        exchangeRates={[]}
        selectedCurrency="usd"
        onSelectedCurrencyChange={vi.fn()}
        onCombosRefresh={onCombosRefresh}
      />
    );

    // First icon button of the row actions is "edit"
    fireEvent.click(container.querySelector('button.h-8.w-8'));

    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'vendor.adminDataPending' }));
    expect(mocks.refreshCombos).toHaveBeenCalledWith(true);
  });
});
