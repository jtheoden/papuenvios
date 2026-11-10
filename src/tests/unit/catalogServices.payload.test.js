import { describe, it, expect, vi, beforeEach } from 'vitest';

// Records every query and lets each test control when a table "responds".
const calls = [];
const results = {};

const chain = (table) => {
  const record = { table, selects: [], filters: [] };
  calls.push(record);
  const c = {};
  c.select = vi.fn((arg) => {
    record.selects.push(arg);
    return c;
  });
  c.eq = vi.fn((...a) => {
    record.filters.push(['eq', ...a]);
    return c;
  });
  c.in = vi.fn((...a) => {
    record.filters.push(['in', ...a]);
    return c;
  });
  c.order = vi.fn(() => c);
  c.then = (resolve, reject) => Promise.resolve(results[table]()).then(resolve, reject);
  return c;
};

vi.mock('@/lib/supabase', () => ({ supabase: { from: (table) => chain(table) } }));
vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));

import { getProducts, getProductStock } from '@/lib/productService';
import { getCombos } from '@/lib/comboService';

const selectOf = (table) => calls.find((c) => c.table === table)?.selects[0] ?? '';
const columnsOf = (select) =>
  select
    .replace(/\w+:\w+\([^)]*\)/g, '')
    .replace(/\w+\([^)]*\)/g, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

describe('catalog payload: explicit columns', () => {
  beforeEach(() => {
    calls.length = 0;
    results.products = async () => ({ data: [{ id: 'p1' }], error: null });
    results.inventory = async () => ({ data: [], error: null });
    results.combo_products = async () => ({ data: [{ id: 'c1' }], error: null });
    results.combo_items = async () => ({ data: [], error: null });
  });

  it('getProducts never selects * nor the duplicated image_file column', async () => {
    await getProducts();
    const select = selectOf('products');
    expect(columnsOf(select)).not.toContain('*');
    expect(select).not.toContain('image_file');
    expect(columnsOf(select)).toContain('image_url');
    expect(select).toContain('category:product_categories(');
  });

  it('getCombos never selects * nor image_file', async () => {
    await getCombos();
    const select = selectOf('combo_products');
    expect(columnsOf(select)).not.toContain('*');
    expect(select).not.toContain('image_file');
    expect(columnsOf(select)).toContain('image_url');
  });
});

describe('catalog loading is parallel', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('getProducts queries inventory without waiting for products', async () => {
    let releaseProducts;
    results.products = () => new Promise((r) => { releaseProducts = () => r({ data: [{ id: 'p1' }], error: null }); });
    results.inventory = async () => ({ data: [], error: null });

    const pending = getProducts();
    await Promise.resolve();
    expect(calls.map((c) => c.table)).toEqual(expect.arrayContaining(['products', 'inventory']));
    releaseProducts();
    await pending;
  });

  it('getCombos queries combo_items without waiting for combo_products', async () => {
    let releaseCombos;
    results.combo_products = () => new Promise((r) => { releaseCombos = () => r({ data: [{ id: 'c1' }], error: null }); });
    results.combo_items = async () => ({ data: [], error: null });

    const pending = getCombos();
    await Promise.resolve();
    expect(calls.map((c) => c.table)).toEqual(expect.arrayContaining(['combo_products', 'combo_items']));
    releaseCombos();
    await pending;
  });
});

describe('getProducts / getProductStock behaviour', () => {
  beforeEach(() => {
    calls.length = 0;
    results.products = async () => ({ data: [{ id: 'p1' }, { id: 'p2' }], error: null });
  });

  it('merges summed available stock and first expiry date per product', async () => {
    results.inventory = async () => ({
      data: [
        { product_id: 'p1', available_quantity: 3, expiry_date: '2027-01-01' },
        { product_id: 'p1', available_quantity: 2, expiry_date: '2026-01-01' }
      ],
      error: null
    });
    const products = await getProducts();
    expect(products).toEqual([
      { id: 'p1', stock: 5, expiry_date: '2027-01-01' },
      { id: 'p2', stock: 0, expiry_date: null }
    ]);
  });

  it('returns [] when there are no products', async () => {
    results.products = async () => ({ data: [], error: null });
    results.inventory = async () => ({ data: [], error: null });
    expect(await getProducts()).toEqual([]);
  });

  it('keeps loading products when inventory fails', async () => {
    results.inventory = async () => ({ data: null, error: { message: 'boom' } });
    const products = await getProducts();
    expect(products.map((p) => p.stock)).toEqual([0, 0]);
  });

  it('getProductStock returns stock and expiry maps from inventory only', async () => {
    results.inventory = async () => ({
      data: [{ product_id: 'p1', available_quantity: 4, expiry_date: '2027-05-05' }],
      error: null
    });
    const result = await getProductStock();
    expect(result).toEqual({ stock: { p1: 4 }, expiry: { p1: '2027-05-05' } });
    expect(calls.map((c) => c.table)).toEqual(['inventory']);
  });

  it('getProductStock throws on error so callers can keep the previous values', async () => {
    results.inventory = async () => ({ data: null, error: { message: 'boom' } });
    await expect(getProductStock()).rejects.toBeTruthy();
  });
});
