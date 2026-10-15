import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'es' })
}));

vi.mock('@/lib/remittanceService', () => ({
  generateProofSignedUrl: vi.fn().mockResolvedValue({ success: false })
}));

const fetchComboDefinitionsMock = vi.fn();
vi.mock('@/lib/orderComboService', () => ({
  fetchComboDefinitions: (...args) => fetchComboDefinitionsMock(...args)
}));

import OrderDetailsModal from '@/components/admin/modals/OrderDetailsModal';
import { toComboDefinitionMap } from '@/lib/orderItemsPure';

const definition = (itemsCreatedAt) => toComboDefinitionMap([
  {
    id: 'combo-10',
    name_es: 'COMBO 10',
    name_en: 'COMBO 10',
    updated_at: '2026-10-15T10:03:32Z',
    combo_items: [
      { product_id: 'p1', quantity: 2, created_at: itemsCreatedAt, products: { name_es: 'Arroz', name_en: 'Rice' } },
      { product_id: 'p2', quantity: 5, created_at: itemsCreatedAt, products: { name_es: 'Carne de Cerdo', name_en: 'Pork' } }
    ]
  }
]);

const order = (items) => ({
  id: 'o1',
  order_number: 'ORD-20261015-82649',
  created_at: '2026-10-15T05:29:42.995Z',
  order_type: 'product',
  payment_status: 'pending',
  status: 'pending',
  payment_method: 'zelle',
  total_amount: 44.8,
  order_items: items
});

const comboLine = (overrides = {}) => ({
  item_type: 'combo',
  item_id: 'combo-10',
  item_name_es: 'COMBO 10',
  item_name_en: 'COMBO 10',
  quantity: 2,
  unit_price: 44.81,
  total_price: 89.62,
  ...overrides
});

const renderModal = (o) =>
  render(
    <OrderDetailsModal order={o} onClose={() => {}} formatDate={(d) => String(d)} formatCurrency={(v) => String(v)} />
  );

describe('OrderDetailsModal combo components', () => {
  beforeEach(() => fetchComboDefinitionsMock.mockReset());

  it('lists combo components multiplied by the line quantity under the combo line', async () => {
    fetchComboDefinitionsMock.mockResolvedValue(definition('2026-10-11T08:00:00Z'));
    renderModal(order([comboLine()]));

    const list = await screen.findByRole('list', { name: 'orderCombo.contains' });
    expect(within(list).getByText('4 × Arroz')).toBeInTheDocument();
    expect(within(list).getByText('10 × Carne de Cerdo')).toBeInTheDocument();
    expect(fetchComboDefinitionsMock).toHaveBeenCalledTimes(1);
    expect(fetchComboDefinitionsMock).toHaveBeenCalledWith(['combo-10']);
    expect(screen.queryByText('orderCombo.modifiedNote')).not.toBeInTheDocument();
  });

  it('shows the note when the composition was saved after the order', async () => {
    fetchComboDefinitionsMock.mockResolvedValue(definition('2026-10-16T08:00:00Z'));
    renderModal(order([comboLine()]));
    expect(await screen.findByText('orderCombo.modifiedNote')).toBeInTheDocument();
  });

  it('keeps the single line and shows a muted note when the combo no longer exists', async () => {
    fetchComboDefinitionsMock.mockResolvedValue(new Map());
    renderModal(order([comboLine()]));
    expect(await screen.findByText('orderCombo.unavailable')).toBeInTheDocument();
    expect(screen.getByText('COMBO 10')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'orderCombo.contains' })).not.toBeInTheDocument();
  });

  it('does not query anything for orders without combos', async () => {
    renderModal(order([{ item_type: 'product', item_id: 'p1', item_name_es: 'Arroz', quantity: 1, unit_price: 1, total_price: 1 }]));
    expect(fetchComboDefinitionsMock).not.toHaveBeenCalled();
    expect(screen.getByText('Arroz')).toBeInTheDocument();
  });

  it('defines the i18n keys in both languages', () => {
    for (const lang of [ES, EN]) {
      ['contains', 'modifiedNote', 'unavailable', 'unknownProduct'].forEach((k) => {
        expect(typeof lang.orderCombo[k]).toBe('string');
      });
    }
  });
});
