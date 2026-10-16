import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';

let currentLanguage = 'es';
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: currentLanguage })
}));

vi.mock('@/lib/remittanceService', () => ({
  generateProofSignedUrl: vi.fn().mockResolvedValue({ success: false })
}));

const fetchComboDefinitionsMock = vi.fn();
const fetchProductUnitsMock = vi.fn();
vi.mock('@/lib/orderComboService', () => ({
  fetchComboDefinitions: (...args) => fetchComboDefinitionsMock(...args),
  fetchProductUnits: (...args) => fetchProductUnitsMock(...args)
}));

import OrderDetailsModal from '@/components/admin/modals/OrderDetailsModal';
import { toComboDefinitionMap, toProductUnitMap } from '@/lib/orderItemsPure';

const definition = (units = { rice: 'lb', pork: 'lb' }) =>
  toComboDefinitionMap([
    {
      id: 'combo-10',
      combo_items: [
        { product_id: 'p1', quantity: 2, created_at: '2026-10-11T08:00:00Z', products: { name_es: 'Arroz', name_en: 'Rice', unit: units.rice } },
        { product_id: 'p2', quantity: 5, created_at: '2026-10-11T08:00:00Z', products: { name_es: 'Carne de Cerdo', name_en: 'Pork', unit: units.pork } }
      ]
    }
  ]);

const order = (items) => ({
  id: 'o1',
  order_number: 'ORD-1',
  created_at: '2026-10-15T05:29:42.995Z',
  order_type: 'product',
  payment_status: 'pending',
  status: 'pending',
  payment_method: 'zelle',
  total_amount: 10,
  order_items: items
});

const comboLine = { item_type: 'combo', item_id: 'combo-10', item_name_es: 'COMBO 10', item_name_en: 'COMBO 10', quantity: 1, unit_price: 5, total_price: 5 };
const productLine = { item_type: 'product', item_id: 'p-sugar', item_name_es: 'Azúcar', item_name_en: 'Sugar', quantity: 3, unit_price: 2, total_price: 6 };

const renderModal = (o) =>
  render(<OrderDetailsModal order={o} onClose={() => {}} formatDate={(d) => String(d)} formatCurrency={(v) => String(v)} />);

describe('OrderDetailsModal units', () => {
  beforeEach(() => {
    currentLanguage = 'es';
    fetchComboDefinitionsMock.mockReset();
    fetchProductUnitsMock.mockReset();
    fetchProductUnitsMock.mockResolvedValue(new Map());
  });

  it('shows the unit on combo components', async () => {
    fetchComboDefinitionsMock.mockResolvedValue(definition());
    renderModal(order([comboLine]));
    const list = await screen.findByRole('list', { name: 'orderCombo.contains' });
    expect(within(list).getByText('2 lb × Arroz')).toBeInTheDocument();
    expect(within(list).getByText('5 lb × Carne de Cerdo')).toBeInTheDocument();
  });

  it('keeps the plain quantity for components without a unit', async () => {
    fetchComboDefinitionsMock.mockResolvedValue(definition({ rice: null, pork: undefined }));
    renderModal(order([comboLine]));
    const list = await screen.findByRole('list', { name: 'orderCombo.contains' });
    expect(within(list).getByText('2 × Arroz')).toBeInTheDocument();
    expect(within(list).getByText('5 × Carne de Cerdo')).toBeInTheDocument();
  });

  it('shows the unit on plain product lines with ONE batched lookup', async () => {
    fetchProductUnitsMock.mockResolvedValue(toProductUnitMap([{ id: 'p-sugar', unit: 'kg' }]));
    renderModal(order([productLine, { ...productLine, item_id: 'p-sugar', quantity: 1 }]));
    expect(await screen.findAllByText(/kg$/)).not.toHaveLength(0);
    expect(screen.getByText('3 kg')).toBeInTheDocument();
    expect(screen.getByText('1 kg')).toBeInTheDocument();
    expect(fetchProductUnitsMock).toHaveBeenCalledTimes(1);
    expect(fetchProductUnitsMock).toHaveBeenCalledWith(['p-sugar']);
    expect(fetchComboDefinitionsMock).not.toHaveBeenCalled();
  });

  it('renders the plain quantity exactly as before when the product has no unit', async () => {
    fetchProductUnitsMock.mockResolvedValue(toProductUnitMap([{ id: 'p-sugar', unit: null }]));
    renderModal(order([productLine]));
    await waitFor(() => expect(fetchProductUnitsMock).toHaveBeenCalled());
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('falls back to the plain quantity when the unit lookup rejects', async () => {
    fetchProductUnitsMock.mockRejectedValue(new Error('boom'));
    renderModal(order([productLine]));
    await waitFor(() => expect(fetchProductUnitsMock).toHaveBeenCalled());
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Azúcar')).toBeInTheDocument();
  });

  it('localizes plural unit words in English', async () => {
    currentLanguage = 'en';
    fetchProductUnitsMock.mockResolvedValue(toProductUnitMap([{ id: 'p-sugar', unit: 'bag' }]));
    renderModal(order([productLine]));
    expect(await screen.findByText('3 bags')).toBeInTheDocument();
  });

  it('does not look units up for orders without product lines', async () => {
    fetchComboDefinitionsMock.mockResolvedValue(definition());
    renderModal(order([comboLine]));
    await screen.findByRole('list', { name: 'orderCombo.contains' });
    expect(fetchProductUnitsMock).not.toHaveBeenCalled();
  });
});
