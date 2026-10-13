import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const createCategoryMock = vi.fn();
const updateCategoryMock = vi.fn();
const toastMock = vi.fn();

vi.mock('@/lib/productService', () => ({
  createCategory: (...a) => createCategoryMock(...a),
  updateCategory: (...a) => updateCategoryMock(...a),
  deleteCategory: vi.fn()
}));
vi.mock('@/lib/bulkDeleteService', () => ({
  bulkDeleteCategories: vi.fn(),
  previewBulkDeleteCategories: vi.fn()
}));
vi.mock('@/hooks/useRealtimeSubscription', () => ({ useRealtimeCategories: vi.fn() }));
vi.mock('@/components/tables/BulkDeleteBar', () => ({ default: () => null }));
vi.mock('@/components/ui/use-toast', () => ({ toast: (...a) => toastMock(...a) }));
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (k) => k, language: 'en' })
}));
vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({ products: [], refreshCategories: vi.fn().mockResolvedValue(undefined) })
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'a@b.com' }, isSuperAdmin: false })
}));

import VendorCategoriesTab from '@/components/vendor/VendorCategoriesTab';

const categories = [
  { id: 'c1', slug: 'food', name_es: 'Alimentos', name_en: 'Food', description_es: '', description_en: '', profit_margin: 25 },
  { id: 'c2', slug: 'tech', name_es: 'Tecnologia', name_en: 'Tech', description_es: '', description_en: '', profit_margin: null }
];

const renderTab = () =>
  render(<VendorCategoriesTab categories={categories} onCategoriesChange={vi.fn()} visualSettings={{}} />);

const marginInput = () => screen.getByLabelText(/profit margin/i);

describe('VendorCategoriesTab category margin', () => {
  beforeEach(() => {
    createCategoryMock.mockReset().mockResolvedValue({});
    updateCategoryMock.mockReset().mockResolvedValue({});
    toastMock.mockReset();
  });

  it('shows the margin in the list for categories that have one and nothing for those without', () => {
    renderTab();
    expect(screen.getByText('25%')).toBeTruthy();
    expect(screen.getAllByText(/\d+(\.\d+)?%/)).toHaveLength(1);
  });

  it('sends the typed margin when creating a category', async () => {
    renderTab();
    fireEvent.click(screen.getByText('New Category').closest('button'));
    const [es, en] = screen.getAllByRole('textbox');
    fireEvent.change(es, { target: { value: 'Ropa' } });
    fireEvent.change(en, { target: { value: 'Clothes' } });
    fireEvent.change(marginInput(), { target: { value: '30' } });
    fireEvent.click(screen.getByText('Create').closest('button'));

    await waitFor(() => expect(createCategoryMock).toHaveBeenCalled());
    expect(createCategoryMock.mock.calls[0][0]).toMatchObject({ es: 'Ropa', en: 'Clothes', profit_margin: '30' });
  });

  it('leaves the margin empty by default (optional) and sends an empty value', async () => {
    renderTab();
    fireEvent.click(screen.getByText('New Category').closest('button'));
    const [es, en] = screen.getAllByRole('textbox');
    fireEvent.change(es, { target: { value: 'Ropa' } });
    fireEvent.change(en, { target: { value: 'Clothes' } });
    expect(marginInput().value).toBe('');
    fireEvent.click(screen.getByText('Create').closest('button'));

    await waitFor(() => expect(createCategoryMock).toHaveBeenCalled());
    expect(createCategoryMock.mock.calls[0][0].profit_margin).toBe('');
  });

  it('pre-fills the margin when editing and allows clearing it', async () => {
    renderTab();
    fireEvent.click(screen.getAllByLabelText('Edit category')[0]);
    expect(marginInput().value).toBe('25');

    fireEvent.change(marginInput(), { target: { value: '' } });
    fireEvent.click(screen.getByText('Update').closest('button'));

    await waitFor(() => expect(updateCategoryMock).toHaveBeenCalled());
    expect(updateCategoryMock.mock.calls[0][0]).toBe('c1');
    expect(updateCategoryMock.mock.calls[0][1].profit_margin).toBe('');
  });

  it('shows the service validation error and keeps the form open for an out-of-range margin', async () => {
    createCategoryMock.mockRejectedValue(new Error('Invalid category profit margin'));
    renderTab();
    fireEvent.click(screen.getByText('New Category').closest('button'));
    const [es, en] = screen.getAllByRole('textbox');
    fireEvent.change(es, { target: { value: 'Ropa' } });
    fireEvent.change(en, { target: { value: 'Clothes' } });
    fireEvent.change(marginInput(), { target: { value: '1500' } });
    fireEvent.click(screen.getByText('Create').closest('button'));

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive', description: 'Invalid category profit margin' })
    ));
    expect(marginInput().value).toBe('1500');
  });
});
