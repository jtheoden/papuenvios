import { describe, it, expect, vi, beforeEach } from 'vitest';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';
import { computeCourierCostTotals, computeRemittanceCourierTotals } from '@/lib/dashboardMetrics';

// view: pages served by v_effective_courier_cost; null = the view does not exist yet (front deployed before the migrations)
const state = vi.hoisted(() => ({ pages: [], calls: [], view: null, viewCalls: [] }));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table) => {
      const chain = { table };
      ['select', 'order', 'eq'].forEach((m) => { chain[m] = (...args) => { if (m === 'eq') chain.eqArgs = args; return chain; }; });
      chain.range = (from, to) => {
        if (table === 'v_effective_courier_cost') {
          state.viewCalls.push({ from, to, eq: chain.eqArgs });
          return Promise.resolve(state.view ? (state.view.shift() ?? { data: [], error: null }) : { data: null, error: { code: '42P01', message: 'relation does not exist' } });
        }
        state.calls.push({ table, from, to });
        return Promise.resolve(state.pages.shift() ?? { data: [], error: null });
      };
      return chain;
    }
  }
}));

import { listOrderCourierCosts, listRemittanceCourierCosts } from '@/lib/courierCostService';

const NOW = new Date('2026-10-14T21:00:00Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600 * 1000).toISOString();
const daysAgo = (d) => hoursAgo(d * 24);
const order = (id, status, created_at) => ({ id, status, created_at, payment_status: 'validated', validated_at: created_at });

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

  it('sums only active orders per ET calendar window, like the other order figures', () => {
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

describe('computeCourierCostTotals: difference over the same set of orders (W2) and missing rows (W1)', () => {
  const o = (id, shipping_cost, zone, created = hoursAgo(1), status = 'completed') =>
    ({ id, status, created_at: created, payment_status: 'validated', validated_at: created, shipping_cost, shipping_zone_id: zone });

  it('compares charged vs courier only on orders WITH a recorded tariff', () => {
    const orders = [o('a', '10', 'z1'), o('b', '20', 'z2')]; // b has no row
    const t = computeCourierCostTotals(orders, new Map([['a', 6.5]]), NOW);
    expect(t.dailyCourierCollected).toBe(10);
    expect(t.dailyCourierCost).toBe(6.5);
    expect(t.dailyCourierDifference).toBe(3.5);
  });

  it('the difference is null (not 0) when no order of the window has a tariff', () => {
    const orders = [o('a', '10', 'z1'), o('b', '0', 'z1')];
    const t = computeCourierCostTotals(orders, new Map([['b', null]]), NOW);
    expect(t.dailyCourierDifference).toBeNull();
    expect(t.monthlyCourierDifference).toBeNull();
    expect(t.yearlyCourierDifference).toBeNull();
    expect(t.dailyCourierCollected).toBe(0);
  });

  it('a negative difference stays negative', () => {
    const t = computeCourierCostTotals([o('a', '2', 'z1')], new Map([['a', 5]]), NOW);
    expect(t.dailyCourierDifference).toBe(-3);
  });

  describe('missingRow cutoff (recordingStart = created_at of the oldest snapshot row)', () => {
    const CUT = hoursAgo(10);

    it('is 0 when there is no cutoff (empty table: "no traffic yet" cannot be told from a failure)', () => {
      const orders = [o('a', '5', 'z1', hoursAgo(1))];
      const t = computeCourierCostTotals(orders, new Map(), NOW, null);
      expect(t.dailyCourierMissingRow).toBe(0);
      expect(t.yearlyCourierMissingRow).toBe(0);
      expect(t.dailyCourierUnrecorded).toBe(1);
      expect(computeCourierCostTotals(orders, new Map(), NOW).yearlyCourierMissingRow).toBe(0);
    });

    it('does not count an order older than the cutoff, it stays unrecorded', () => {
      const t = computeCourierCostTotals([o('old', '5', 'z1', hoursAgo(20))], new Map(), NOW, CUT);
      expect(t.monthlyCourierMissingRow).toBe(0);
      expect(t.monthlyCourierUnrecorded).toBe(1);
    });

    it('counts a newer order with zone and no row', () => {
      const t = computeCourierCostTotals([o('new', '5', 'z1', hoursAgo(2))], new Map(), NOW, CUT);
      expect(t.dailyCourierMissingRow).toBe(1);
      expect(t.dailyCourierUnrecorded).toBe(0);
    });

    it('is strict: an order created exactly at the cutoff is not counted', () => {
      const t = computeCourierCostTotals([o('eq', '5', 'z1', CUT)], new Map(), NOW, CUT);
      expect(t.yearlyCourierMissingRow).toBe(0);
    });

    it('compares instants, not strings (different offsets, same instant ordering)', () => {
      const cut = '2026-10-14T10:00:00+00:00';
      const after = '2026-10-14T08:00:01-03:00'; // 11:00:01Z, later than the cutoff but a "smaller" string
      const before = '2026-10-14T06:59:59-03:00'; // 09:59:59Z, earlier
      const t = computeCourierCostTotals([o('after', '5', 'z1', after), o('before', '5', 'z1', before)], new Map(), NOW, cut);
      expect(t.yearlyCourierMissingRow).toBe(1);
    });

    it('a row with NULL amount, or an order without zone, is never missingRow', () => {
      const orders = [o('nullrow', '5', 'z1', hoursAgo(2)), o('nozone', '5', null, hoursAgo(2))];
      const t = computeCourierCostTotals(orders, new Map([['nullrow', null]]), NOW, CUT);
      expect(t.dailyCourierMissingRow).toBe(0);
      expect(t.dailyCourierUnrecorded).toBe(2);
    });

    it('mix: only post-cutoff, zoned, row-less, active orders count', () => {
      const orders = [
        o('missing', '5', 'z1', hoursAgo(2)), // counts
        o('old', '5', 'z1', hoursAgo(30)), // before cutoff
        o('nullrow', '5', 'z1', hoursAgo(3)),
        o('nozone', '5', null, hoursAgo(3)),
        o('ok', '5', 'z1', hoursAgo(4)),
        o('cancelled', '5', 'z1', hoursAgo(2), 'cancelled')
      ];
      const t = computeCourierCostTotals(orders, new Map([['nullrow', null], ['ok', 2]]), NOW, CUT);
      expect(t.monthlyCourierMissingRow).toBe(1);
      expect(t.monthlyCourierUnrecorded).toBe(3); // old, nullrow, nozone
    });
  });

  it('ignores cancelled and out-of-window orders for every figure', () => {
    const orders = [o('c', '9', 'z1', hoursAgo(1), 'cancelled'), o('old', '9', 'z1', daysAgo(400))];
    const t = computeCourierCostTotals(orders, new Map(), NOW, daysAgo(500));
    expect(t.yearlyCourierMissingRow).toBe(0);
    expect(t.yearlyCourierCollected).toBe(0);
    expect(t.yearlyCourierDifference).toBeNull();
  });
});

describe('computeRemittanceCourierTotals', () => {
  const rem = (id, extra = {}) => ({
    id, status: 'processing', payment_validated_at: hoursAgo(1), created_at: hoursAgo(2),
    delivery_cost: '15', shipping_zone_id: 'z1', ...extra
  });

  it('sums the courier cost and the delivery charge of the same remittances, dated by payment_validated_at', () => {
    const t = computeRemittanceCourierTotals([rem('a')], new Map([['a', 4]]), NOW, hoursAgo(5));
    expect(t.dailyRemittanceCourierCost).toBe(4);
    expect(t.dailyRemittanceCourierCollected).toBe(15);
    expect(t.dailyRemittanceCourierDifference).toBe(11);
    expect(t.yearlyRemittanceCourierCost).toBe(4);
  });

  it('ignores remittances without a delivery zone, not validated ones and validations outside the window', () => {
    const rows = [
      rem('nozone', { shipping_zone_id: null, delivery_cost: '0' }),
      rem('pending', { status: 'payment_pending' }),
      rem('old', { payment_validated_at: hoursAgo(24 * 60) })
    ];
    const t = computeRemittanceCourierTotals(rows, new Map([['nozone', 9], ['pending', 9], ['old', 9]]), NOW, hoursAgo(5));
    expect(t.dailyRemittanceCourierCost).toBe(0);
    expect(t.dailyRemittanceCourierUnrecorded).toBe(0);
    expect(t.monthlyRemittanceCourierCost).toBe(0);
    expect(t.yearlyRemittanceCourierCost).toBe(9); // only 'old' falls in the year
  });

  it('separates "no tariff recorded" from a cost of zero: the difference is null (n/a)', () => {
    const t = computeRemittanceCourierTotals([rem('a')], new Map([['a', null]]), NOW, hoursAgo(5));
    expect(t.dailyRemittanceCourierCost).toBe(0);
    expect(t.dailyRemittanceCourierUnrecorded).toBe(1);
    expect(t.dailyRemittanceCourierDifference).toBeNull();
  });

  it('flags a remittance created after the first snapshot that has no row as missing', () => {
    const t = computeRemittanceCourierTotals([rem('a')], new Map(), NOW, hoursAgo(10));
    expect(t.dailyRemittanceCourierMissingRow).toBe(1);
    const legacy = computeRemittanceCourierTotals([rem('a', { created_at: hoursAgo(20) })], new Map(), NOW, hoursAgo(10));
    expect(legacy.dailyRemittanceCourierMissingRow).toBe(0);
    expect(legacy.dailyRemittanceCourierUnrecorded).toBe(1);
  });
});

describe('listRemittanceCourierCosts', () => {
  beforeEach(() => { state.pages = []; state.calls = []; });

  it('reads remittance_courier_costs into a Map remittance id -> amount with firstRecordedAt', async () => {
    state.pages = [{ data: [{ remittance_id: 'r1', amount_usd: '4.00', created_at: '2026-10-14T10:00:00Z' }, { remittance_id: 'r2', amount_usd: null, created_at: '2026-10-14T11:00:00Z' }], error: null }];
    const map = await listRemittanceCourierCosts();
    expect(state.calls[0].table).toBe('remittance_courier_costs');
    expect(map.get('r1')).toBe(4);
    expect(map.get('r2')).toBeNull();
    expect(map.firstRecordedAt).toBe('2026-10-14T10:00:00.000Z');
  });

  it('throws when the table cannot be read (not deployed yet)', async () => {
    state.pages = [{ data: null, error: { code: '42P01', message: 'relation does not exist' } }];
    await expect(listRemittanceCourierCosts()).rejects.toBeTruthy();
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

  it('exposes firstRecordedAt as the oldest created_at as an ISO instant, null when empty', async () => {
    state.pages = [{ data: [
      { order_id: 'a', amount_usd: '1', created_at: '2026-10-14T08:00:00-03:00' },
      { order_id: 'b', amount_usd: null, created_at: '2026-10-14T10:00:00+00:00' },
      { order_id: 'c', amount_usd: '2', created_at: null }
    ], error: null }];
    expect((await listOrderCourierCosts()).firstRecordedAt).toBe('2026-10-14T10:00:00.000Z');
    state.pages = [{ data: [], error: null }];
    expect((await listOrderCourierCosts()).firstRecordedAt).toBeNull();
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

describe('courier costs read the effective view first (no double counting), legacy tables only before the migrations', () => {
  beforeEach(() => { state.pages = []; state.calls = []; state.view = null; state.viewCalls = []; });

  it('reads v_effective_courier_cost filtered by kind and never touches the legacy table when the view exists', async () => {
    state.view = [{ data: [
      { source_id: 'a', amount_usd: '5.50', recorded_at: '2026-10-14T10:00:00Z' },
      { source_id: 'b', amount_usd: null, recorded_at: '2026-10-14T09:00:00Z' }
    ], error: null }];
    const map = await listOrderCourierCosts();
    expect(state.viewCalls[0].eq).toEqual(['source_kind', 'order']);
    expect(state.calls).toEqual([]);
    expect(map.get('a')).toBe(5.5);
    expect(map.get('b')).toBeNull();
    expect(map.firstRecordedAt).toBe('2026-10-14T09:00:00.000Z');
  });

  it('uses the remittance kind for remittances', async () => {
    state.view = [{ data: [{ source_id: 'r1', amount_usd: '4', recorded_at: '2026-10-14T10:00:00Z' }], error: null }];
    const map = await listRemittanceCourierCosts();
    expect(state.viewCalls[0].eq).toEqual(['source_kind', 'remittance']);
    expect(map.get('r1')).toBe(4);
  });

  it.each(['42P01', 'PGRST205'])('falls back to the legacy table when the view is missing (%s)', async (code) => {
    state.view = [{ data: null, error: { code, message: 'missing' } }];
    state.pages = [{ data: [{ order_id: 'a', amount_usd: '5.50', created_at: '2026-10-14T10:00:00Z' }], error: null }];
    const map = await listOrderCourierCosts();
    expect(state.calls[0].table).toBe('order_courier_costs');
    expect(map.get('a')).toBe(5.5);
  });

  it('throws on any other view error instead of falling back (a half-read would double count)', async () => {
    state.view = [{ data: null, error: { code: '42501', message: 'permission denied' } }];
    await expect(listOrderCourierCosts()).rejects.toBeTruthy();
    expect(state.calls).toEqual([]);
  });
});

describe('dashboard courier translations', () => {
  const keysOf = (obj, prefix = '') =>
    Object.entries(obj ?? {}).flatMap(([k, v]) => (v && typeof v === 'object' ? keysOf(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
  const REQUIRED = ['shippingCollected', 'courier.title', 'courier.collected', 'courier.cost', 'courier.difference',
    'courier.unrecorded', 'courier.unavailable', 'courier.note', 'courier.loading', 'courier.collectedCompared',
    'courier.notAvailable', 'courier.missingRow'];
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
