import { describe, it, expect, vi, beforeEach } from 'vitest';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';
import { computeCourierCostTotals } from '@/lib/dashboardMetrics';

const state = vi.hoisted(() => ({ pages: [], calls: [] }));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table) => {
      const chain = { table };
      ['select', 'order'].forEach((m) => { chain[m] = () => chain; });
      chain.range = (from, to) => {
        state.calls.push({ table, from, to });
        return Promise.resolve(state.pages.shift() ?? { data: [], error: null });
      };
      return chain;
    }
  }
}));

import { listOrderCourierCosts } from '@/lib/courierCostService';

const NOW = new Date('2026-10-14T21:00:00Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600 * 1000).toISOString();
const daysAgo = (d) => hoursAgo(d * 24);
const order = (id, status, created_at) => ({ id, status, created_at });

describe('computeCourierCostTotals', () => {
  const orders = [
    order('d', 'dispatched', hoursAgo(1)),
    order('m', 'completed', daysAgo(10)),
    order('y', 'delivered', daysAgo(100)),
    order('old', 'completed', daysAgo(400)),
    order('cancelled', 'cancelled', hoursAgo(2)),
    order('pending', 'pending', hoursAgo(2)),
    order('nullcost', 'processing', hoursAgo(3)),
    order('norow', 'processing', hoursAgo(4))
  ];
  const costs = new Map([
    ['d', 5.5],
    ['m', 4],
    ['y', 7.25],
    ['old', 9],
    ['cancelled', 20],
    ['pending', 20],
    ['nullcost', null]
  ]);

  it('sums only active orders per rolling window, like the other order figures', () => {
    const t = computeCourierCostTotals(orders, costs, NOW);
    expect(t.dailyCourierCost).toBe(5.5);
    expect(t.monthlyCourierCost).toBe(9.5);
    expect(t.yearlyCourierCost).toBe(16.75);
  });

  it('counts NULL and missing rows as unrecorded, never as a 0 cost', () => {
    const t = computeCourierCostTotals(orders, costs, NOW);
    expect(t.dailyCourierUnrecorded).toBe(2);
    expect(t.monthlyCourierUnrecorded).toBe(2);
    expect(t.yearlyCourierUnrecorded).toBe(2);
  });

  it('a recorded cost of 0 is a cost, not an unrecorded order', () => {
    const t = computeCourierCostTotals([order('z', 'completed', hoursAgo(1))], new Map([['z', 0]]), NOW);
    expect(t.dailyCourierCost).toBe(0);
    expect(t.dailyCourierUnrecorded).toBe(0);
  });

  it('avoids float drift when adding cents', () => {
    const o = [order('a', 'completed', hoursAgo(1)), order('b', 'completed', hoursAgo(1))];
    const t = computeCourierCostTotals(o, new Map([['a', 0.1], ['b', 0.2]]), NOW);
    expect(t.dailyCourierCost).toBe(0.3);
  });
});

describe('listOrderCourierCosts', () => {
  beforeEach(() => { state.pages = []; state.calls = []; });

  it('returns a Map order id -> amount (null kept as null)', async () => {
    state.pages = [{ data: [{ order_id: 'a', amount_usd: '5.50' }, { order_id: 'b', amount_usd: null }], error: null }];
    const map = await listOrderCourierCosts();
    expect(map.get('a')).toBe(5.5);
    expect(map.get('b')).toBeNull();
    expect(state.calls[0].table).toBe('order_courier_costs');
  });

  it('pages until a short page', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => ({ order_id: `o${i}`, amount_usd: '1' }));
    state.pages = [{ data: full, error: null }, { data: [{ order_id: 'last', amount_usd: '2' }], error: null }];
    const map = await listOrderCourierCosts();
    expect(map.size).toBe(1001);
    expect(state.calls.map((c) => c.from)).toEqual([0, 1000]);
  });

  it('throws on a read error instead of returning an empty map', async () => {
    state.pages = [{ data: null, error: { code: '42P01', message: 'relation "order_courier_costs" does not exist' } }];
    await expect(listOrderCourierCosts()).rejects.toBeTruthy();
  });
});

describe('dashboard courier translations', () => {
  const keysOf = (obj, prefix = '') =>
    Object.entries(obj ?? {}).flatMap(([k, v]) => (v && typeof v === 'object' ? keysOf(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
  const REQUIRED = ['shippingCollected', 'courier.title', 'courier.collected', 'courier.cost', 'courier.difference',
    'courier.unrecorded', 'courier.unavailable', 'courier.note', 'courier.loading'];
  const get = (d, key) => key.split('.').reduce((o, p) => o?.[p], d.dashboard);

  it('exist in ES and EN with identical keys and non-empty text', () => {
    expect(keysOf(ES.dashboard.courier).sort()).toEqual(keysOf(EN.dashboard.courier).sort());
    REQUIRED.forEach((key) => {
      expect(typeof get(ES, key)).toBe('string');
      expect(get(ES, key).trim()).not.toBe('');
      expect(typeof get(EN, key)).toBe('string');
      expect(get(EN, key).trim()).not.toBe('');
    });
  });

  it('relabels the old transport card as shipping charged to customers', () => {
    expect(ES.dashboard.transportCosts).toBeUndefined();
    expect(EN.dashboard.transportCosts).toBeUndefined();
    expect(EN.dashboard.shippingCollected).toMatch(/charged/i);
    expect(ES.dashboard.shippingCollected).toMatch(/cobrado/i);
  });
});
