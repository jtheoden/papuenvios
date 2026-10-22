/**
 * Dashboard financial calculations (pure, no React, no Supabase).
 *
 * Metric definitions (shown to the admin as tooltips):
 *  - Sales:      gross `total_amount` of validated, active orders (includes shipping and the cost of goods).
 *  - Net income: estimated order profit + remittance commission (what the business keeps).
 *  - Collected:  cash flow = validated order totals + validated remittance `amount_sent`.
 * Orders are dated by `validated_at`, remittances by `payment_validated_at`; windows are calendar
 * day / month / year in the business time zone (America/New_York, same as the Zelle limits).
 * The remittance delivery charge (delivery_cost) is income and part of Collected; its courier (transport) cost is a cost.
 */
import { roundMoney } from '@/lib/moneyPure';

/**
 * Single source of truth for the order statuses that count as active business.
 * Drives revenue, shipping, discounts, payment-method breakdown and profit.
 */
export const ACTIVE_ORDER_STATUSES = ['processing', 'dispatched', 'delivered', 'completed'];

/** Remittance statuses whose payment was validated: they count as income from payment_validated_at. */
export const REMITTANCE_REVENUE_STATUSES = ['payment_validated', 'processing', 'delivered', 'completed'];
/** Validated but not yet handed to the recipient: the "pending delivery" liability. */
export const REMITTANCE_UNDELIVERED_STATUSES = ['payment_validated', 'processing'];
/** Handed to the recipient: payout and the "Completed" counter everywhere. */
export const REMITTANCE_DELIVERED_STATUSES = ['delivered', 'completed'];
const REMITTANCE_PENDING_STATUSES = ['payment_pending', 'payment_proof_uploaded', 'payment_rejected', 'payment_validated', 'processing'];

export const BUSINESS_TIME_ZONE = 'America/New_York';

const toNumber = (value) => {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
};

const WINDOW_NAMES = ['daily', 'monthly', 'yearly'];

/** Wall-clock parts of an instant in `timeZone`, as numbers. */
const wallClock = (formatter, ms) => {
  const parts = {};
  formatter.formatToParts(new Date(ms)).forEach(({ type, value }) => {
    parts[type] = Number(value);
  });
  return parts;
};

/** timeZone wall clock minus UTC, in ms, at the given instant (negative for New York). */
const zoneOffsetMs = (formatter, ms) => {
  const w = wallClock(formatter, ms);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(ms / 1000) * 1000;
};

/** The instant at which the wall clock of `timeZone` reads year-month-day 00:00:00. */
const zonedMidnight = (formatter, year, month, day) => {
  const guess = Date.UTC(year, month - 1, day);
  const first = guess - zoneOffsetMs(formatter, guess);
  // Second pass settles the offset when the guess falls on the other side of a DST change.
  return new Date(guess - zoneOffsetMs(formatter, first));
};

/**
 * Start instants of the current calendar day, month and year in the business time zone.
 * Every window runs from its start up to "now".
 */
export const getBusinessWindows = (now = new Date(), timeZone = BUSINESS_TIME_ZONE) => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric'
  });
  const today = wallClock(formatter, now.getTime());
  return {
    daily: zonedMidnight(formatter, today.year, today.month, today.day),
    monthly: zonedMidnight(formatter, today.year, today.month, 1),
    yearly: zonedMidnight(formatter, today.year, 1, 1)
  };
};

/** Sum of `pick(row)` over rows whose `dateOf(row)` is on/after `since`. Rows without a date never count. */
const sumSince = (rows, dateOf, since, pick) =>
  rows.reduce((sum, row) => {
    const date = dateOf(row);
    return date && new Date(date) >= since ? sum + pick(row) : sum;
  }, 0);

/** Rounded daily/monthly/yearly sums under `${window}${name}` keys. */
const sumByWindow = (w, name, rows, dateOf, pick) =>
  Object.fromEntries(WINDOW_NAMES.map((k) => [`${k}${name}`, roundMoney(sumSince(rows, dateOf, w[k], pick))]));

const isActive = (order) => ACTIVE_ORDER_STATUSES.includes(order.status);

/** Business an order counts for: active status, payment validated, dated by validated_at (D5). */
const isRecognizedOrder = (order) => isActive(order) && order.payment_status === 'validated' && Boolean(order.validated_at);
const orderDate = (order) => order.validated_at;

const sumRecognizedSince = (orders, since, pick) =>
  sumSince(orders.filter(isRecognizedOrder), orderDate, since, pick);

/**
 * Revenue, shipping, discounts (per business window) and payment-method breakdown
 * for validated, active orders.
 */
export const computeOrderTotals = (orders, now = new Date()) => {
  const w = getBusinessWindows(now);
  const recognized = orders.filter(isRecognizedOrder);
  const total = (o) => toNumber(o.total_amount);

  const paymentMethodBreakdown = {};
  orders.filter(isActive).forEach((o) => {
    const method = o.payment_method || 'unknown';
    if (!paymentMethodBreakdown[method]) paymentMethodBreakdown[method] = { count: 0, total: 0 };
    paymentMethodBreakdown[method].count += 1;
    paymentMethodBreakdown[method].total = roundMoney(paymentMethodBreakdown[method].total + total(o));
  });

  return {
    ...sumByWindow(w, 'Revenue', recognized, orderDate, total),
    ...sumByWindow(w, 'ShippingCost', recognized, orderDate, (o) => toNumber(o.shipping_cost)),
    ...sumByWindow(w, 'Discounts', recognized, orderDate, (o) => toNumber(o.discount_amount)),
    paymentMethodBreakdown
  };
};

/**
 * Courier (mensajeria) cost per business window, validated active orders only (same filter and windows as the
 * other order figures). `costByOrder` is order id -> USD amount | null (service listOrderCourierCosts).
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
export const computeCourierCostTotals = (orders, costByOrder, now = new Date(), recordingStart = null) =>
  buildCourierTotals({
    rows: orders.filter(isRecognizedOrder),
    dateOf: orderDate,
    chargedOf: (o) => toNumber(o.shipping_cost),
    costByKey: costByOrder,
    hasZone: (o) => Boolean(o.shipping_zone_id),
    now,
    recordingStart,
    prefix: 'Courier'
  });

/**
 * Shared bucket logic of the courier cost cards (orders and remittances). Rows must already be the
 * business-recognized ones; `hasZone(row)` false rows are not courier deliveries when `skipNoZone` is set.
 */
function buildCourierTotals({ rows, dateOf, chargedOf, costByKey, hasZone, now, recordingStart, prefix, skipNoZone = false }) {
  const w = getBusinessWindows(now);
  const startMs = recordingStart ? Date.parse(recordingStart) : NaN;
  const included = skipNoZone ? rows.filter(hasZone) : rows;
  const amountOf = (r) => {
    const amount = costByKey.get(r.id);
    return amount === null || amount === undefined ? null : toNumber(amount);
  };
  const kind = (r) => {
    if (amountOf(r) !== null) return 'tariff';
    if (!costByKey.has(r.id) && hasZone(r) && Date.parse(r.created_at) > startMs) return 'missingRow';
    return 'unrecorded';
  };
  const sumKind = (since, wanted, pick) => roundMoney(sumSince(included, dateOf, since, (r) => (kind(r) === wanted ? pick(r) : 0)));
  const count = (since, wanted) => sumSince(included, dateOf, since, (r) => (kind(r) === wanted ? 1 : 0));

  const forWindow = (since, name) => {
    const cost = sumKind(since, 'tariff', amountOf);
    const collected = sumKind(since, 'tariff', chargedOf);
    return {
      [`${name}${prefix}Cost`]: cost,
      [`${name}${prefix}Collected`]: collected,
      [`${name}${prefix}Difference`]: count(since, 'tariff') === 0 ? null : roundMoney(collected - cost),
      [`${name}${prefix}Unrecorded`]: count(since, 'unrecorded'),
      [`${name}${prefix}MissingRow`]: count(since, 'missingRow')
    };
  };
  return { ...forWindow(w.daily, 'daily'), ...forWindow(w.monthly, 'monthly'), ...forWindow(w.yearly, 'yearly') };
}

/**
 * Courier (transport) cost of remittances delivered in cash, same buckets as the orders card. Only validated
 * remittances WITH a delivery zone are courier deliveries; they are dated by payment_validated_at.
 * `costByRemittance` is remittance id -> USD amount | null (service listRemittanceCourierCosts).
 */
export const computeRemittanceCourierTotals = (remittances, costByRemittance, now = new Date(), recordingStart = null) =>
  buildCourierTotals({
    rows: remittances.filter((r) => REMITTANCE_REVENUE_STATUSES.includes(r.status)),
    dateOf: (r) => r.payment_validated_at,
    chargedOf: (r) => toNumber(r.delivery_cost),
    costByKey: costByRemittance,
    hasZone: (r) => Boolean(r.shipping_zone_id),
    now,
    recordingStart,
    prefix: 'RemittanceCourier',
    skipNoZone: true
  });

/**
 * Remittance figures. Income (commission), volume sent and discounts count from PAYMENT VALIDATION
 * (payment_validated_at) for statuses payment_validated, processing, delivered and completed (D4); a row without
 * payment_validated_at never counts (no updated_at fallback). commission_total is already net of discount and override.
 *
 * The payout (amount_sent - commission_total) is what has actually been handed over, so it follows
 * delivered/completed by delivered_at (completed_at as legacy fallback). The validated-but-undelivered remainder is
 * the "pending delivery" liability: an instantaneous figure, not a window.
 */
export const computeRemittanceTotals = (remittances, now = new Date()) => {
  const w = getBusinessWindows(now);
  const validated = remittances.filter((r) => REMITTANCE_REVENUE_STATUSES.includes(r.status));
  const delivered = remittances.filter((r) => REMITTANCE_DELIVERED_STATUSES.includes(r.status));
  const undelivered = remittances.filter((r) => REMITTANCE_UNDELIVERED_STATUSES.includes(r.status));
  const validatedAt = (r) => r.payment_validated_at;
  const deliveredAt = (r) => r.delivered_at || r.completed_at;
  const toDeliver = (r) => toNumber(r.amount_sent) - toNumber(r.commission_total);

  return {
    ...sumByWindow(w, 'RemittanceIncome', validated, validatedAt, (r) => toNumber(r.commission_total)),
    ...sumByWindow(w, 'RemittanceVolume', validated, validatedAt, (r) => toNumber(r.amount_sent)),
    ...sumByWindow(w, 'RemittanceDeliveryCharge', validated, validatedAt, (r) => toNumber(r.delivery_cost)),
    ...sumByWindow(w, 'RemittanceDiscounts', validated, validatedAt, (r) => toNumber(r.discount_amount)),
    ...sumByWindow(w, 'RemittancePayout', delivered, deliveredAt, toDeliver),
    pendingDeliveryAmount: roundMoney(undelivered.reduce((sum, r) => sum + toDeliver(r), 0)),
    pendingDeliveryCount: undelivered.length,
    totalRemittances: remittances.length,
    pendingRemittances: remittances.filter((r) => REMITTANCE_PENDING_STATUSES.includes(r.status)).length,
    completedRemittances: delivered.length
  };
};

/** Validated Zelle payments per business window (USD). */
export const computeZelleTotals = (transactions, now = new Date()) => {
  const w = getBusinessWindows(now);
  return sumByWindow(w, 'ZelleTotal', transactions, (tx) => tx.transaction_date, (tx) => toNumber(tx.amount));
};

/**
 * Headline figures of one window (D1). Sales and net income are different things, so they are not added:
 * net income = order profit + remittance commission + remittance delivery charge (delivery_cost, income per the
 * owner) - remittance courier cost (transport, only where a snapshot exists); collected = cash in (orders total +
 * remittance amount_sent + delivery charge, which the customer pays on top of amount_sent).
 */
export const computeHeadline = ({ orderRevenue, orderProfit, remittanceCommission, remittanceVolume, remittanceDeliveryCharge, remittanceCourierCost } = {}) => ({
  sales: roundMoney(toNumber(orderRevenue)),
  netIncome: roundMoney(
    toNumber(orderProfit) + toNumber(remittanceCommission) + toNumber(remittanceDeliveryCharge) - toNumber(remittanceCourierCost)
  ),
  collected: roundMoney(toNumber(orderRevenue) + toNumber(remittanceVolume) + toNumber(remittanceDeliveryCharge)),
  deliveryCharge: roundMoney(toNumber(remittanceDeliveryCharge))
});

/**
 * Order costs row: revenue minus the shipping charged (a pass-through, shown on its own row) minus profit.
 */
export const computeOrderCosts = (revenue, shipping, profit) =>
  roundMoney(toNumber(revenue) - toNumber(shipping) - toNumber(profit));

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
 * Estimated order profit per business window (validated, active orders only).
 * @param {Map<string, Array>} itemsByOrder order id -> order_items rows
 */
export const computeOrderProfitTotals = (orders, itemsByOrder, marginLookup, fallbackMargin, now = new Date()) => {
  const w = getBusinessWindows(now);
  const totals = { dailyProfit: 0, monthlyProfit: 0, yearlyProfit: 0, fallbackLines: 0 };

  orders.filter(isRecognizedOrder).forEach((order) => {
    const validated = new Date(orderDate(order));
    if (validated < w.yearly) return;
    const { profit, fallbackLines } = estimateOrderProfit(
      order,
      itemsByOrder.get(order.id) || [],
      marginLookup,
      fallbackMargin
    );
    totals.yearlyProfit += profit;
    if (validated >= w.monthly) totals.monthlyProfit += profit;
    if (validated >= w.daily) totals.dailyProfit += profit;
    totals.fallbackLines += fallbackLines;
  });
  return {
    ...totals,
    dailyProfit: roundMoney(totals.dailyProfit),
    monthlyProfit: roundMoney(totals.monthlyProfit),
    yearlyProfit: roundMoney(totals.yearlyProfit)
  };
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
