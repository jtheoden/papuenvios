/**
 * Dashboard financial calculations (pure, no React, no Supabase).
 */

/**
 * Single source of truth for the order statuses that count as active business.
 * Drives revenue, shipping, discounts, payment-method breakdown and profit.
 */
export const ACTIVE_ORDER_STATUSES = ['processing', 'dispatched', 'delivered', 'completed'];

const DAY_MS = 24 * 60 * 60 * 1000;

const toNumber = (value) => {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
};

const getWindows = (now) => ({
  daily: new Date(now.getTime() - DAY_MS),
  monthly: new Date(now.getTime() - 30 * DAY_MS),
  yearly: new Date(now.getTime() - 365 * DAY_MS)
});

const isActive = (order) => ACTIVE_ORDER_STATUSES.includes(order.status);

const sumActiveSince = (orders, since, pick) =>
  orders
    .filter((o) => isActive(o) && new Date(o.created_at) >= since)
    .reduce((sum, o) => sum + pick(o), 0);

/**
 * Revenue, shipping, discounts (per rolling window) and payment-method breakdown
 * for active orders.
 */
export const computeOrderTotals = (orders, now = new Date()) => {
  const w = getWindows(now);
  const total = (o) => toNumber(o.total_amount);
  const shipping = (o) => toNumber(o.shipping_cost);
  const discount = (o) => toNumber(o.discount_amount);

  const paymentMethodBreakdown = {};
  orders.filter(isActive).forEach((o) => {
    const method = o.payment_method || 'unknown';
    if (!paymentMethodBreakdown[method]) paymentMethodBreakdown[method] = { count: 0, total: 0 };
    paymentMethodBreakdown[method].count += 1;
    paymentMethodBreakdown[method].total += total(o);
  });

  return {
    dailyRevenue: sumActiveSince(orders, w.daily, total),
    monthlyRevenue: sumActiveSince(orders, w.monthly, total),
    yearlyRevenue: sumActiveSince(orders, w.yearly, total),
    dailyShippingCost: sumActiveSince(orders, w.daily, shipping),
    monthlyShippingCost: sumActiveSince(orders, w.monthly, shipping),
    yearlyShippingCost: sumActiveSince(orders, w.yearly, shipping),
    dailyDiscounts: sumActiveSince(orders, w.daily, discount),
    monthlyDiscounts: sumActiveSince(orders, w.monthly, discount),
    yearlyDiscounts: sumActiveSince(orders, w.yearly, discount),
    paymentMethodBreakdown
  };
};

const roundCents = (value) => Math.round(value * 100) / 100;

/**
 * Courier (mensajeria) cost per rolling window, active orders only (same filter and windows as the other
 * order figures). `costByOrder` is order id -> USD amount | null (service listOrderCourierCosts).
 *
 * Every active order falls in exactly one bucket:
 *  - with tariff:  row with a non-null amount. Only these feed the cost and the difference, so
 *                  difference = charged(with tariff) - cost compares the SAME set of orders.
 *  - unrecorded:   row with a NULL amount (the zone had no tariff) or an order without shipping_zone_id.
 *  - missingRow:   shipping_zone_id present, no row at all, and created AFTER `recordingStart` (created_at of the
 *                  oldest snapshot row = when the feature started recording): a trigger failure (it only logs a
 *                  WARNING). Orders from before that instant (no backfill) stay "unrecorded". Without a
 *                  `recordingStart` (empty table) it is 0: "no traffic yet" cannot be told from a failure.
 *                  shortcut: strict `>` because an order is never created after its own snapshot, so the first
 *                  order that fails (it would be the oldest one) is not detected; accepted, upgrade by storing an
 *                  explicit activation timestamp.
 * The difference is null (shown as n/a) when no order of the window has a tariff: an unknown is not a 0.
 */
export const computeCourierCostTotals = (orders, costByOrder, now = new Date(), recordingStart = null) => {
  const w = getWindows(now);
  const startMs = recordingStart ? Date.parse(recordingStart) : NaN;
  const amountOf = (o) => {
    const amount = costByOrder.get(o.id);
    return amount === null || amount === undefined ? null : toNumber(amount);
  };
  const kind = (o) => {
    if (amountOf(o) !== null) return 'tariff';
    if (!costByOrder.has(o.id) && o.shipping_zone_id && Date.parse(o.created_at) > startMs) return 'missingRow';
    return 'unrecorded';
  };
  const count = (since, wanted) => sumActiveSince(orders, since, (o) => (kind(o) === wanted ? 1 : 0));
  const withTariff = (since, pick) => roundCents(sumActiveSince(orders, since, (o) => (kind(o) === 'tariff' ? pick(o) : 0)));

  const forWindow = (since, prefix) => {
    const cost = withTariff(since, amountOf);
    const collected = withTariff(since, (o) => toNumber(o.shipping_cost));
    return {
      [`${prefix}CourierCost`]: cost,
      [`${prefix}CourierCollected`]: collected,
      [`${prefix}CourierDifference`]: count(since, 'tariff') === 0 ? null : roundCents(collected - cost),
      [`${prefix}CourierUnrecorded`]: count(since, 'unrecorded'),
      [`${prefix}CourierMissingRow`]: count(since, 'missingRow')
    };
  };

  return { ...forWindow(w.daily, 'daily'), ...forWindow(w.monthly, 'monthly'), ...forWindow(w.yearly, 'yearly') };
};

/**
 * Headline combined revenue = order revenue + remittance COMMISSION income.
 * Remittance volume sent is money moved, not income, and must not be added here.
 */
export const computeCombinedRevenue = (orderRevenue, remittanceCommission) =>
  toNumber(orderRevenue) + toNumber(remittanceCommission);

/**
 * Order counters. Buckets are keyed on status, except the payment buckets that
 * only look at orders still in status 'pending':
 * - paymentPending:   payment_status 'pending' (kept as it was, any status)
 * - paymentValidated: payment_status 'validated' and status 'pending'
 * - proofToReview:    payment_status 'proof_uploaded' and status 'pending'
 */
export const computeOrderCounters = (orders) => {
  const count = (fn) => orders.filter(fn).length;
  const paymentPending = count((o) => o.payment_status === 'pending');
  const paymentValidated = count((o) => o.payment_status === 'validated' && o.status === 'pending');
  const proofToReview = count((o) => o.payment_status === 'proof_uploaded' && o.status === 'pending');
  const processing = count((o) => o.status === 'processing');
  const dispatched = count((o) => o.status === 'dispatched');
  const delivered = count((o) => o.status === 'delivered');
  const completedOrders = count((o) => o.status === 'completed');
  const cancelled = count((o) => o.status === 'cancelled');

  return {
    paymentPending,
    paymentValidated,
    proofToReview,
    processing,
    dispatched,
    delivered,
    completedOrders,
    cancelled,
    pendingOrders: paymentPending + paymentValidated + proofToReview,
    totalActive: paymentPending + paymentValidated + proofToReview + processing + dispatched + delivered
  };
};

/**
 * Map of item id -> profit margin percent. Products take precedence over
 * combos when an id appears in both. Null/invalid margins are left out so the
 * caller falls back to the default margin.
 */
export const buildMarginLookup = (products = [], combos = []) => {
  const lookup = new Map();
  const add = (rows) =>
    rows.forEach((row) => {
      if (lookup.has(row.id)) return;
      if (row.profit_margin === null || row.profit_margin === undefined || row.profit_margin === '') return;
      const m = Number(row.profit_margin);
      if (Number.isFinite(m)) lookup.set(row.id, m);
    });
  add(products);
  add(combos);
  return lookup;
};

/**
 * ESTIMATED profit of one order.
 *
 * Assumptions (change here if the business rule changes):
 * - Line total_price is the selling price BEFORE the order discount and WITHOUT shipping.
 * - The margin m is a markup on cost, so profit inside a price P is P * m / (100 + m).
 * - The order discount comes out of the margin.
 * - Shipping is excluded.
 * - The margin is resolved by item id (products first, then combos), regardless of
 *   item_type, because some lines are mislabelled. Unknown ids use fallbackMargin
 *   and are counted in fallbackLines.
 *
 * @returns {{ profit: number, fallbackLines: number }}
 */
export const estimateOrderProfit = (order, items, marginLookup, fallbackMargin) => {
  let profit = 0;
  let fallbackLines = 0;
  (items || []).forEach((item) => {
    let m = marginLookup.get(item.item_id);
    if (m === undefined) {
      m = toNumber(fallbackMargin);
      fallbackLines += 1;
    }
    profit += (toNumber(item.total_price) * m) / (100 + m);
  });
  if (!(items && items.length)) return { profit: 0, fallbackLines: 0 };
  return { profit: profit - toNumber(order.discount_amount), fallbackLines };
};

/**
 * Estimated order profit per rolling window (active orders only).
 * @param {Map<string, Array>} itemsByOrder order id -> order_items rows
 */
export const computeOrderProfitTotals = (orders, itemsByOrder, marginLookup, fallbackMargin, now = new Date()) => {
  const w = getWindows(now);
  const totals = { dailyProfit: 0, monthlyProfit: 0, yearlyProfit: 0, fallbackLines: 0 };

  orders.filter(isActive).forEach((order) => {
    const created = new Date(order.created_at);
    if (created < w.yearly) return;
    const { profit, fallbackLines } = estimateOrderProfit(
      order,
      itemsByOrder.get(order.id) || [],
      marginLookup,
      fallbackMargin
    );
    totals.yearlyProfit += profit;
    if (created >= w.monthly) totals.monthlyProfit += profit;
    if (created >= w.daily) totals.dailyProfit += profit;
    totals.fallbackLines += fallbackLines;
  });
  return totals;
};

/** Group order_items rows by order id. */
export const groupItemsByOrder = (items = []) => {
  const map = new Map();
  items.forEach((item) => {
    if (!map.has(item.order_id)) map.set(item.order_id, []);
    map.get(item.order_id).push(item);
  });
  return map;
};
