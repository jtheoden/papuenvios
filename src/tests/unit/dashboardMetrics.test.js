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
  computeHeadline,
  computeOrderCosts,
  computeRemittanceTotals,
  computeZelleTotals,
  getBusinessWindows
} from '@/lib/dashboardMetrics';

const NOW = new Date('2026-10-14T21:00:00Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600 * 1000).toISOString();
const daysAgo = (d) => hoursAgo(d * 24);

// Compact synthetic set reproducing the production numbers verified on 2026-10-14:
// daily 30.76 / monthly 1186.30 / yearly 1329.93 order revenue. NOW is 17:00 ET on Oct 14, so
// the calendar month starts on Oct 1 and every "monthly" order sits between Oct 2 and Oct 14.
// Orders are dated by validated_at (equal to created_at here unless a test overrides it).
const buildOrders = (statusOfTheDayOrder) => [
  { id: 'o-day', status: statusOfTheDayOrder, payment_status: 'validated', total_amount: '30.76', shipping_cost: '0', discount_amount: '1.62', payment_method: 'zelle', created_at: hoursAgo(1) },
  { id: 'o-m1', status: 'completed', payment_status: 'validated', total_amount: '600.00', shipping_cost: '40', discount_amount: '0', payment_method: 'zelle', created_at: daysAgo(10) },
  { id: 'o-m2', status: 'delivered', payment_status: 'validated', total_amount: '555.54', shipping_cost: '49', discount_amount: '0', payment_method: 'zelle', created_at: daysAgo(12) },
  { id: 'o-y', status: 'processing', payment_status: 'validated', total_amount: '143.63', shipping_cost: '0', discount_amount: '0', payment_method: 'zelle', created_at: daysAgo(100) },
  { id: 'o-old', status: 'completed', payment_status: 'validated', total_amount: '99.99', shipping_cost: '0', discount_amount: '0', payment_method: 'zelle', created_at: daysAgo(400) },
  { id: 'o-cancel', status: 'cancelled', payment_status: 'validated', total_amount: '500.00', shipping_cost: '0', discount_amount: '0', payment_method: 'zelle', created_at: daysAgo(2) },
  { id: 'o-proof', status: 'pending', payment_status: 'proof_uploaded', total_amount: '41.96', shipping_cost: '0', discount_amount: '0', payment_method: 'zelle', created_at: daysAgo(1) }
].map((o) => ({ ...o, validated_at: o.payment_status === 'validated' ? o.created_at : null }));

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

describe('computeOrderTotals dating (D5)', () => {
  const base = { status: 'completed', payment_status: 'validated', shipping_cost: '0', discount_amount: '0', payment_method: 'zelle' };

  it('dates an order by validated_at, not created_at', () => {
    const orders = [{ ...base, id: 'late', total_amount: '80', created_at: daysAgo(5), validated_at: hoursAgo(1) }];
    expect(computeOrderTotals(orders, NOW).dailyRevenue).toBe(80);
  });

  it('ignores an order created today but validated in an earlier month', () => {
    const orders = [{ ...base, id: 'old', total_amount: '80', created_at: hoursAgo(1), validated_at: daysAgo(40) }];
    const t = computeOrderTotals(orders, NOW);
    expect(t.dailyRevenue).toBe(0);
    expect(t.monthlyRevenue).toBe(0);
    expect(t.yearlyRevenue).toBe(80);
  });

  it('requires payment_status validated: a rejected order with validated_at never counts', () => {
    const orders = [{ ...base, id: 'rej', payment_status: 'rejected', total_amount: '80', created_at: hoursAgo(2), validated_at: hoursAgo(1) }];
    expect(computeOrderTotals(orders, NOW).dailyRevenue).toBe(0);
  });

  it('does not count an active order that has no validated_at', () => {
    const orders = [{ ...base, id: 'nodate', total_amount: '80', created_at: hoursAgo(2), validated_at: null }];
    expect(computeOrderTotals(orders, NOW).dailyRevenue).toBe(0);
  });

  it('rounds the sums to cents', () => {
    const orders = ['0.1', '0.2'].map((n, i) => ({ ...base, id: `r${i}`, total_amount: n, created_at: hoursAgo(1), validated_at: hoursAgo(1) }));
    expect(computeOrderTotals(orders, NOW).dailyRevenue).toBe(0.3);
  });
});

describe('getBusinessWindows (D6, America/New_York)', () => {
  const iso = (d) => d.toISOString();

  it('starts today at midnight ET (EDT, UTC-4)', () => {
    const w = getBusinessWindows(new Date('2026-10-14T21:00:00Z'));
    expect(iso(w.daily)).toBe('2026-10-14T04:00:00.000Z');
    expect(iso(w.monthly)).toBe('2026-10-01T04:00:00.000Z');
    expect(iso(w.yearly)).toBe('2026-01-01T05:00:00.000Z');
  });

  it('23:59:59 ET is still the previous day, 00:00:00 ET opens the new one', () => {
    expect(iso(getBusinessWindows(new Date('2026-10-15T03:59:59Z')).daily)).toBe('2026-10-14T04:00:00.000Z');
    expect(iso(getBusinessWindows(new Date('2026-10-15T04:00:00Z')).daily)).toBe('2026-10-15T04:00:00.000Z');
  });

  it('spring forward (2026-03-08): the day starts at EST, the month too', () => {
    const w = getBusinessWindows(new Date('2026-03-08T12:00:00Z'));
    expect(iso(w.daily)).toBe('2026-03-08T05:00:00.000Z');
    expect(iso(w.monthly)).toBe('2026-03-01T05:00:00.000Z');
  });

  it('fall back (2026-11-01): the month starts at EDT, the next day at EST', () => {
    expect(iso(getBusinessWindows(new Date('2026-11-01T12:00:00Z')).daily)).toBe('2026-11-01T04:00:00.000Z');
    const next = getBusinessWindows(new Date('2026-11-02T12:00:00Z'));
    expect(iso(next.daily)).toBe('2026-11-02T05:00:00.000Z');
    expect(iso(next.monthly)).toBe('2026-11-01T04:00:00.000Z');
  });

  it('keeps an order validated at 23:59:59 ET yesterday out of today but inside the month', () => {
    const order = { id: 'e', status: 'completed', payment_status: 'validated', total_amount: '10', shipping_cost: '0', discount_amount: '0', validated_at: '2026-10-15T03:59:59Z' };
    const t = computeOrderTotals([order], new Date('2026-10-15T04:00:01Z'));
    expect(t.dailyRevenue).toBe(0);
    expect(t.monthlyRevenue).toBe(10);
  });
});

describe('computeHeadline (D1)', () => {
  it('separates sales (gross orders), net income (order profit + remittance commission) and collected (cash)', () => {
    const h = computeHeadline({ orderRevenue: 1186.3, orderProfit: 78.38, remittanceCommission: 23.14, remittanceVolume: 684.3 });
    expect(h.sales).toBe(1186.3);
    expect(h.netIncome).toBe(101.52);
    expect(h.collected).toBe(1870.6);
  });

  it('treats the delivery charge as income and the remittance courier cost as a cost (owner decision)', () => {
    const h = computeHeadline({ orderRevenue: 100, orderProfit: 10, remittanceCommission: 2.5, remittanceVolume: 100, remittanceDeliveryCharge: 15, remittanceCourierCost: 4 });
    expect(h.collected).toBe(215);
    expect(h.deliveryCharge).toBe(15);
    expect(h.netIncome).toBe(23.5); // 10 + 2.5 + 15 - 4
  });

  it('tolerates missing values', () => {
    expect(computeHeadline({})).toEqual({ sales: 0, netIncome: 0, collected: 0, deliveryCharge: 0 });
  });
});

describe('computeOrderCosts (W6)', () => {
  it('excludes the shipping charged from the costs row', () => {
    // revenue 100 = items 90 + shipping 10; profit 30 -> real costs are 60, not 70
    expect(computeOrderCosts(100, 10, 30)).toBe(60);
  });
});

describe('computeRemittanceTotals (D4)', () => {
  const rem = (id, status, validatedAt, extra = {}) => ({
    id, status, commission_total: '2.50', amount_sent: '100', discount_amount: '0',
    payment_validated_at: validatedAt, delivered_at: null, completed_at: null, ...extra
  });

  it('counts a remittance validated one hour ago as daily income and volume', () => {
    const t = computeRemittanceTotals([rem('a', 'payment_validated', hoursAgo(1))], NOW);
    expect(t.dailyRemittanceIncome).toBe(2.5);
    expect(t.dailyRemittanceVolume).toBe(100);
    expect(t.monthlyRemittanceIncome).toBe(2.5);
    expect(t.yearlyRemittanceIncome).toBe(2.5);
  });

  it.each(['processing', 'delivered', 'completed'])('counts %s remittances by payment_validated_at too', (status) => {
    const t = computeRemittanceTotals([rem('a', status, hoursAgo(1), { delivered_at: daysAgo(40) })], NOW);
    expect(t.dailyRemittanceIncome).toBe(2.5);
  });

  it.each(['payment_pending', 'payment_proof_uploaded', 'payment_rejected', 'cancelled'])('does not count %s remittances', (status) => {
    const t = computeRemittanceTotals([rem('a', status, hoursAgo(1))], NOW);
    expect(t.dailyRemittanceIncome).toBe(0);
    expect(t.yearlyRemittanceVolume).toBe(0);
  });

  it('does not count a remittance without payment_validated_at, even with a recent updated_at', () => {
    const r = rem('a', 'delivered', null, { delivered_at: hoursAgo(1), updated_at: hoursAgo(1), created_at: hoursAgo(1) });
    expect(computeRemittanceTotals([r], NOW).dailyRemittanceIncome).toBe(0);
  });

  it('takes commission_total as is (override and discount already applied) and sums discounts by validation date', () => {
    const t = computeRemittanceTotals([rem('a', 'completed', hoursAgo(1), { commission_total: '1.75', discount_amount: '0.75' })], NOW);
    expect(t.dailyRemittanceIncome).toBe(1.75);
    expect(t.dailyRemittanceDiscounts).toBe(0.75);
  });

  it('sums delivery_cost as the delivery charge by payment_validated_at, for validated statuses only', () => {
    const rows = [
      rem('cash', 'processing', hoursAgo(1), { delivery_cost: '15' }),
      rem('old', 'completed', daysAgo(40), { delivery_cost: '15' }),
      rem('pending', 'payment_pending', hoursAgo(1), { delivery_cost: '15' }),
      rem('none', 'processing', hoursAgo(1), { delivery_cost: null })
    ];
    const t = computeRemittanceTotals(rows, NOW);
    expect(t.dailyRemittanceDeliveryCharge).toBe(15);
    expect(t.yearlyRemittanceDeliveryCharge).toBe(30);
    // never part of the income or the payout
    expect(t.dailyRemittanceIncome).toBe(5);
  });

  it('rounds sums to cents', () => {
    const rows = ['0.1', '0.2'].map((c, i) => rem(`r${i}`, 'processing', hoursAgo(1), { commission_total: c }));
    expect(computeRemittanceTotals(rows, NOW).dailyRemittanceIncome).toBe(0.3);
  });

  it('keeps the payout out of validation: only delivered/completed remittances pay out, by delivered_at', () => {
    const rows = [
      rem('validated', 'payment_validated', hoursAgo(1)),
      rem('processing', 'processing', hoursAgo(1)),
      rem('delivered', 'delivered', daysAgo(30), { delivered_at: hoursAgo(1) }),
      rem('completed-old', 'completed', daysAgo(30), { delivered_at: daysAgo(3) })
    ];
    const t = computeRemittanceTotals(rows, NOW);
    expect(t.dailyRemittancePayout).toBe(97.5);
    expect(t.monthlyRemittancePayout).toBe(195);
    // volume follows the validation date, so the two old validations are outside the month
    expect(t.monthlyRemittanceVolume).toBe(200);
  });

  it('reports the liability: validated and processing remittances not yet delivered', () => {
    const rows = [
      rem('v', 'payment_validated', daysAgo(40)),
      rem('p', 'processing', daysAgo(2), { amount_sent: '50', commission_total: '1' }),
      rem('d', 'delivered', daysAgo(2), { delivered_at: daysAgo(1) }),
      rem('w', 'payment_pending', null)
    ];
    const t = computeRemittanceTotals(rows, NOW);
    expect(t.pendingDeliveryAmount).toBe(146.5);
    expect(t.pendingDeliveryCount).toBe(2);
  });

  it('counts completed the same everywhere: delivered + completed', () => {
    const rows = [rem('a', 'delivered', hoursAgo(1)), rem('b', 'completed', hoursAgo(1)), rem('c', 'processing', hoursAgo(1))];
    const t = computeRemittanceTotals(rows, NOW);
    expect(t.completedRemittances).toBe(2);
    expect(t.totalRemittances).toBe(3);
    expect(t.pendingRemittances).toBe(1);
  });
});

describe('computeZelleTotals (D6)', () => {
  it('uses ET calendar windows and rounds', () => {
    const tx = [
      { amount: '0.1', transaction_date: hoursAgo(1) },
      { amount: '0.2', transaction_date: hoursAgo(2) },
      { amount: '50', transaction_date: daysAgo(5) },
      { amount: '7', transaction_date: daysAgo(100) }
    ];
    const t = computeZelleTotals(tx, NOW);
    expect(t.dailyZelleTotal).toBe(0.3);
    expect(t.monthlyZelleTotal).toBe(50.3);
    expect(t.yearlyZelleTotal).toBe(57.3);
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
