import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ toast: vi.fn(), convertAmountAsync: vi.fn() }));

const currencyList = [
  { id: 'usd', code: 'USD', symbol: '$', is_base: true },
  { id: 'cup', code: 'CUP', symbol: '₱', is_base: false },
  { id: 'eur', code: 'EUR', symbol: '€', is_base: false }
];

vi.mock('@/contexts/LanguageContext', () => ({
  // Params are appended so tests can assert the interpolated values
  useLanguage: () => ({ t: (k, p) => (p ? `${k}|${Object.values(p).join('|')}` : k), language: 'en' })
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

const tab = (products, { selectedCurrency = 'usd' } = {}) => (
  <VendorInventoryTab
    products={products}
    categories={categories}
    currencies={currencyList}
    visualSettings={{}}
    baseCurrencyId="usd"
    selectedCurrency={selectedCurrency}
    exchangeRates={{ 'usd-cup': 900 }}
    financialSettings={{ productProfit: 45, comboProfit: 35 }}
    onSelectedCurrencyChange={vi.fn()}
    onProductsRefresh={vi.fn()}
  />
);

const priceInput = () => screen.getByTestId('product-base-price-input');
const pressSave = () => fireEvent.click(screen.getByText('vendor.addProduct.save').closest('button'));
const innerSelect = () => screen.getByLabelText('vendor.inventory.priceCurrencyLabel');
const outerSelect = () => screen.queryByLabelText('vendor.inventory.viewPricesIn');
const switchTo = (id) => fireEvent.change(innerSelect(), { target: { value: id } });
const RATE = 900;

const openEdit = () => {
  render(tab([makeProduct()]));
  fireEvent.click(screen.getByText('row-p1'));
  fireEvent.click(screen.getByText('common.edit').closest('button'));
};
const openCreate = (opts) => {
  render(tab([makeProduct()], opts));
  fireEvent.click(screen.getByText('vendor.actions.addProduct').closest('button'));
};

describe('VendorInventoryTab form currency clarity', () => {
  beforeEach(() => {
    mocks.toast.mockClear();
    mocks.convertAmountAsync.mockReset();
    mocks.convertAmountAsync.mockImplementation(async (amount, from, to) => {
      if (from === 'usd' && to === 'cup') return amount * RATE;
      if (from === 'cup' && to === 'usd') return amount / RATE;
      throw new Error('no rate');
    });
    updateProduct.mockClear();
  });

  describe('list currency selector', () => {
    it('is linked to its label when the form is closed', () => {
      render(tab([makeProduct()]));
      expect(outerSelect()).toBeTruthy();
      expect(screen.queryByTestId('list-currency-cue')).toBeNull();
    });

    it('is replaced by a read-only cue while editing', () => {
      openEdit();
      expect(outerSelect()).toBeNull();
      expect(screen.getByTestId('list-currency-cue').textContent).toBe('vendor.inventory.listPricesCue|USD');
    });

    it('is replaced by the cue while creating and returns after cancel', () => {
      openCreate({ selectedCurrency: 'cup' });
      expect(outerSelect()).toBeNull();
      expect(screen.getByTestId('list-currency-cue').textContent).toContain('CUP');

      fireEvent.click(screen.getByText('common.cancel').closest('button'));
      expect(outerSelect()).toBeTruthy();
    });
  });

  describe('currency of the entered price', () => {
    it('has a linked label and a helper that names the base currency', () => {
      openEdit();
      const help = document.getElementById(innerSelect().getAttribute('aria-describedby'));
      expect(help.textContent).toBe('vendor.inventory.priceCurrencyHelp|USD');
    });

    it('re-converts the loaded figure from the original price and announces it', async () => {
      openEdit();
      switchTo('cup');

      await waitFor(() => expect(priceInput().value).toBe('9000'));
      const note = await screen.findByText('vendor.inventory.priceConvertedNote|CUP');
      expect(note.getAttribute('role')).toBe('status');
    });

    it('restores the exact original when switching back', async () => {
      openEdit();
      switchTo('cup');
      await waitFor(() => expect(priceInput().value).toBe('9000'));
      switchTo('usd');

      await waitFor(() => expect(priceInput().value).toBe('10'));
    });

    it('treats a newly typed figure as authoritative for later conversions', async () => {
      openEdit();
      switchTo('cup');
      await waitFor(() => expect(priceInput().value).toBe('9000'));
      fireEvent.change(priceInput(), { target: { value: '1800' } });
      switchTo('usd');

      await waitFor(() => expect(priceInput().value).toBe('2'));
    });

    it('reverts to the previous currency, keeps the figure and alerts when the rate is missing', async () => {
      mocks.convertAmountAsync.mockRejectedValue(new Error('no rate'));
      openEdit();
      switchTo('cup');

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toBe('vendor.inventory.priceRateMissing|CUP');
      expect(priceInput().value).toBe('10');
      expect(innerSelect().value).toBe('usd');
      pressSave();
      await waitFor(() => expect(updateProduct).toHaveBeenCalled());
      expect(updateProduct.mock.calls[0][1]).toMatchObject({ basePrice: 10, base_currency_id: 'usd' });
    });

    it('handles asymmetric rates: fails A->B, resolves B->A, and never leaves an unconverted figure', async () => {
      mocks.convertAmountAsync.mockImplementation(async (amount, from, to) => {
        if (from === 'cup' && to === 'usd') return amount / RATE;
        throw new Error('no rate');
      });
      openEdit();
      switchTo('cup');

      await screen.findByRole('alert');
      expect(innerSelect().value).toBe('usd');
      expect(priceInput().value).toBe('10');
      expect(mocks.convertAmountAsync).not.toHaveBeenCalledWith(expect.anything(), 'cup', 'usd');
    });

    it('treats a non-finite conversion like a missing rate and still saves only the original', async () => {
      mocks.convertAmountAsync.mockResolvedValue(NaN);
      openEdit();
      switchTo('cup');

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toBe('vendor.inventory.priceRateMissing|CUP');
      expect(innerSelect().value).toBe('usd');
      expect(priceInput().value).toBe('10');
      pressSave();
      await waitFor(() => expect(updateProduct).toHaveBeenCalled());
      expect(updateProduct.mock.calls[0][1]).toMatchObject({ basePrice: 10, base_currency_id: 'usd' });
    });

    it('keeps the alert visible while the user types after a failed switch', async () => {
      mocks.convertAmountAsync.mockRejectedValue(new Error('no rate'));
      openEdit();
      switchTo('cup');
      await screen.findByRole('alert');
      fireEvent.change(priceInput(), { target: { value: '12' } });

      expect(screen.getByRole('alert')).toBeTruthy();
      expect(innerSelect().value).toBe('usd');
    });

    // Create vs edit: only an edit has an original price to anchor to; in create the typed figure is
    // authoritative and is simply read in whichever currency is selected.
    it('does not re-convert in create mode', () => {
      openCreate();
      fireEvent.change(priceInput(), { target: { value: '5' } });
      switchTo('cup');

      expect(priceInput().value).toBe('5');
      expect(mocks.convertAmountAsync).not.toHaveBeenCalledWith(5, 'usd', 'cup');
    });
  });

  describe('pending conversion is discarded when the form changes underneath it', () => {
    const deferNext = () => {
      let resolve;
      mocks.convertAmountAsync.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
      return (value) => resolve(value);
    };

    it('A: does not touch another product opened while the conversion is pending', async () => {
      const release = deferNext();
      render(tab([makeProduct(), makeProduct({ id: 'p2', name_es: 'Frijol', base_price: 20 })]));
      fireEvent.click(screen.getByText('row-p1'));
      fireEvent.click(screen.getByText('common.edit').closest('button'));
      switchTo('cup');
      fireEvent.click(screen.getByText('row-p2'));
      fireEvent.click(screen.getByText('common.edit').closest('button'));
      expect(priceInput().value).toBe('20');

      await act(async () => { release(9000); });

      expect(priceInput().value).toBe('20');
      expect(innerSelect().value).toBe('usd');
      expect(screen.queryByText(/priceConvertedNote/)).toBeNull();
    });

    // Covered by the sequence counter bumped on close (not by any updater guard)
    it('B: does not bring the form back when cancelled while the conversion is pending', async () => {
      const release = deferNext();
      openEdit();
      switchTo('cup');
      fireEvent.click(screen.getByText('common.cancel').closest('button'));

      await act(async () => { release(9000); });

      expect(screen.queryByTestId('product-base-price-input')).toBeNull();
      expect(outerSelect()).toBeTruthy();
    });

    it('C: a figure typed while pending wins and becomes the anchor for the next switch', async () => {
      const release = deferNext();
      openEdit();
      switchTo('cup');
      fireEvent.change(priceInput(), { target: { value: '7' } });

      await act(async () => { release(9000); });

      expect(priceInput().value).toBe('7');
      expect(innerSelect().value).toBe('usd');
      switchTo('cup');
      await waitFor(() => expect(priceInput().value).toBe('6300'));
    });
  });

  describe('anchor after clearing the field (edit mode)', () => {
    it('re-anchors on a figure typed after the field was emptied', async () => {
      openEdit();
      fireEvent.change(priceInput(), { target: { value: '' } });
      fireEvent.change(priceInput(), { target: { value: '50' } });
      switchTo('cup');

      await waitFor(() => expect(priceInput().value).toBe('45000'));
    });

    it('re-anchors for a product loaded with a zero base price', async () => {
      render(tab([makeProduct({ base_price: 0 })]));
      fireEvent.click(screen.getByText('row-p1'));
      fireEvent.click(screen.getByText('common.edit').closest('button'));
      fireEvent.change(priceInput(), { target: { value: '5' } });
      switchTo('cup');

      await waitFor(() => expect(priceInput().value).toBe('4500'));
    });
  });

  describe('a conversion that rounds to zero is a failed conversion', () => {
    it('keeps the currency, shows the alert and saves the original', async () => {
      mocks.convertAmountAsync.mockResolvedValue(0.0011);
      openEdit();
      switchTo('cup');

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toBe('vendor.inventory.priceRateMissing|CUP');
      expect(innerSelect().value).toBe('usd');
      expect(priceInput().value).toBe('10');
    });
  });

  describe('saving while a conversion is in flight', () => {
    it('disables Save, announces the conversion and never submits until it settles', async () => {
      let release;
      mocks.convertAmountAsync.mockImplementationOnce(() => new Promise((r) => { release = r; }));
      openEdit();
      switchTo('cup');

      const save = screen.getByText('vendor.addProduct.save').closest('button');
      expect(save.disabled).toBe(true);
      expect(screen.getByText('vendor.inventory.priceConverting')).toBeTruthy();
      fireEvent.click(save);
      expect(updateProduct).not.toHaveBeenCalled();

      await act(async () => { release(9000); });
      await waitFor(() => expect(save.disabled).toBe(false));
      expect(screen.queryByText('vendor.inventory.priceConverting')).toBeNull();
    });

    it('clears the converting state when a pending switch is superseded by a switch back to the anchor currency', async () => {
      openEdit();
      switchTo('cup');
      await waitFor(() => expect(priceInput().value).toBe('9000'));
      let release;
      mocks.convertAmountAsync.mockImplementationOnce(() => new Promise((r) => { release = r; }));
      switchTo('eur');
      expect(screen.getByText('vendor.inventory.priceConverting')).toBeTruthy();
      switchTo('usd');

      expect(screen.queryByText('vendor.inventory.priceConverting')).toBeNull();
      expect(screen.getByText('vendor.addProduct.save').closest('button').disabled).toBe(false);
      await act(async () => { release(8000); });
      expect(innerSelect().value).toBe('usd');
      expect(priceInput().value).toBe('10');
      expect(screen.queryByText('vendor.inventory.priceConverting')).toBeNull();
    });

    it('re-enables Save when the pending conversion fails', async () => {
      mocks.convertAmountAsync.mockRejectedValueOnce(new Error('no rate'));
      openEdit();
      switchTo('cup');

      await screen.findByRole('alert');
      expect(screen.getByText('vendor.addProduct.save').closest('button').disabled).toBe(false);
    });
  });

  describe('double submit', () => {
    it('submits only once when Save is clicked twice while the save is in flight', async () => {
      let finish;
      updateProduct.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
      openEdit();
      const save = screen.getByText('vendor.addProduct.save').closest('button');
      fireEvent.click(save);
      fireEvent.click(save);

      await act(async () => { finish({}); });
      expect(updateProduct).toHaveBeenCalledTimes(1);
    });
  });

  describe('saving', () => {
    it('persists the original base price for an untouched edit', async () => {
      openEdit();
      pressSave();

      await waitFor(() => expect(updateProduct).toHaveBeenCalled());
      expect(updateProduct.mock.calls[0][1]).toMatchObject({ basePrice: 10, base_currency_id: 'usd' });
    });

    it('persists the original after a round trip USD -> CUP -> USD', async () => {
      openEdit();
      switchTo('cup');
      await waitFor(() => expect(priceInput().value).toBe('9000'));
      switchTo('usd');
      await waitFor(() => expect(priceInput().value).toBe('10'));
      pressSave();

      await waitFor(() => expect(updateProduct).toHaveBeenCalled());
      expect(updateProduct.mock.calls[0][1]).toMatchObject({ basePrice: 10, base_currency_id: 'usd' });
    });

    it('keeps a price with more than 2 decimals within rounding tolerance after saving in another currency', async () => {
      render(tab([makeProduct({ base_price: 0.3337 })]));
      fireEvent.click(screen.getByText('row-p1'));
      fireEvent.click(screen.getByText('common.edit').closest('button'));
      switchTo('cup');
      await waitFor(() => expect(priceInput().value).toBe('300.33'));
      pressSave();

      await waitFor(() => expect(updateProduct).toHaveBeenCalled());
      // the displayed CUP figure is rounded to cents, so a small drift in base is expected (known limit)
      expect(updateProduct.mock.calls[0][1].basePrice).toBeCloseTo(0.3337, 3);
    });

    it('persists the equivalent in base after switching to CUP without retyping', async () => {
      openEdit();
      switchTo('cup');
      await waitFor(() => expect(priceInput().value).toBe('9000'));
      pressSave();

      await waitFor(() => expect(updateProduct).toHaveBeenCalled());
      expect(updateProduct.mock.calls[0][1].basePrice).toBeCloseTo(10, 6);
    });
  });
});
