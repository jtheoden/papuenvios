import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createSupabaseRecorder,
  splitSelect,
  containsSensitiveColumn
} from './helpers/supabaseRecorder';

// Phase 0a contract: the public catalog path (anon + customer) must only ever ask for
// non-sensitive columns, with explicit lists, so a later column-level REVOKE cannot break it.

const recorder = await vi.hoisted(async () => {
  const { createSupabaseRecorder } = await import('./helpers/supabaseRecorder');
  return createSupabaseRecorder();
});

vi.mock('@/lib/supabase', () => ({ supabase: recorder.client }));
vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/imageStorage', () => ({ resolveImageUrl: vi.fn().mockResolvedValue(null) }));

import {
  getProductRows,
  getProducts,
  getProductStock,
  getCategories,
  createProduct,
  updateProduct,
  setProductActiveState,
  createCategory,
  updateCategory
} from '@/lib/productService';
import { getCombos, createCombo, updateCombo, setComboActiveState } from '@/lib/comboService';
import {
  getActiveShippingZones,
  getShippingZoneById,
  getShippingZoneByProvince,
  getShippingZoneByMunicipality,
  getShippingZoneForLocation,
  calculateShippingCost,
  getFreeShippingProvinces,
  getAllShippingZones,
  getShippingZonesForProvince,
  createShippingZone,
  updateShippingZone,
  toggleShippingZoneStatus,
  setFreeShipping
} from '@/lib/shippingService';
import { PUBLIC_READABLE_COLUMNS } from '@/lib/publicCatalogColumns';

const PUBLIC_PRODUCT_LIST = [
  'id', 'sku', 'name_es', 'name_en', 'description_es', 'description_en', 'category_id',
  'base_currency_id', 'final_price', 'weight', 'unit', 'dimensions', 'image_url', 'requires_expiry',
  'is_active', 'is_featured', 'tags', 'created_at', 'updated_at'
];
const PUBLIC_COMBO_LIST = [
  'id', 'name_es', 'name_en', 'description_es', 'description_en', 'image_url', 'final_price',
  'shipping_free', 'shipping_discount_percent', 'out_of_province_shipping',
  'out_of_province_price', 'is_active', 'is_featured', 'created_at', 'updated_at'
];
const PUBLIC_CATEGORY_LIST = [
  'id', 'slug', 'name_es', 'name_en', 'description_es', 'description_en', 'display_order', 'is_active'
];
const PUBLIC_INVENTORY_LIST = ['product_id', 'quantity', 'available_quantity', 'expiry_date'];
const PUBLIC_SHIPPING_LIST = [
  'id', 'province_name', 'municipality_name', 'shipping_cost', 'free_shipping', 'is_active'
];

const columnsOf = (select) =>
  splitSelect(select).filter((part) => !part.includes('('));

const expectNoWildcard = (selects) => {
  selects.forEach((select) => {
    expect(select, 'empty .select() would return every column').toBeTruthy();
    expect(splitSelect(select)).not.toContain('*');
    expect(String(select)).not.toMatch(/\(\s*\*\s*\)/);
  });
};

beforeEach(() => {
  recorder.reset();
  // Admin cost RPCs (Phase 0b): echo one cost row per requested id, or none when listing everything.
  recorder.client.rpc.mockReset();
  recorder.client.rpc.mockImplementation(async (_name, args) => ({
    data: (args?.p_ids ?? []).map((id) => ({ id, base_price: 4, profit_margin: 10, base_total_price: 4, transport_cost: 1 })),
    error: null
  }));
  recorder.results.products = () => ({ data: [{ id: 'p1' }], error: null });
  recorder.results.combo_products = () => ({ data: [{ id: 'c1' }], error: null });
  recorder.results.shipping_zones = () => ({ data: { id: 'z1', is_active: true }, error: null });
});

describe('public path: products', () => {
  it('getProductRows(false) requests only the public product columns', async () => {
    await getProductRows(false);
    const [select] = recorder.selects('products');
    expect(containsSensitiveColumn(select)).toEqual([]);
    expect(columnsOf(select)).toEqual(PUBLIC_PRODUCT_LIST);
    expect(select).toContain('category:product_categories(id, name_es, name_en, slug)');
  });

  it('getProducts() (public default) never asks for sensitive columns', async () => {
    await getProducts();
    recorder.allSelects().forEach(({ arg }) => {
      expect(containsSensitiveColumn(arg)).toEqual([]);
    });
  });

  it('getProductRows(true) (admin) reads the same public columns; costs come from the RPC (Phase 0b)', async () => {
    await getProductRows(true);
    const [select] = recorder.selects('products');
    expect(containsSensitiveColumn(select)).toEqual([]);
    expect(columnsOf(select)).toEqual(PUBLIC_PRODUCT_LIST);
  });

  it('getProductStock requests only the public inventory columns', async () => {
    await getProductStock();
    const [select] = recorder.selects('inventory');
    expect(containsSensitiveColumn(select)).toEqual([]);
    expect(columnsOf(select)).toEqual(PUBLIC_INVENTORY_LIST);
  });
});

describe('public path: categories', () => {
  it('getCategories() requests only the public category columns', async () => {
    await getCategories();
    expect(columnsOf(recorder.selects('product_categories')[0])).toEqual(PUBLIC_CATEGORY_LIST);
  });

  it('getCategories({ includeMargin: true }) (admin) reads the public columns; the margin comes from the RPC (Phase 0b)', async () => {
    await getCategories({ includeMargin: true });
    expect(columnsOf(recorder.selects('product_categories')[0])).toEqual(PUBLIC_CATEGORY_LIST);
  });
});

describe('public path: combos', () => {
  it('getCombos(false) requests only public combo columns and no base_price embed', async () => {
    await getCombos(false);
    const [comboSelect] = recorder.selects('combo_products');
    const [itemsSelect] = recorder.selects('combo_items');
    expect(containsSensitiveColumn(comboSelect)).toEqual([]);
    expect(columnsOf(comboSelect)).toEqual(PUBLIC_COMBO_LIST);
    expect(containsSensitiveColumn(itemsSelect)).toEqual([]);
    expect(itemsSelect).toContain('products(id, name_es, name_en)');
  });

  it('getCombos(true) (admin) reads public columns and the public item embed; costs come from the RPCs (Phase 0b)', async () => {
    await getCombos(true);
    const [comboSelect] = recorder.selects('combo_products');
    const [itemsSelect] = recorder.selects('combo_items');
    expect(containsSensitiveColumn(comboSelect)).toEqual([]);
    expect(columnsOf(comboSelect)).toEqual(PUBLIC_COMBO_LIST);
    expect(containsSensitiveColumn(itemsSelect)).toEqual([]);
  });
});

describe('public path: shipping zones', () => {
  it.each([
    ['getActiveShippingZones', () => getActiveShippingZones()],
    ['getShippingZoneById', () => getShippingZoneById('z1')],
    ['getShippingZoneByProvince', () => getShippingZoneByProvince('La Habana')],
    ['getShippingZoneByMunicipality', () => getShippingZoneByMunicipality('La Habana', 'Plaza')],
    ['getShippingZoneForLocation', () => getShippingZoneForLocation('La Habana', 'Plaza')],
    ['calculateShippingCost', () => calculateShippingCost('La Habana', 10, 'Plaza')],
    ['getFreeShippingProvinces', () => getFreeShippingProvinces()]
  ])('%s requests only public shipping columns', async (_name, run) => {
    recorder.results.shipping_zones = () => ({ data: [{ id: 'z1', shipping_cost: 5 }], error: null });
    await run().catch(() => undefined);
    const selects = recorder.selects('shipping_zones');
    expect(selects.length).toBeGreaterThan(0);
    selects.forEach((select) => {
      expect(containsSensitiveColumn(select)).toEqual([]);
      expect(columnsOf(select)).toEqual(PUBLIC_SHIPPING_LIST);
    });
  });
});

describe('admin shipping reads use an explicit list too (Phase 0b); transport_cost comes from the RPC', () => {
  it('getAllShippingZones and getShippingZonesForProvince never select *', async () => {
    recorder.results.shipping_zones = () => ({ data: [], error: null });
    await getAllShippingZones();
    await getShippingZonesForProvince('La Habana');
    const selects = recorder.selects('shipping_zones');
    expect(selects).toHaveLength(2);
    selects.forEach((select) => {
      expect(containsSensitiveColumn(select)).toEqual([]);
      expect(splitSelect(select)).not.toContain('*');
    });
  });
});

describe('admin writes: RETURNING carries an explicit public list, never an empty select', () => {
  const productInput = { name_es: 'P', basePrice: '10', category_id: 'cat', base_currency_id: 'usd' };

  const returningOf = (table) => {
    const selects = recorder.selects(table);
    expectNoWildcard(selects);
    return selects;
  };

  it('createProduct / updateProduct / setProductActiveState', async () => {
    recorder.results.products = () => ({ data: { id: 'p1' }, error: null });
    await createProduct(productInput);
    await updateProduct('p1', productInput);
    await setProductActiveState('p1', true).catch(() => undefined);
    const selects = returningOf('products');
    expect(selects.length).toBeGreaterThanOrEqual(3);
    selects
      .filter((select) => select !== 'id')
      .forEach((select) => {
        expect(containsSensitiveColumn(select)).toEqual([]);
        expect(columnsOf(select)).toEqual(PUBLIC_PRODUCT_LIST);
      });
  });

  it('createCategory / updateCategory', async () => {
    recorder.results.product_categories = () => ({ data: { id: 'cat', slug: 's' }, error: null });
    await createCategory({ es: 'A', en: 'A' });
    await updateCategory('cat', { es: 'A', en: 'A' });
    const selects = returningOf('product_categories');
    expect(selects).toHaveLength(2);
    selects.forEach((select) => {
      expect(containsSensitiveColumn(select)).toEqual([]);
      expect(columnsOf(select)).toEqual(PUBLIC_CATEGORY_LIST);
    });
  });

  it('createCombo / updateCombo / setComboActiveState', async () => {
    recorder.results.products = () => ({ data: [{ id: 'p1', base_price: 4 }], error: null });
    recorder.results.combo_products = () => ({ data: { id: 'c1' }, error: null });
    await createCombo({ name: 'C', productsWithQuantities: [{ productId: 'p1', quantity: 1 }] });
    await updateCombo('c1', { name: 'C', productsWithQuantities: [{ productId: 'p1', quantity: 1 }] });
    await setComboActiveState('c1', true);
    const selects = returningOf('combo_products');
    expect(selects).toHaveLength(3);
    selects.forEach((select) => {
      expect(containsSensitiveColumn(select)).toEqual([]);
      expect(columnsOf(select)).toEqual(PUBLIC_COMBO_LIST);
    });
  });

  it('createShippingZone / updateShippingZone / toggleShippingZoneStatus / setFreeShipping', async () => {
    recorder.results.shipping_zones = () => ({ data: { id: 'z1', is_active: true }, error: null });
    await createShippingZone({ provinceName: 'La Habana', transportCost: 3 });
    await updateShippingZone('z1', { shippingCost: 4 });
    await toggleShippingZoneStatus('z1');
    await setFreeShipping('z1', true);
    const selects = returningOf('shipping_zones').filter((select) => select !== 'is_active');
    expect(selects).toHaveLength(4);
    selects.forEach((select) => {
      expect(containsSensitiveColumn(select)).toEqual([]);
      expect(columnsOf(select)).toEqual(PUBLIC_SHIPPING_LIST);
    });
  });
});

describe('Phase 0b grant input: every column the public path touches stays readable', () => {
  // select list + embed columns + filter + order columns, per table, as PostgREST needs SELECT on all of them
  const touchedColumns = (table) => {
    const columns = new Set();
    const addSelect = (select) => {
      splitSelect(select).forEach((part) => {
        const embed = part.match(/^(?:\w+:)?(\w+)\((.*)\)$/);
        if (embed) {
          // embedded resource columns belong to the embedded table, covered by its own list
          return;
        }
        columns.add(part);
      });
    };
    recorder.queries
      .filter((query) => query.table === table)
      .forEach((query) => {
        query.calls.forEach(({ method, args }) => {
          if (method === 'select') addSelect(args[0]);
          if (['eq', 'neq', 'in', 'is', 'order', 'gt', 'lt'].includes(method)) columns.add(args[0]);
        });
      });
    return [...columns].sort();
  };

  const runPublicPath = async () => {
    recorder.results.shipping_zones = () => ({ data: [{ id: 'z1', shipping_cost: 5 }], error: null });
    await getProducts();
    await getCategories();
    await getCombos(false);
    await getActiveShippingZones();
    await getShippingZoneByProvince('La Habana').catch(() => undefined);
    await getShippingZoneByMunicipality('La Habana', 'Plaza').catch(() => undefined);
    await getFreeShippingProvinces();
  };

  it.each(Object.entries(PUBLIC_READABLE_COLUMNS))('%s: touched columns are within the declared readable set', async (table, declared) => {
    await runPublicPath();
    const touched = touchedColumns(table);
    expect(touched.length).toBeGreaterThan(0);
    touched.forEach((column) => expect(declared).toContain(column));
  });

  it('the declared sets never include a sensitive column', () => {
    Object.values(PUBLIC_READABLE_COLUMNS).flat().forEach((column) => {
      expect(containsSensitiveColumn(column)).toEqual([]);
    });
  });

  it('inventory keeps is_active and created_at readable (the stock query filters and orders by them)', () => {
    expect(PUBLIC_READABLE_COLUMNS.inventory).toEqual(expect.arrayContaining(['is_active', 'created_at']));
  });
});
