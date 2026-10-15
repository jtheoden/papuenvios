import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const tableOptions = vi.hoisted(() => ({ current: null, onSelectionChange: null }));
const bulkResult = vi.hoisted(() => ({ promise: null }));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (k) => k, language: 'en' })
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'a@b.com' }, isSuperAdmin: true })
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
vi.mock('@/components/tables/BulkDeleteBar', () => ({
  default: ({ onConfirmDelete, selectedIds }) => (
    <div>
      <span data-testid="selected">{selectedIds.join(',')}</span>
      <button onClick={() => { bulkResult.promise = onConfirmDelete(['p1']); }}>bulk-confirm</button>
    </div>
  )
}));
vi.mock('@/components/vendor/ProductTableConfig', () => ({
  getTableColumns: (_t, _language, _currencies, options) => {
    tableOptions.current = options;
    return [];
  },
  getModalColumns: () => []
}));
vi.mock('@/components/tables/ResponsiveTableWrapper', () => ({
  default: ({ data = [], onSelectionChange }) => {
    tableOptions.onSelectionChange = onSelectionChange;
    return (
    <div>
      {data.map((row) => (
        <button key={row.id} onClick={() => tableOptions.current.onDelete(row)}>
          {`delete-row-${row.id}`}
        </button>
      ))}
    </div>
    );
  }
}));

import VendorInventoryTab from '@/components/vendor/VendorInventoryTab';
import { toast } from '@/components/ui/use-toast';
import { deleteProduct } from '@/lib/productService';
import { bulkDeleteProducts } from '@/lib/bulkDeleteService';
import { AppError, ERROR_CODES, createNotFoundError } from '@/lib/errorHandler';

const product = {
  id: 'p1', name_es: 'Arroz', name_en: 'Rice', base_price: 10, base_currency_id: 'usd',
  category_id: 'c1', category: { id: 'c1', name_es: 'A', name_en: 'A' },
  profit_margin: 30, final_price: 13, stock: 5, is_active: true
};

let onProductsRefresh;

const buildTab = (products) => (
    <VendorInventoryTab
      products={products}
      categories={[{ id: 'c1', name_es: 'A', name_en: 'A', profit_margin: 25 }]}
      currencies={[{ id: 'usd', code: 'USD', symbol: '$', is_base: true }]}
      visualSettings={{}}
      baseCurrencyId="usd"
      selectedCurrency="usd"
      exchangeRates={[]}
      financialSettings={{ productProfit: 45, comboProfit: 35 }}
      onSelectedCurrencyChange={vi.fn()}
      onProductsRefresh={onProductsRefresh}
    />
  );

const renderTab = (products = [product]) => {
  onProductsRefresh = vi.fn().mockResolvedValue(undefined);
  return render(buildTab(products));
};

const openDeleteConfirm = () => {
  fireEvent.click(screen.getByText('delete-row-p1'));
  expect(screen.getByText('vendor.inventory.deleteConfirmTitle')).toBeTruthy();
};

const confirmDelete = () => fireEvent.click(screen.getByText('common.delete').closest('button'));

describe('VendorInventoryTab delete outcomes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('single delete', () => {
    it('treats NOT_FOUND as already deleted: neutral toast, modal closed, list refreshed', async () => {
      deleteProduct.mockRejectedValue(createNotFoundError('Product', 'p1'));
      renderTab();
      openDeleteConfirm();
      confirmDelete();

      await waitFor(() => expect(onProductsRefresh).toHaveBeenCalledWith(true));
      expect(toast).toHaveBeenCalledTimes(1);
      const arg = toast.mock.calls[0][0];
      expect(arg.title).toBe('vendor.inventory.productAlreadyDeleted');
      expect(arg.variant).toBeUndefined();
      await waitFor(() =>
        expect(screen.queryByText('vendor.inventory.deleteConfirmTitle')).toBeNull()
      );
    });

    it('keeps the destructive toast, no refresh and open modal for other errors', async () => {
      deleteProduct.mockRejectedValue(new AppError('has orders', ERROR_CODES.CONFLICT, 409));
      renderTab();
      openDeleteConfirm();
      confirmDelete();

      await waitFor(() => expect(toast).toHaveBeenCalled());
      expect(toast.mock.calls[0][0].variant).toBe('destructive');
      expect(toast.mock.calls[0][0].description).toBe('has orders');
      expect(onProductsRefresh).not.toHaveBeenCalled();
      expect(screen.getByText('vendor.inventory.deleteConfirmTitle')).toBeTruthy();
    });
  });

  describe('bulk delete', () => {
    it('refreshes the list when every item came back not_found', async () => {
      bulkDeleteProducts.mockResolvedValue({ deleted: [], blocked: [{ id: 'p1', reason: 'not_found' }] });
      renderTab();
      fireEvent.click(screen.getByText('bulk-confirm'));

      await waitFor(() => expect(onProductsRefresh).toHaveBeenCalledWith(true));
      expect(toast).not.toHaveBeenCalled();
    });

    it('does not refresh when items are only blocked by orders', async () => {
      bulkDeleteProducts.mockResolvedValue({ deleted: [], blocked: [{ id: 'p1', reason: 'blocking_orders' }] });
      renderTab();
      fireEvent.click(screen.getByText('bulk-confirm'));

      await waitFor(() => expect(bulkDeleteProducts).toHaveBeenCalled());
      await act(async () => { await bulkResult.promise; });
      expect(onProductsRefresh).not.toHaveBeenCalled();
    });

    it('still toasts success and refreshes when something was deleted', async () => {
      bulkDeleteProducts.mockResolvedValue({ deleted: ['p1'], blocked: [] });
      renderTab();
      fireEvent.click(screen.getByText('bulk-confirm'));

      await waitFor(() => expect(onProductsRefresh).toHaveBeenCalledWith(true));
      expect(toast).toHaveBeenCalledTimes(1);
    });
  });

  describe('refresh failures', () => {
    it('NOT_FOUND with a rejecting refresh shows a destructive refresh-failed toast (no unhandled rejection)', async () => {
      deleteProduct.mockRejectedValue(createNotFoundError('Product', 'p1'));
      renderTab();
      onProductsRefresh.mockRejectedValue(new Error('network'));
      openDeleteConfirm();
      confirmDelete();

      await waitFor(() => expect(toast).toHaveBeenCalledTimes(2));
      expect(toast.mock.calls[0][0].title).toBe('vendor.inventory.productAlreadyDeleted');
      expect(toast.mock.calls[1][0].title).toBe('vendor.inventory.refreshFailed');
      expect(toast.mock.calls[1][0].variant).toBe('destructive');
    });

    it('a refresh failure after a successful delete does not report a delete error', async () => {
      deleteProduct.mockResolvedValue({});
      renderTab();
      onProductsRefresh.mockRejectedValue(new Error('network'));
      openDeleteConfirm();
      confirmDelete();

      await waitFor(() => expect(toast).toHaveBeenCalledTimes(2));
      const titles = toast.mock.calls.map((c) => c[0].title);
      expect(titles).toEqual(['vendor.inventory.productDeleted', 'vendor.inventory.refreshFailed']);
      expect(titles).not.toContain('common.error');
      await waitFor(() =>
        expect(screen.queryByText('vendor.inventory.deleteConfirmTitle')).toBeNull()
      );
    });

    it('bulk delete still returns the outcome when the refresh rejects', async () => {
      const outcome = { deleted: [], blocked: [{ id: 'p1', reason: 'not_found' }] };
      bulkDeleteProducts.mockResolvedValue(outcome);
      renderTab();
      onProductsRefresh.mockRejectedValue(new Error('network'));
      fireEvent.click(screen.getByText('bulk-confirm'));

      let result;
      await act(async () => { result = await bulkResult.promise; });
      expect(result).toBe(outcome);
      expect(toast.mock.calls.map((c) => c[0].title)).toContain('vendor.inventory.refreshFailed');
    });
  });

  describe('selection pruning', () => {
    it('drops selected ids that disappear from the products list', async () => {
      const view = renderTab([product, { ...product, id: 'p2' }]);
      act(() => tableOptions.onSelectionChange(['p1', 'p2']));
      expect(screen.getByTestId('selected').textContent).toBe('p1,p2');

      view.rerender(buildTab([{ ...product, id: 'p2' }]));
      await waitFor(() => expect(screen.getByTestId('selected').textContent).toBe('p2'));
    });
  });
});
