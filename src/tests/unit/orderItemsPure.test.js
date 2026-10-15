import { describe, it, expect } from 'vitest';
import {
  collectComboIds,
  toComboDefinitionMap,
  buildOrderItemLines
} from '@/lib/orderItemsPure';

const ORDER_CREATED = '2026-10-15T05:29:42.995Z';

const comboRow = (overrides = {}) => ({
  id: 'combo-10',
  name_es: 'COMBO 10',
  name_en: 'COMBO 10',
  // Bumped by a migration/trigger long after the order: must NOT drive the "modified" signal.
  updated_at: '2026-10-15T10:03:32Z',
  combo_items: [
    { product_id: 'p-rice', quantity: 2, created_at: '2026-10-11T08:00:00Z', products: { name_es: 'Arroz', name_en: 'Rice' } },
    { product_id: 'p-sugar', quantity: 1, created_at: '2026-10-11T08:00:00Z', products: { name_es: 'Azúcar', name_en: 'Sugar' } }
  ],
  ...overrides
});

const comboItem = (overrides = {}) => ({
  item_type: 'combo',
  item_id: 'combo-10',
  item_name_es: 'COMBO 10',
  item_name_en: 'COMBO 10',
  quantity: 1,
  unit_price: '44.81',
  total_price: '44.81',
  ...overrides
});

const productItem = (overrides = {}) => ({
  item_type: 'product',
  item_id: 'p-rice',
  item_name_es: 'Arroz',
  item_name_en: 'Rice',
  quantity: 3,
  unit_price: '2.00',
  total_price: '6.00',
  ...overrides
});

const defs = (...rows) => toComboDefinitionMap(rows);

describe('collectComboIds', () => {
  it('returns unique combo ids across several orders and ignores other item types', () => {
    const orders = [
      { order_items: [comboItem(), productItem(), comboItem({ item_id: 'combo-2' })] },
      { order_items: [comboItem()] },
      { order_items: null },
      {}
    ];
    expect(collectComboIds(orders).sort()).toEqual(['combo-10', 'combo-2']);
  });

  it('returns an empty array for nullish input', () => {
    expect(collectComboIds(null)).toEqual([]);
    expect(collectComboIds(undefined)).toEqual([]);
  });
});

describe('toComboDefinitionMap', () => {
  it('indexes rows by id and tolerates null/empty input', () => {
    expect(toComboDefinitionMap([comboRow()]).get('combo-10').name_es).toBe('COMBO 10');
    expect(toComboDefinitionMap(null).size).toBe(0);
  });
});

describe('buildOrderItemLines', () => {
  it('expands a combo into components multiplied by the line quantity', () => {
    const [line] = buildOrderItemLines([comboItem({ quantity: 3 })], defs(comboRow()), {
      language: 'es',
      orderCreatedAt: ORDER_CREATED
    });
    expect(line.components).toEqual([
      { productId: 'p-rice', name: 'Arroz', quantity: 6 },
      { productId: 'p-sugar', name: 'Azúcar', quantity: 3 }
    ]);
  });

  it('keeps the original item fields untouched', () => {
    const item = comboItem();
    const [line] = buildOrderItemLines([item], defs(comboRow()), { language: 'es', orderCreatedAt: ORDER_CREATED });
    expect(line.item).toBe(item);
  });

  it('picks component names by language with fallback to the other language', () => {
    const row = comboRow({
      combo_items: [
        { product_id: 'a', quantity: 1, products: { name_es: 'Solo ES', name_en: null } },
        { product_id: 'b', quantity: 1, products: { name_es: 'Frijoles', name_en: 'Beans' } }
      ]
    });
    const [en] = buildOrderItemLines([comboItem()], defs(row), { language: 'en', orderCreatedAt: ORDER_CREATED });
    expect(en.components.map((c) => c.name)).toEqual(['Solo ES', 'Beans']);
    const [es] = buildOrderItemLines([comboItem()], defs(row), { language: 'es', orderCreatedAt: ORDER_CREATED });
    expect(es.components.map((c) => c.name)).toEqual(['Solo ES', 'Frijoles']);
  });

  it('uses a null name when the component product is not readable', () => {
    const row = comboRow({ combo_items: [{ product_id: 'x', quantity: 2, products: null }] });
    const [line] = buildOrderItemLines([comboItem()], defs(row), { language: 'es', orderCreatedAt: ORDER_CREATED });
    expect(line.components).toEqual([{ productId: 'x', name: null, quantity: 2 }]);
  });

  it('returns components null when the combo definition is missing', () => {
    const [line] = buildOrderItemLines([comboItem({ item_id: 'gone' })], defs(comboRow()), {
      language: 'es',
      orderCreatedAt: ORDER_CREATED
    });
    expect(line.components).toBeNull();
    expect(line.compositionChanged).toBe(false);
  });

  it('returns an empty components array for a combo without items', () => {
    const [line] = buildOrderItemLines([comboItem()], defs(comboRow({ combo_items: [] })), {
      language: 'es',
      orderCreatedAt: ORDER_CREATED
    });
    expect(line.components).toEqual([]);
  });

  it('does NOT flag compositionChanged when only combo.updated_at is after the order (prod scenario)', () => {
    const [line] = buildOrderItemLines([comboItem()], defs(comboRow()), { language: 'es', orderCreatedAt: ORDER_CREATED });
    expect(line.compositionChanged).toBe(false);
  });

  it('flags compositionChanged when any combo item was created after the order', () => {
    const row = comboRow({
      combo_items: [
        { product_id: 'a', quantity: 1, created_at: '2026-10-11T08:00:00Z', products: { name_es: 'A', name_en: 'A' } },
        { product_id: 'b', quantity: 1, created_at: '2026-10-16T08:00:00Z', products: { name_es: 'B', name_en: 'B' } }
      ]
    });
    const [line] = buildOrderItemLines([comboItem()], defs(row), { language: 'es', orderCreatedAt: ORDER_CREATED });
    expect(line.compositionChanged).toBe(true);
  });

  it('does not flag compositionChanged when item dates or order date are missing/invalid', () => {
    const [noOrderDate] = buildOrderItemLines([comboItem()], defs(comboRow()), { language: 'es' });
    expect(noOrderDate.compositionChanged).toBe(false);
    const row = comboRow({ combo_items: [{ product_id: 'a', quantity: 1, created_at: null, products: null }] });
    const [noItemDate] = buildOrderItemLines([comboItem()], defs(row), { language: 'es', orderCreatedAt: ORDER_CREATED });
    expect(noItemDate.compositionChanged).toBe(false);
  });

  it('keeps the single line without crashing for null item_id, unknown item types and dangling ids', () => {
    const items = [
      comboItem({ item_id: null }),
      comboItem({ item_id: 'deleted-combo' }),
      { item_type: 'gift_card', item_id: 'combo-10', quantity: 1 },
      { item_type: null, item_id: 'combo-10', quantity: 1 },
      null
    ];
    const lines = buildOrderItemLines(items, defs(comboRow()), { language: 'es', orderCreatedAt: ORDER_CREATED });
    expect(lines).toHaveLength(4);
    lines.forEach((l) => expect(l.components).toBeNull());
  });

  it('treats a combo item with null/invalid quantity as quantity 1 per unit', () => {
    const row = comboRow({ combo_items: [{ product_id: 'a', quantity: null, created_at: null, products: { name_es: 'A', name_en: 'A' } }] });
    const [line] = buildOrderItemLines([comboItem({ quantity: 2 })], defs(row), { language: 'es' });
    expect(line.components[0].quantity).toBe(2);
  });

  it('leaves standalone products and remittance-like items without components', () => {
    const remittance = { item_type: 'remittance', item_id: 'r1', item_name_es: 'Remesa', quantity: 1 };
    const lines = buildOrderItemLines(
      [productItem(), comboItem(), remittance],
      defs(comboRow()),
      { language: 'es', orderCreatedAt: ORDER_CREATED }
    );
    expect(lines).toHaveLength(3);
    expect(lines[0].components).toBeNull();
    expect(lines[1].components).toHaveLength(2);
    expect(lines[2].components).toBeNull();
    expect(lines[2].compositionChanged).toBe(false);
  });

  it('handles nullish items and an undefined definitions map', () => {
    expect(buildOrderItemLines(null, defs(), { language: 'es' })).toEqual([]);
    const [line] = buildOrderItemLines([comboItem()], undefined, { language: 'es' });
    expect(line.components).toBeNull();
  });
});
