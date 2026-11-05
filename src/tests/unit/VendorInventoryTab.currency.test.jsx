import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ toast: vi.fn(), convertAmountAsync: vi.fn() }));

const currencyList = [
  { id: 'usd', code: 'USD', symbol: '$', is_base: true },
  { id: 'cup', code: 'CUP', symbol: '₱', is_base: false }
];

// Saved prices are converted with the live rate (currencyService), not the display cache
const liveRate = vi.hoisted(() => vi.fn(async () => 1));
vi.mock('@/lib/currencyService', () => ({ getLiveConversionRate: (...args) => liveRate(...args) }));
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (k) => k, language: 'en' })
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'a@b.com' }, isSuperAdmin: false })
}));
vi.mock('@/contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    convertAmountAsync: (...a) => mocks.convertAmountAsync(...a),
    getCurrencyById: (id) => currencyList.find((c) => c.id === id)
  })
}));
vi.mock('@/components/ui/use-toast', () => ({ toast: (...a) => mocks.toast(...a) }));
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
// Real ProductTableConfig columns, rendered cell by cell by a minimal table stand-in
vi.mock('@/components/tables/ResponsiveTableWrapper', () => ({
  default: ({ data = [], columns = [], onRowClick }) => (
    <div>
      {data.map((row) => (
        <div key={row.id}>
          <button onClick={() => onRowClick(row)}>{`row-${row.id}`}</button>
          {columns.map((col) => (
            <div key={col.key} data-testid={`cell-${row.id}-${col.key}`}>
              {col.render ? col.render(row[col.key], row) : row[col.key]}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}));

import VendorInventoryTab from '@/components/vendor/VendorInventoryTab';
import { updateProduct } from '@/lib/productService';

const categories = [{ id: 'cat-1', name_es: 'Alimentos', name_en: 'Food', profit_margin: 25 }];

const makeProduct = (overrides = {}) => ({
  id: 'p1',
  name_es: 'Arroz',
  name_en: 'Rice',
  base_price: 10,
  final_price: 13,
  base_currency_id: 'usd',
  category_id: 'cat-1',
  category: { id: 'cat-1', name_es: 'Alimentos', name_en: 'Food' },
  profit_margin: 30,
  stock: 5,
  is_active: true,
  ...overrides
});

const tab = (products, { selectedCurrency = 'cup', exchangeRates = { 'usd-cup': 900 } } = {}) => (
  <VendorInventoryTab
    products={products}
    categories={categories}
    currencies={currencyList}
    visualSettings={{}}
    baseCurrencyId="usd"
    selectedCurrency={selectedCurrency}
    exchangeRates={exchangeRates}
    financialSettings={{ productProfit: 45, comboProfit: 35 }}
    onSelectedCurrencyChange={vi.fn()}
    onProductsRefresh={vi.fn()}
  />
);

const priceInput = () => screen.getByTestId('product-base-price-input');
const openDetails = () => fireEvent.click(screen.getByText('row-p1'));
const pressEdit = () => fireEvent.click(screen.getByText('common.edit').closest('button'));

describe('VendorInventoryTab currency handling (RB-20)', () => {
  beforeEach(() => {
    mocks.toast.mockClear();
    mocks.convertAmountAsync.mockReset();
    mocks.convertAmountAsync.mockResolvedValue(9000); // a positive converted price
    liveRate.mockReset().mockResolvedValue(1);
    updateProduct.mockClear();
  });

  describe('A: edit seeds from the original record, not the display-converted row', () => {
    it('opens the form with the stored price and currency while the view currency is CUP', () => {
      render(tab([makeProduct()]));

      openDetails();
      pressEdit();

      expect(priceInput().value).toBe('10');
      expect(screen.getByDisplayValue('USD (Base)')).toBeTruthy();
    });

    it('still seeds the original values when products refresh between opening details and pressing Edit', () => {
      const { rerender } = render(tab([makeProduct()]));

      openDetails();
      rerender(tab([makeProduct({ name_es: 'Arroz refrescado' })]));
      pressEdit();

      expect(priceInput().value).toBe('10');
      expect(screen.getByDisplayValue('USD (Base)')).toBeTruthy();
      expect(screen.getByDisplayValue('Arroz refrescado')).toBeTruthy();
    });
  });

  describe('B: no rate means no number under a foreign symbol', () => {
    it('shows an em dash in the table and the details modal instead of an unconverted price', () => {
      render(tab([makeProduct()], { exchangeRates: {} }));

      expect(screen.getByTestId('cell-p1-final_price').textContent).toBe('—');

      openDetails();
      expect(screen.queryByText(/₱\s?(10|13)\.00/)).toBeNull();
      expect(screen.getAllByText('—').length).toBeGreaterThan(1);
    });

    it('keeps the base_price fallback when final_price is null and no conversion is needed', () => {
      render(tab([makeProduct({ final_price: null })], { selectedCurrency: 'usd' }));

      expect(screen.getByTestId('cell-p1-final_price').textContent).toBe('$10.00');
    });

    it('does not flag a row whose original price is missing (previous behavior)', () => {
      render(tab([makeProduct({ base_price: undefined })], { exchangeRates: {} }));

      expect(screen.getByTestId('cell-p1-final_price').textContent).toBe('—');
      render(tab([makeProduct({ id: 'p2', base_price: undefined })], { selectedCurrency: 'usd' }));
      expect(screen.getByTestId('cell-p2-final_price').textContent).toBe('$13.00');
    });

    it('still converts when an inverse rate exists', () => {
      render(tab([makeProduct()], { exchangeRates: { 'cup-usd': 0.01 } }));

      // 13 USD / 0.01 = 1300 CUP
      expect(screen.getByTestId('cell-p1-final_price').textContent).toBe('₱1300.00');
    });
  });

  describe('edit target disappears', () => {
    it('shows a destructive toast instead of closing the modal silently', async () => {
      const { rerender } = render(tab([makeProduct()]));

      openDetails();
      rerender(tab([]));

      await waitFor(() =>
        expect(mocks.toast).toHaveBeenCalledWith(
          expect.objectContaining({ variant: 'destructive', description: 'vendor.inventory.productNotFound' })
        )
      );
    });
  });

  describe('form conversion preview', () => {
    it('warns inline when the preview conversion fails', async () => {
      render(tab([makeProduct()], { selectedCurrency: 'usd' }));
      openDetails();
      pressEdit();
      fireEvent.change(screen.getByDisplayValue('USD (Base)'), { target: { value: 'cup' } });
      await waitFor(() => expect(screen.getByDisplayValue('CUP')).toBeTruthy());
      liveRate.mockRejectedValue(new Error('no rate')); // the preview reads the live rate, like the save

      const note = await screen.findByText('vendor.inventory.previewUnavailable', {}, { timeout: 2000 });
      expect(note.getAttribute('role')).toBe('status');
    });
  });

  describe('C: a failed conversion to base never saves', () => {
    // The currency switch itself converts the loaded price; the save-time conversion is what fails/succeeds
    const editWithForeignCurrency = async () => {
      render(tab([makeProduct()], { selectedCurrency: 'usd' }));
      openDetails();
      pressEdit();
      fireEvent.change(screen.getByDisplayValue('USD (Base)'), { target: { value: 'cup' } });
      await waitFor(() => expect(screen.getByDisplayValue('CUP')).toBeTruthy());
    };

    it('does not call updateProduct, shows a destructive toast and keeps the form open', async () => {
      await editWithForeignCurrency();
      liveRate.mockRejectedValue(new Error('no rate'));

      fireEvent.click(screen.getByText('vendor.addProduct.save').closest('button'));

      await waitFor(() =>
        expect(mocks.toast).toHaveBeenCalledWith(
          expect.objectContaining({ variant: 'destructive', title: 'common.error', description: 'vendor.inventory.conversionToBaseFailed' })
        )
      );
      expect(updateProduct).not.toHaveBeenCalled();
      expect(priceInput()).toBeTruthy();
    });

    it('happy path is unchanged: converts to base and stores the base currency', async () => {
      mocks.convertAmountAsync.mockResolvedValue(0.01);
      await editWithForeignCurrency();

      fireEvent.click(screen.getByText('vendor.addProduct.save').closest('button'));

      await waitFor(() => expect(updateProduct).toHaveBeenCalled());
      expect(updateProduct.mock.calls[0][1]).toMatchObject({ basePrice: 0.01, base_currency_id: 'usd' });
    });

    it('the saved base price uses the rate read live (cup -> usd), never the cached display rate', async () => {
      mocks.convertAmountAsync.mockResolvedValue(9000); // display conversion when switching the form to CUP
      liveRate.mockResolvedValue(1 / 900);
      await editWithForeignCurrency();

      fireEvent.click(screen.getByText('vendor.addProduct.save').closest('button'));

      await waitFor(() => expect(updateProduct).toHaveBeenCalled());
      expect(liveRate).toHaveBeenCalledWith('cup', 'usd');
      expect(updateProduct.mock.calls[0][1].basePrice).toBeCloseTo(10);
    });
  });
});
