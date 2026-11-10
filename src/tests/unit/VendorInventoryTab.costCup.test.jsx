import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ toast: vi.fn(), convertAmountAsync: vi.fn() }));

const currencyList = [
  { id: 'usd', code: 'USD', symbol: '$', is_base: true },
  { id: 'cup', code: 'CUP', symbol: '₱', is_base: false },
  { id: 'eur', code: 'EUR', symbol: '€', is_base: false }
];

// Saved prices use the live rate of the USD->CUP pair (900 CUP per USD), never the cached display rate
const liveRate = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
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

const categories = [{ id: 'cat-1', name_es: 'Alimentos', name_en: 'Food', profit_margin: 25 }];

const makeProduct = (overrides = {}) => ({
  id: 'p1',
  name_es: 'Arroz',
  name_en: 'Rice',
  base_price: 3.28,
  final_price: 4.26,
  base_currency_id: 'usd',
  category_id: 'cat-1',
  category: { id: 'cat-1', name_es: 'Alimentos', name_en: 'Food' },
  profit_margin: 30,
  stock: 5,
  is_active: true,
  cost_cup: null, // the key's presence is the signal that the migration is applied
  ...overrides
});

const tab = (products) => (
  <VendorInventoryTab
    products={products}
    categories={categories}
    currencies={currencyList}
    visualSettings={{}}
    baseCurrencyId="usd"
    selectedCurrency="usd"
    exchangeRates={{}}
    financialSettings={{ productProfit: 45, comboProfit: 35 }}
    onSelectedCurrencyChange={vi.fn()}
    onProductsRefresh={vi.fn()}
  />
);

const priceInput = () => screen.getByTestId('product-base-price-input');
const currencySelect = () => screen.getByLabelText('vendor.inventory.priceCurrencyLabel');
const openEdit = () => {
  fireEvent.click(screen.getByText('row-p1'));
  fireEvent.click(screen.getByText('common.edit').closest('button'));
};
const save = () => fireEvent.click(screen.getByText('vendor.addProduct.save').closest('button'));
const type = (value) => fireEvent.change(priceInput(), { target: { value } });

describe('VendorInventoryTab cost in CUP', () => {
  beforeEach(() => {
    mocks.toast.mockClear();
    mocks.convertAmountAsync.mockReset().mockResolvedValue(2952);
    liveRate.mockReset().mockImplementation(async (from, to) => {
      if (from === 'usd' && to === 'cup') return 900;
      if (from === 'eur' && to === 'usd') return 1 / 0.9;
      throw new Error('unexpected pair ' + from + '->' + to);
    });
    updateProduct.mockClear();
    createProduct.mockClear();
  });

  it('typing the cost in CUP saves cost_cup and base_price = round(cost / USD->CUP rate, 2)', async () => {
    render(tab([makeProduct()]));
    openEdit();
    fireEvent.change(currencySelect(), { target: { value: 'cup' } });
    await waitFor(() => expect(currencySelect().value).toBe('cup'));
    type('2950');
    save();

    await waitFor(() => expect(updateProduct).toHaveBeenCalled());
    expect(updateProduct.mock.calls[0][1]).toMatchObject({ costCup: 2950, basePrice: 3.28, base_currency_id: 'usd' });
    expect(liveRate).toHaveBeenCalledWith('usd', 'cup');
    expect(liveRate).not.toHaveBeenCalledWith('cup', 'usd');
  });

  it('a new product typed in CUP also saves cost_cup', async () => {
    render(tab([makeProduct({ id: 'probe' })]));
    fireEvent.click(screen.getByText('vendor.actions.addProduct').closest('button'));
    fireEvent.change(screen.getAllByPlaceholderText('vendor.addProduct.namePlaceholder')[0], { target: { value: 'Frijol' } });
    fireEvent.change(screen.getByDisplayValue('Select category'), { target: { value: 'cat-1' } });
    fireEvent.change(currencySelect(), { target: { value: 'cup' } });
    type('2950');
    save();

    await waitFor(() => expect(createProduct).toHaveBeenCalled());
    expect(createProduct.mock.calls[0][0]).toMatchObject({ costCup: 2950, basePrice: 3.28 });
  });

  it('fails closed when the live rate is unavailable: nothing is saved', async () => {
    render(tab([makeProduct()]));
    openEdit();
    fireEvent.change(currencySelect(), { target: { value: 'cup' } });
    await waitFor(() => expect(currencySelect().value).toBe('cup'));
    type('2950');
    liveRate.mockRejectedValue(new Error('no rate'));
    save();

    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'destructive', description: 'vendor.inventory.conversionToBaseFailed' })
      )
    );
    expect(updateProduct).not.toHaveBeenCalled();
  });

  it('a new product typed in USD sends no cost_cup at all (undefined)', async () => {
    render(tab([makeProduct({ id: 'probe' })]));
    fireEvent.click(screen.getByText('vendor.actions.addProduct').closest('button'));
    fireEvent.change(screen.getAllByPlaceholderText('vendor.addProduct.namePlaceholder')[0], { target: { value: 'Frijol' } });
    fireEvent.change(screen.getByDisplayValue('Select category'), { target: { value: 'cat-1' } });
    type('3.5');
    save();

    await waitFor(() => expect(createProduct).toHaveBeenCalled());
    expect(createProduct.mock.calls[0][0].costCup).toBeUndefined();
  });

  it('a new product typed in another currency (EUR) sends no cost_cup either', async () => {
    render(tab([makeProduct({ id: 'probe' })]));
    fireEvent.click(screen.getByText('vendor.actions.addProduct').closest('button'));
    fireEvent.change(screen.getAllByPlaceholderText('vendor.addProduct.namePlaceholder')[0], { target: { value: 'Frijol' } });
    fireEvent.change(screen.getByDisplayValue('Select category'), { target: { value: 'cat-1' } });
    fireEvent.change(currencySelect(), { target: { value: 'eur' } });
    type('3');
    save();

    await waitFor(() => expect(createProduct).toHaveBeenCalled());
    expect(createProduct.mock.calls[0][0].costCup).toBeUndefined();
  });

  it('editing in USD a product that has no cost_cup does not send cost_cup', async () => {
    render(tab([makeProduct()]));
    openEdit();
    type('4');
    save();

    await waitFor(() => expect(updateProduct).toHaveBeenCalled());
    expect(updateProduct.mock.calls[0][1].costCup).toBeUndefined();
  });

  it('editing in USD a product that had cost_cup clears it (null)', async () => {
    render(tab([makeProduct({ cost_cup: 2950 })]));
    openEdit();
    fireEvent.change(currencySelect(), { target: { value: 'usd' } });
    await waitFor(() => expect(currencySelect().value).toBe('usd'));
    type('4');
    save();

    await waitFor(() => expect(updateProduct).toHaveBeenCalled());
    expect(updateProduct.mock.calls[0][1].costCup).toBeNull();
    expect(updateProduct.mock.calls[0][1]).toMatchObject({ basePrice: 4, base_currency_id: 'usd' });
  });

  it('editing a product with cost_cup shows the CUP cost with CUP selected, not the derived USD', () => {
    render(tab([makeProduct({ cost_cup: 2950 })]));
    openEdit();

    expect(priceInput().value).toBe('2950');
    expect(currencySelect().value).toBe('cup');
    expect(screen.getByText(/vendor.inventory.costCupLabel/)).toBeTruthy();
  });

  it('editing a product without cost_cup shows the USD price as before', () => {
    render(tab([makeProduct()]));
    openEdit();

    expect(priceInput().value).toBe('3.28');
    expect(currencySelect().value).toBe('usd');
  });

  it('the preview shows the resulting USD price from the live rate when typing in CUP', async () => {
    render(tab([makeProduct()]));
    openEdit();
    fireEvent.change(currencySelect(), { target: { value: 'cup' } });
    await waitFor(() => expect(currencySelect().value).toBe('cup'));
    type('2950');

    await waitFor(() => expect(screen.getByText(/≈ \$3\.28 USD/)).toBeTruthy(), { timeout: 2000 });
  });

  describe('compat mode (migration not applied yet)', () => {
    it('a CUP-typed save converts like before and sends no cost_cup', async () => {
      liveRate.mockImplementation(async (from, to) => {
        if (from === 'cup' && to === 'usd') return 1 / 900;
        throw new Error('unexpected pair ' + from + '->' + to);
      });
      const legacy = makeProduct();
      delete legacy.cost_cup;
      render(tab([legacy]));
      openEdit();
      fireEvent.change(currencySelect(), { target: { value: 'cup' } });
      await waitFor(() => expect(currencySelect().value).toBe('cup'));
      type('2950');
      save();

      await waitFor(() => expect(updateProduct).toHaveBeenCalled());
      const payload = updateProduct.mock.calls[0][1];
      expect(payload.costCup).toBeUndefined();
      expect(payload.basePrice).toBeCloseTo(3.2778, 3);
    });

    it('a create with no probe row sends no cost_cup', async () => {
      liveRate.mockImplementation(async () => 1 / 900);
      render(tab([]));
      fireEvent.click(screen.getByText('vendor.actions.addProduct').closest('button'));
      fireEvent.change(screen.getAllByPlaceholderText('vendor.addProduct.namePlaceholder')[0], { target: { value: 'Frijol' } });
      fireEvent.change(screen.getByDisplayValue('Select category'), { target: { value: 'cat-1' } });
      fireEvent.change(currencySelect(), { target: { value: 'cup' } });
      type('2950');
      save();

      await waitFor(() => expect(createProduct).toHaveBeenCalled());
      expect(createProduct.mock.calls[0][0].costCup).toBeUndefined();
    });
  });

  describe('editing other fields does not reprice', () => {
    it('changing only the name sends neither base_price nor cost_cup (CUP-costed product)', async () => {
      render(tab([makeProduct({ cost_cup: 2950 })]));
      openEdit();
      fireEvent.change(screen.getByDisplayValue('Arroz'), { target: { value: 'Arroz largo' } });
      save();

      await waitFor(() => expect(updateProduct).toHaveBeenCalled());
      const payload = updateProduct.mock.calls[0][1];
      expect(payload.basePrice).toBeUndefined();
      expect(payload.base_currency_id).toBeUndefined();
      expect(payload.costCup).toBeUndefined();
      expect(payload.name_es).toBe('Arroz largo');
    });

    it('changing only the name sends no price for a USD-costed product either', async () => {
      render(tab([makeProduct()]));
      openEdit();
      fireEvent.change(screen.getByDisplayValue('Arroz'), { target: { value: 'Arroz largo' } });
      save();

      await waitFor(() => expect(updateProduct).toHaveBeenCalled());
      expect(updateProduct.mock.calls[0][1].basePrice).toBeUndefined();
      expect(updateProduct.mock.calls[0][1].costCup).toBeUndefined();
    });

    it('a half-cent retype that rounds to the same cost is no change: nothing repriced', async () => {
      render(tab([makeProduct({ cost_cup: 2950 })]));
      openEdit();
      type('2950.004');
      save();

      await waitFor(() => expect(updateProduct).toHaveBeenCalled());
      const payload = updateProduct.mock.calls[0][1];
      expect(payload.basePrice).toBeUndefined();
      expect(payload.costCup).toBeUndefined();
    });

    it('a real change (2950 -> 3000) sends both cost_cup and base_price', async () => {
      render(tab([makeProduct({ cost_cup: 2950 })]));
      openEdit();
      type('3000');
      save();

      await waitFor(() => expect(updateProduct).toHaveBeenCalled());
      expect(updateProduct.mock.calls[0][1]).toMatchObject({ costCup: 3000, basePrice: 3.33 });
    });

    it('changing the CUP cost sends both cost_cup and base_price', async () => {
      render(tab([makeProduct({ cost_cup: 2950 })]));
      openEdit();
      type('3600');
      save();

      await waitFor(() => expect(updateProduct).toHaveBeenCalled());
      expect(updateProduct.mock.calls[0][1]).toMatchObject({ costCup: 3600, basePrice: 4, base_currency_id: 'usd' });
    });
  });

  describe('zero price guard', () => {
    it('blocks saving when the resulting USD price is below 0.01', async () => {
      render(tab([makeProduct()]));
      openEdit();
      fireEvent.change(currencySelect(), { target: { value: 'cup' } });
      await waitFor(() => expect(currencySelect().value).toBe('cup'));
      type('4'); // 4 / 900 = 0.004 -> 0.00
      save();

      await waitFor(() =>
        expect(mocks.toast).toHaveBeenCalledWith(
          expect.objectContaining({ variant: 'destructive', description: 'vendor.inventory.costTooLow' })
        )
      );
      expect(updateProduct).not.toHaveBeenCalled();
    });
  });
});
