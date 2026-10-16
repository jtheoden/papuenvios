import { describe, it, expect } from 'vitest';
import {
  collectProductIds,
  toProductUnitMap,
  toComboDefinitionMap,
  buildOrderItemLines
} from '@/lib/orderItemsPure';

const combo = toComboDefinitionMap([
  {
    id: 'combo-10',
    combo_items: [
      { product_id: 'p-rice', quantity: 2, created_at: '2026-10-11T08:00:00Z', products: { name_es: 'Arroz', name_en: 'Rice', unit: 'lb' } },
      { product_id: 'p-pork', quantity: 5, created_at: '2026-10-11T08:00:00Z', products: { name_es: 'Cerdo', name_en: 'Pork', unit: 'lb' } },
      { product_id: 'p-oil', quantity: 1, created_at: '2026-10-11T08:00:00Z', products: { name_es: 'Aceite', name_en: 'Oil', unit: null } },
      { product_id: 'p-odd', quantity: 3, created_at: '2026-10-11T08:00:00Z', products: { name_es: 'Raro', name_en: 'Odd', unit: 'furlong' } },
      { product_id: 'p-old', quantity: 1, created_at: '2026-10-11T08:00:00Z', products: { name_es: 'Viejo', name_en: 'Old' } }
    ]
  }
]);

const comboItem = (overrides = {}) => ({ item_type: 'combo', item_id: 'combo-10', quantity: 2, ...overrides });
const productItem = (overrides = {}) => ({ item_type: 'product', item_id: 'p-rice', quantity: 3, ...overrides });

describe('collectProductIds', () => {
  it('returns unique ids of plain product lines only', () => {
    const orders = [
      { order_items: [productItem(), productItem({ item_id: 'p-oil' }), comboItem()] },
      { order_items: [productItem()] },
      { order_items: [productItem({ item_id: null })] },
      { order_items: null }
    ];
    expect(collectProductIds(orders).sort()).toEqual(['p-oil', 'p-rice']);
  });

  it('is empty for nullish input', () => {
    expect(collectProductIds(null)).toEqual([]);
  });
});

describe('toProductUnitMap', () => {
  it('indexes unit by product id and skips rows without id', () => {
    const map = toProductUnitMap([{ id: 'a', unit: 'kg' }, { id: 'b', unit: null }, { unit: 'lb' }]);
    expect(map.get('a')).toBe('kg');
    expect(map.get('b')).toBeNull();
    expect(map.size).toBe(2);
    expect(toProductUnitMap(null).size).toBe(0);
  });
});

describe('buildOrderItemLines units', () => {
  it('carries each component unit (null, unknown and missing kept as provided)', () => {
    const [line] = buildOrderItemLines([comboItem()], combo, { language: 'es' });
    expect(line.components.map((c) => [c.name, c.quantity, c.unit])).toEqual([
      ['Arroz', 4, 'lb'],
      ['Cerdo', 10, 'lb'],
      ['Aceite', 2, null],
      ['Raro', 6, 'furlong'],
      ['Viejo', 2, null]
    ]);
  });

  it('attaches the unit of plain product lines from the units map', () => {
    const units = toProductUnitMap([{ id: 'p-rice', unit: 'lb' }, { id: 'p-oil', unit: null }]);
    const lines = buildOrderItemLines(
      [productItem(), productItem({ item_id: 'p-oil' }), productItem({ item_id: 'p-missing' }), comboItem()],
      combo,
      { language: 'en', productUnits: units }
    );
    expect(lines.map((l) => l.unit)).toEqual(['lb', null, null, null]);
  });

  it('leaves unit null when no units map is provided (lookup pending or failed)', () => {
    const [line] = buildOrderItemLines([productItem()], undefined, { language: 'es' });
    expect(line.unit).toBeNull();
  });

  it('does not attach units to remittance or other non-product lines', () => {
    const units = toProductUnitMap([{ id: 'x', unit: 'kg' }]);
    const [line] = buildOrderItemLines([{ item_type: 'remittance', item_id: 'x', quantity: 1 }], undefined, { productUnits: units });
    expect(line.unit).toBeNull();
  });
});
