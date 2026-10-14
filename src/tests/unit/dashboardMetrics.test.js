import { describe, it, expect } from 'vitest';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';
import {
  ACTIVE_ORDER_STATUSES,
  buildMarginLookup,
  estimateOrderProfit,
  computeOrderCounters,
  computeOrderTotals,
  computeOrderProfitTotals,
  computeCombinedRevenue
} from '@/lib/dashboardMetrics';

const NOW = new Date('2026-10-14T21:00:00Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600 * 1000).toISOString();
const daysAgo = (d) => hoursAgo(d * 24);

// Compact synthetic set reproducing the production numbers verified on 2026-10-14:
// daily 30.76 / monthly 1186.30 / yearly 1329.93 order revenue.
const buildOrders = (statusOfTheDayOrder) => [
  { id: 'o-day', status: statusOfTheDayOrder, payment_status: 'validated', total_amount: '30.76', shipping_cost: '0', discount_amount: '1.62', payment_method: 'zelle', created_at: hoursAgo(1) },
  { id: 'o-m1', status: 'completed', payment_status: 'validated', total_amount: '600.00', shipping_cost: '40', discount_amount: '0', payment_method: 'zelle', created_at: daysAgo(10) },
  { id: 'o-m2', status: 'delivered', payment_status: 'validated', total_amount: '555.54', shipping_cost: '49', discount_amount: '0', payment_method: 'zelle', created_at: daysAgo(20) },
  { id: 'o-y', status: 'processing', payment_status: 'validated', total_amount: '143.63', shipping_cost: '0', discount_amount: '0', payment_method: 'zelle', created_at: daysAgo(100) },
  { id: 'o-old', status: 'completed', payment_status: 'validated', total_amount: '99.99', shipping_cost: '0', discount_amount: '0', payment_method: 'zelle', created_at: daysAgo(400) },
  { id: 'o-cancel', status: 'cancelled', payment_status: 'validated', total_amount: '500.00', shipping_cost: '0', discount_amount: '0', payment_method: 'zelle', created_at: daysAgo(2) },
  { id: 'o-proof', status: 'pending', payment_status: 'proof_uploaded', total_amount: '41.96', shipping_cost: '0', discount_amount: '0', payment_method: 'zelle', created_at: daysAgo(1) }
];

describe('ACTIVE_ORDER_STATUSES', () => {
  it('is the single list of statuses that count as active business', () => {
    expect(ACTIVE_ORDER_STATUSES).toEqual(['processing', 'dispatched', 'delivered', 'completed']);
  });
});

describe('computeOrderTotals (H5)', () => {
  it.each(['processing', 'dispatched', 'delivered', 'completed'])(
    'yields 30.76 / 1186.30 / 1329.93 when the day order is %s',
    (status) => {
      const t = computeOrderTotals(buildOrders(status), NOW);
      expect(t.dailyRevenue).toBeCloseTo(30.76, 2);
      expect(t.monthlyRevenue).toBeCloseTo(1186.3, 2);
      expect(t.yearlyRevenue).toBeCloseTo(1329.93, 2);
    }
  );

  it('does not count cancelled or awaiting-validation orders as revenue', () => {
    const t = computeOrderTotals(buildOrders('dispatched'), NOW);
    expect(t.monthlyRevenue).toBeCloseTo(1186.3, 2);
  });

  it('drives shipping, discounts and payment breakdown from the same status list', () => {
    const t = computeOrderTotals(buildOrders('dispatched'), NOW);
    expect(t.monthlyShippingCost).toBeCloseTo(89, 2);
    expect(t.dailyDiscounts).toBeCloseTo(1.62, 2);
    expect(t.paymentMethodBreakdown.zelle.count).toBe(5);
    expect(t.paymentMethodBreakdown.zelle.total).toBeCloseTo(1429.92, 2);
  });
});

describe('computeCombinedRevenue (H9)', () => {
  it('adds remittance COMMISSION, never remittance volume', () => {
    const monthly = computeCombinedRevenue(1186.3, 23.14);
    expect(monthly).toBeCloseTo(1209.44, 2);
    expect(monthly).not.toBeCloseTo(1870.6, 2);
    expect(computeCombinedRevenue(1329.93, 23.14)).toBeCloseTo(1353.07, 2);
  });

  it('tolerates missing values', () => {
    expect(computeCombinedRevenue(undefined, null)).toBe(0);
  });
});

describe('computeOrderCounters (H10)', () => {
  it('counts proof_uploaded orders in their own row, Pedidos Pendientes and totalActive', () => {
    const c = computeOrderCounters(buildOrders('dispatched'));
    expect(c.proofToReview).toBe(1);
    expect(c.pendingOrders).toBe(1);
    expect(c.paymentPending).toBe(0);
    expect(c.paymentValidated).toBe(0);
    expect(c.dispatched).toBe(1);
    expect(c.processing).toBe(1);
    expect(c.delivered).toBe(1);
    expect(c.completedOrders).toBe(2);
    expect(c.cancelled).toBe(1);
    expect(c.totalActive).toBe(1 + 1 + 1 + 1);
  });

  it('keeps payment pending and payment validated semantics unchanged', () => {
    const orders = [
      { id: 'a', status: 'pending', payment_status: 'pending' },
      { id: 'b', status: 'pending', payment_status: 'validated' },
      { id: 'c', status: 'pending', payment_status: 'proof_uploaded' }
    ];
    const c = computeOrderCounters(orders);
    expect(c.paymentPending).toBe(1);
    expect(c.paymentValidated).toBe(1);
    expect(c.proofToReview).toBe(1);
    expect(c.pendingOrders).toBe(3);
    expect(c.totalActive).toBe(3);
  });

  it('does not double count any production (status, payment_status) combination', () => {
    const combos = [
      ['completed', 'validated', 14],
      ['delivered', 'validated', 2],
      ['dispatched', 'validated', 4],
      ['processing', 'validated', 4],
      ['pending', 'proof_uploaded', 1]
    ];
    const orders = combos.flatMap(([status, payment_status, n]) =>
      Array.from({ length: n }, (_, i) => ({ id: `${status}-${i}`, status, payment_status }))
    );
    const c = computeOrderCounters(orders);
    expect(c.proofToReview).toBe(1);
    expect(c.pendingOrders).toBe(1);
    expect(c.totalActive).toBe(1 + 4 + 4 + 2);
    expect(c.completedOrders).toBe(14);
  });
});

describe('buildMarginLookup', () => {
  it('resolves ids from products first, then combos', () => {
    const lookup = buildMarginLookup(
      [{ id: 'p1', profit_margin: '25' }],
      [{ id: 'c1', profit_margin: 50 }, { id: 'p1', profit_margin: 99 }]
    );
    expect(lookup.get('p1')).toBe(25);
    expect(lookup.get('c1')).toBe(50);
    expect(lookup.has('missing')).toBe(false);
  });

  it('skips null margins so they fall back', () => {
    const lookup = buildMarginLookup([{ id: 'p1', profit_margin: null }], []);
    expect(lookup.has('p1')).toBe(false);
  });
});

describe('estimateOrderProfit (H6)', () => {
  const lookup = buildMarginLookup(
    [{ id: 'p40', profit_margin: 40 }, { id: 'p25', profit_margin: 25 }],
    [{ id: 'c50', profit_margin: 50 }]
  );

  it('uses line total x m/(100+m), with per-product margins', () => {
    const items = [
      { item_type: 'product', item_id: 'p40', total_price: '140' },
      { item_type: 'product', item_id: 'p25', total_price: '125' }
    ];
    const r = estimateOrderProfit({ discount_amount: 0 }, items, lookup, 40);
    expect(r.profit).toBeCloseTo(40 + 25, 6);
    expect(r.fallbackLines).toBe(0);
  });

  it('subtracts the order discount and excludes shipping', () => {
    const items = [{ item_type: 'product', item_id: 'p40', total_price: 140 }];
    const r = estimateOrderProfit({ discount_amount: '1.62', shipping_cost: '50', total_amount: '188.38' }, items, lookup, 40);
    expect(r.profit).toBeCloseTo(40 - 1.62, 6);
  });

  it('falls back to the default margin and counts orphan lines', () => {
    const items = [
      { item_type: 'product', item_id: 'deleted', total_price: 140 },
      { item_type: 'combo', item_id: 'c50', total_price: 150 }
    ];
    const r = estimateOrderProfit({ discount_amount: 0 }, items, lookup, 40);
    expect(r.profit).toBeCloseTo(40 + 50, 6);
    expect(r.fallbackLines).toBe(1);
  });

  it('resolves mislabelled lines (item_type product with a combo id)', () => {
    const items = [{ item_type: 'product', item_id: 'c50', total_price: 150 }];
    const r = estimateOrderProfit({ discount_amount: 0 }, items, lookup, 40);
    expect(r.profit).toBeCloseTo(50, 6);
    expect(r.fallbackLines).toBe(0);
  });

  it('returns zero profit for an order without lines', () => {
    const r = estimateOrderProfit({ discount_amount: 0 }, [], lookup, 40);
    expect(r.profit).toBe(0);
  });
});

describe('computeOrderProfitTotals', () => {
  it('sums estimated profit of active orders per window and excludes inactive ones', () => {
    const orders = buildOrders('dispatched');
    const lookup = buildMarginLookup([{ id: 'p40', profit_margin: 40 }], []);
    const itemsByOrder = new Map([
      ['o-day', [{ item_type: 'product', item_id: 'p40', total_price: 140 }]],
      ['o-m1', [{ item_type: 'product', item_id: 'p40', total_price: 280 }]],
      ['o-y', [{ item_type: 'product', item_id: 'gone', total_price: 140 }]],
      ['o-cancel', [{ item_type: 'product', item_id: 'p40', total_price: 1400 }]]
    ]);
    const r = computeOrderProfitTotals(orders, itemsByOrder, lookup, 40, NOW);
    expect(r.dailyProfit).toBeCloseTo(40 - 1.62, 6);
    expect(r.monthlyProfit).toBeCloseTo(40 - 1.62 + 80, 6);
    expect(r.yearlyProfit).toBeCloseTo(40 - 1.62 + 80 + 40, 6);
    expect(r.fallbackLines).toBe(1);
  });
});

describe('dashboard translations (H10, H6)', () => {
  it.each([
    ['orderStatus.proofToReview'],
    ['estimatedProfit'],
    ['estimatedNetProfit'],
    ['profitFallbackNote']
  ])('has %s in ES and EN', (path) => {
    const get = (obj) => path.split('.').reduce((o, k) => o?.[k], obj.dashboard);
    expect(typeof get(ES)).toBe('string');
    expect(typeof get(EN)).toBe('string');
    expect(get(ES).length).toBeGreaterThan(0);
    expect(get(EN).length).toBeGreaterThan(0);
  });
});
