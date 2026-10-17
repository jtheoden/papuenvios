import { describe, it, expect, vi, beforeEach } from 'vitest';
import { splitSelect, containsSensitiveColumn } from './helpers/supabaseRecorder';

// Phase 0b: every admin read of cost / margin data goes through the admin_list_* RPCs (migration A).
// The services keep the data contract of the rows (same keys as before) and never fall back to a
// direct read of a hidden column.

const recorder = await vi.hoisted(async () => {
  const { createSupabaseRecorder } = await import('./helpers/supabaseRecorder');
  return createSupabaseRecorder();
});

vi.mock('@/lib/supabase', () => ({ supabase: recorder.client }));
vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/imageStorage', () => ({ resolveImageUrl: vi.fn().mockResolvedValue(null) }));

import {
  listProductCosts,
  listComboCosts,
  listCategoryMargins,
  listShippingZoneCosts,
  listInventoryCosts,
  ADMIN_COST_RPC_UNAVAILABLE
} from '@/lib/adminCostService';
import { getProductRows, getCategories } from '@/lib/productService';
import { getCombos, createCombo, updateCombo } from '@/lib/comboService';
import { getAllShippingZones, getShippingZonesForProvince } from '@/lib/shippingService';

const rpc = recorder.client.rpc;

/** rpc double: `handlers[name](args)` -> rows (or { error }). Unknown functions behave like a missing migration. */
const useRpc = (handlers) => {
  rpc.mockReset();
  rpc.mockImplementation(async (name, args) => {
    if (!handlers[name]) {
      return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${name} in the schema cache` } };
    }
    const out = handlers[name](args);
    return out?.error ? { data: null, error: out.error } : { data: out, error: null };
  });
};

const columnsOf = (select) => splitSelect(select).filter((part) => !part.includes('('));

beforeEach(() => {
  recorder.reset();
  rpc.mockReset();
});

describe('adminCostService', () => {
  it('calls the RPC with explicit pagination arguments and returns a Map keyed by id', async () => {
    useRpc({ admin_list_product_costs: () => [{ id: 'p1', base_price: '4.5', profit_margin: '30' }] });
    const costs = await listProductCosts();
    expect(rpc).toHaveBeenCalledWith('admin_list_product_costs', { p_limit: 500, p_offset: 0, p_ids: null });
    expect(costs.get('p1')).toEqual({ id: 'p1', base_price: '4.5', profit_margin: '30' });
  });

  it('keeps asking for pages until a short page comes back', async () => {
    const page = (n, start) => Array.from({ length: n }, (_, i) => ({ id: `p${start + i}`, base_price: 1, profit_margin: 1 }));
    const offsets = [];
    useRpc({
      admin_list_product_costs: ({ p_offset }) => {
        offsets.push(p_offset);
        return p_offset === 0 ? page(500, 0) : page(3, 500);
      }
    });
    const costs = await listProductCosts();
    expect(offsets).toEqual([0, 500]);
    expect(costs.size).toBe(503);
  });

  it('with ids it sends them in chunks and never lists the whole table', async () => {
    const seen = [];
    useRpc({ admin_list_product_costs: ({ p_ids }) => { seen.push(p_ids.length); return p_ids.map((id) => ({ id, base_price: 1, profit_margin: 1 })); } });
    const ids = Array.from({ length: 1200 }, (_, i) => `id-${i}`);
    const costs = await listProductCosts(ids);
    expect(seen).toEqual([500, 500, 200]);
    expect(costs.size).toBe(1200);
  });

  it('an empty id list does not call the database at all', async () => {
    useRpc({});
    const costs = await listProductCosts([]);
    expect(costs.size).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['listComboCosts', listComboCosts, 'admin_list_combo_costs'],
    ['listCategoryMargins', listCategoryMargins, 'admin_list_category_margins'],
    ['listShippingZoneCosts', listShippingZoneCosts, 'admin_list_shipping_zone_costs'],
    ['listInventoryCosts', listInventoryCosts, 'admin_list_inventory_costs']
  ])('%s uses its own RPC', async (_name, fn, rpcName) => {
    useRpc({ [rpcName]: () => [{ id: 'x1' }] });
    const costs = await fn();
    expect(rpc).toHaveBeenCalledWith(rpcName, { p_limit: 500, p_offset: 0, p_ids: null });
    expect(costs.has('x1')).toBe(true);
  });

  it('a missing function (migration not applied yet) is a clear, classified error - not a silent fallback', async () => {
    useRpc({});
    const error = await listProductCosts().catch((e) => e);
    expect(error.code).toBe(ADMIN_COST_RPC_UNAVAILABLE);
    expect(error.message).toMatch(/admin_list_product_costs/);
    expect(recorder.queries).toHaveLength(0);
  });

  it('a permission error keeps the 42501 so the caller can tell it from a load failure', async () => {
    useRpc({ admin_list_product_costs: () => ({ error: { code: '42501', message: 'insufficient_privilege' } }) });
    const error = await listProductCosts().catch((e) => e);
    expect(error.context?.postgresCode ?? error.code).toBe('42501');
    expect(error.code).not.toBe(ADMIN_COST_RPC_UNAVAILABLE);
  });
});

describe('admin products', () => {
  beforeEach(() => {
    recorder.results.products = () => ({ data: [{ id: 'p1', name_es: 'A', final_price: 5 }, { id: 'p2', name_es: 'B', final_price: 6 }], error: null });
    useRpc({ admin_list_product_costs: () => [{ id: 'p1', base_price: '4', profit_margin: '25' }] });
  });

  it('getProductRows(true) reads the public columns from the table and merges the cost from the RPC', async () => {
    const rows = await getProductRows(true);
    const [select] = recorder.selects('products');
    expect(containsSensitiveColumn(select)).toEqual([]);
    expect(splitSelect(select)).not.toContain('*');
    expect(rows[0]).toMatchObject({ id: 'p1', final_price: 5, base_price: '4', profit_margin: '25' });
    expect(rows[1].base_price).toBeUndefined();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('the admin view does not filter by is_active; the public view never calls the RPC', async () => {
    await getProductRows(true);
    const adminCalls = recorder.queries[0].calls.map((c) => c.method);
    expect(adminCalls).not.toContain('eq');
    recorder.reset();
    rpc.mockClear();
    await getProductRows(false);
    expect(recorder.queries[0].calls.map((c) => c.method)).toContain('eq');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('a failing cost RPC fails the admin load loudly (no half-loaded rows without costs)', async () => {
    useRpc({});
    await expect(getProductRows(true)).rejects.toMatchObject({ code: ADMIN_COST_RPC_UNAVAILABLE });
  });
});

describe('admin categories', () => {
  it('getCategories({ includeMargin: true }) merges profit_margin from the RPC (null stays null)', async () => {
    recorder.results.product_categories = () => ({ data: [{ id: 'c1' }, { id: 'c2' }], error: null });
    useRpc({ admin_list_category_margins: () => [{ id: 'c1', profit_margin: '12.5' }, { id: 'c2', profit_margin: null }] });
    const rows = await getCategories({ includeMargin: true });
    const [select] = recorder.selects('product_categories');
    expect(containsSensitiveColumn(select)).toEqual([]);
    expect(rows).toEqual([{ id: 'c1', profit_margin: '12.5' }, { id: 'c2', profit_margin: null }]);
  });

  it('getCategories() (public) never calls the RPC', async () => {
    recorder.results.product_categories = () => ({ data: [{ id: 'c1' }], error: null });
    useRpc({});
    await getCategories();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('admin combos', () => {
  beforeEach(() => {
    recorder.results.combo_products = () => ({ data: [{ id: 'k1', final_price: 20 }], error: null });
    recorder.results.combo_items = () => ({
      data: [{ combo_id: 'k1', quantity: 2, products: { id: 'p1', name_es: 'A', name_en: 'A' } }],
      error: null
    });
    useRpc({
      admin_list_combo_costs: () => [{ id: 'k1', base_total_price: '16', profit_margin: '25' }],
      admin_list_product_costs: ({ p_ids }) => (p_ids ? p_ids.map((id) => ({ id, base_price: '8', profit_margin: '10' })) : [])
    });
  });

  it('getCombos(true): public columns from the tables, costs merged from the RPCs, same row shape as before', async () => {
    const combos = await getCombos(true);
    const [comboSelect] = recorder.selects('combo_products');
    const [itemsSelect] = recorder.selects('combo_items');
    expect(containsSensitiveColumn(comboSelect)).toEqual([]);
    expect(containsSensitiveColumn(itemsSelect)).toEqual([]);
    expect(columnsOf(comboSelect)).not.toContain('*');
    expect(combos[0]).toMatchObject({ id: 'k1', final_price: 20, base_total_price: '16', profit_margin: '25' });
    expect(combos[0].items).toEqual([
      { quantity: 2, product: { id: 'p1', name_es: 'A', name_en: 'A', base_price: '8' } }
    ]);
  });

  it('getCombos(false) is the public view: no RPC at all', async () => {
    await getCombos(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('createCombo computes base_total_price from the RPC (and stops if the RPC is missing)', async () => {
    recorder.results.combo_products = () => ({ data: { id: 'k9' }, error: null });
    const created = await createCombo({ name: 'C', profitMargin: 10, productsWithQuantities: [{ productId: 'p1', quantity: 3 }] });
    expect(created).toBeTruthy();
    expect(recorder.selects('products')).toEqual([]);
    const insert = recorder.queries.find((q) => q.table === 'combo_products').calls.find((c) => c.method === 'insert');
    expect(insert.args[0][0].base_total_price).toBe(24);

    recorder.reset();
    useRpc({});
    await expect(
      createCombo({ name: 'C', productsWithQuantities: [{ productId: 'p1', quantity: 3 }] })
    ).rejects.toMatchObject({ code: ADMIN_COST_RPC_UNAVAILABLE });
    expect(recorder.queries.some((q) => q.table === 'combo_products')).toBe(false);
  });

  it('updateCombo recomputes base_total_price from the RPC and never reads products directly', async () => {
    recorder.results.combo_products = () => ({ data: { id: 'k1' }, error: null });
    await updateCombo('k1', { name: 'C', profitMargin: 10, productsWithQuantities: [{ productId: 'p1', quantity: 2 }] });
    expect(recorder.selects('products')).toEqual([]);
    const update = recorder.queries.find((q) => q.table === 'combo_products').calls.find((c) => c.method === 'update');
    expect(update.args[0].base_total_price).toBe(16);
  });
});

describe('admin shipping zones', () => {
  const ADMIN_ZONE = [
    'id', 'province_name', 'municipality_name', 'shipping_cost', 'is_active', 'free_shipping',
    'created_at', 'updated_at', 'delivery_days', 'delivery_note'
  ];

  beforeEach(() => {
    recorder.results.shipping_zones = () => ({ data: [{ id: 'z1', province_name: 'La Habana', shipping_cost: 5 }], error: null });
    useRpc({ admin_list_shipping_zone_costs: () => [{ id: 'z1', transport_cost: '2.5' }] });
  });

  it('getAllShippingZones: explicit non-sensitive columns (no select *), transport_cost merged from the RPC', async () => {
    const zones = await getAllShippingZones();
    const [select] = recorder.selects('shipping_zones');
    expect(columnsOf(select)).toEqual(ADMIN_ZONE);
    expect(containsSensitiveColumn(select)).toEqual([]);
    expect(zones[0]).toMatchObject({ id: 'z1', shipping_cost: 5, transport_cost: '2.5' });
  });

  it('getShippingZonesForProvince: same projection and merge, filtered by province', async () => {
    const zones = await getShippingZonesForProvince('La Habana');
    const [select] = recorder.selects('shipping_zones');
    expect(columnsOf(select)).toEqual(ADMIN_ZONE);
    expect(zones[0].transport_cost).toBe('2.5');
  });

  it('a zone with no cost row gets transport_cost 0 (the admin form default), not undefined', async () => {
    useRpc({ admin_list_shipping_zone_costs: () => [] });
    const zones = await getAllShippingZones();
    expect(zones[0].transport_cost).toBe(0);
  });
});
