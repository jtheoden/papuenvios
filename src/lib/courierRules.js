/**
 * Pure rules of the courier-management module (no Supabase import: safe for components and tests).
 * OWNER RULE: no amount, percentage, threshold, rate or tier is defined here. Everything numeric comes from the admin
 * (rule form, simulator inputs) or from the database. The calculations only mirror the SQL ones
 * (_courier_compute_accrual, _operation_margin) so the simulator shows what the database will do.
 */
import { roundMoney, roundTo } from './moneyPure';

export const RULE_METHODS = ['fixed_amount', 'fixed_cup', 'per_usd_delivered', 'percent_of_base'];
export const RULE_APPLIES_TO = ['remittance', 'order', 'both'];
export const RULE_BASES = ['nominal_usd', 'delivered_cup'];
export const RULE_CURRENCIES = ['USD', 'CUP'];
/** none: any value; gt: "more than X" (X, inf); lte: "up to Y (included)" [0, Y]; between: "more than X and up to Y" (X, Y]. */
export const RANGE_OPERATORS = ['none', 'gt', 'lte', 'between'];

const MARGIN_TOLERANCE = 0.005;
const isNum = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const num = (v) => (isNum(v) ? Number(v) : null);

// ---------------------------------------------------------------------------------------------------------------------
// Money in integer cents (ranges and fixed amounts are compared exactly, never as floats)
// ---------------------------------------------------------------------------------------------------------------------
const MONEY = /^\d+(\.\d{1,2})?$/;
/** '100.01' -> 10001; anything that is not a non-negative amount with at most 2 decimals -> null. */
export const toCents = (value) => {
  if (value === null || value === undefined) return null;
  const text = typeof value === 'number' ? String(value) : String(value).trim();
  if (!MONEY.test(text)) return null;
  const [units, decimals = ''] = text.split('.');
  return Number(units) * 100 + Number(decimals.padEnd(2, '0'));
};
export const centsToText = (cents) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
const centsOrNull = (v) => (v === null || v === undefined || v === '' ? null : toCents(v));

/** Range of the form in cents: { from, to } with from = exclusive lower bound, to = inclusive upper bound (null = open). */
export const rangeFromForm = ({ rangeOp, rangeX, rangeY } = {}) => ({
  from: rangeOp === 'gt' || rangeOp === 'between' ? toCents(rangeX) : null,
  to: rangeOp === 'lte' || rangeOp === 'between' ? toCents(rangeY) : null
});
/** Stored amount_from / amount_to -> operator fields of the form. */
export const formFromRange = (from, to) => {
  const has = (v) => v !== null && v !== undefined && v !== '';
  const rangeOp = has(from) && has(to) ? 'between' : has(from) ? 'gt' : has(to) ? 'lte' : 'none';
  return { rangeOp, rangeX: has(from) ? String(from) : '', rangeY: has(to) ? String(to) : '' };
};

/** (from, to] intervals in cents; from null covers 0.00, to null has no end. */
export const rangesOverlap = (a, b) =>
  (a.from ?? -1) < (b.to ?? Infinity) && (b.from ?? -1) < (a.to ?? Infinity);

/** Values left without a range, same shape and semantics as SQL _courier_rule_coverage. */
export const coverageGaps = (ranges) => {
  const gaps = [];
  let covered = -1; // every value <= covered is covered; -1 = nothing yet (0.00 still needed)
  const sorted = [...ranges].sort((a, b) => (a.from ?? -1) - (b.from ?? -1) || (a.to ?? Infinity) - (b.to ?? Infinity));
  for (const r of sorted) {
    const lo = r.from ?? -1;
    if (lo > covered) gaps.push({ from: covered >= 0 ? covered : null, to: lo });
    if (r.to === null || r.to === undefined) return gaps;
    covered = Math.max(covered, r.to);
  }
  gaps.push({ from: covered >= 0 ? covered : null, to: null });
  return gaps;
};

const kindsOf = (appliesTo) => (appliesTo === 'both' ? ['remittance', 'order'] : [appliesTo]);
const sameId = (a, b) => (a || null) === (b || null);
const time = (value, empty) => (value ? new Date(value).getTime() : empty);

/**
 * Client twin of the RPC checks on save, with the same validity-window rules: overlap of a tramo and another currency in
 * a tiered scope count against rules whose window INTERSECTS the new one; gaps count only rules spanning the WHOLE new
 * window (_courier_rule_coverage). An unreadable date decides nothing here: the server has the last word.
 */
export const analyzeRuleConflicts = (form, rules = [], now = Date.now()) => {
  const range = rangeFromForm(form);
  const none = { overlap: false, mixedCurrency: false, gaps: [] };
  if (range.from === null && range.to === null) return none;
  const from = time(form.validFrom, now);
  const to = time(form.validTo, Infinity);
  if (Number.isNaN(from) || Number.isNaN(to)) return none;
  const window = (r) => ({ from: time(r.valid_from, -Infinity), to: time(r.valid_to, Infinity) });
  const intersects = (r) => window(r).from < to && from < window(r).to;
  const spans = (r) => window(r).from <= from && (window(r).to === Infinity || (to !== Infinity && window(r).to >= to));
  const scope = (rules || []).filter((r) => r.is_active && r.code !== String(form.code ?? '').trim()
    && sameId(r.courier_id, form.courierId) && sameId(r.shipping_zone_id, form.zoneId) && sameId(r.remittance_type_id, form.typeId));
  const tiered = (r) => r.amount_from !== null || r.amount_to !== null;
  const toRange = (r) => ({ from: centsOrNull(r.amount_from), to: centsOrNull(r.amount_to) });
  const result = { ...none };
  kindsOf(form.appliesTo).forEach((kind) => {
    const sameKind = scope.filter((r) => r.applies_to === kind || r.applies_to === 'both');
    const ladder = sameKind.filter(tiered);
    const live = ladder.filter(intersects);
    if (live.some((r) => (r.currency || 'USD') !== form.currency)) result.mixedCurrency = true;
    if (live.some((r) => rangesOverlap(toRange(r), range))) result.overlap = true;
    if (!sameKind.some((r) => !tiered(r) && spans(r))) {
      result.gaps.push(...coverageGaps([...ladder.filter((r) => spans(r) && (r.currency || 'USD') === form.currency).map(toRange), range])
        .map((g) => ({ kind, ...g })));
    }
  });
  return result;
};

/** Gaps (in cents) carried by a coverage_gap refusal of the RPC (DETAIL = JSON); null when it is another error. */
export const coverageGapsFromError = (error) => {
  if (!String(error?.message || '').includes('coverage_gap')) return null;
  try {
    const parsed = JSON.parse(error.details);
    return (parsed.gaps || []).map((g) => ({ kind: g.kind, from: centsOrNull(g.from), to: centsOrNull(g.to) }));
  } catch {
    return [];
  }
};

/** Ids in logs/UI are truncated (no full identifier of a person or operation leaves the screen). */
export const shortId = (id) => (typeof id === 'string' && id ? id.slice(0, 8) : '');

/**
 * Margin of one operation, twin of SQL _operation_margin. Unknown cost, income or a non-positive base => 'unknown'
 * (never 0). With both thresholds null there is nothing to judge against: 'unknown', never 'ok'. A single null threshold never alerts. Comparison in cents with a 0.005 tolerance (inclusive at the limit).
 * @returns {{ marginUsd: number|null, marginPct: number|null, status: 'ok'|'warning'|'critical'|'unknown' }}
 */
export const computeOperationMargin = ({ base, income, cost, warningPct = null, criticalPct = null } = {}) => {
  const b = num(base);
  const i = num(income);
  const c = num(cost);
  if (b === null || b <= 0 || i === null || c === null) return { marginUsd: null, marginPct: null, status: 'unknown' };
  const marginUsd = roundMoney(i - c);
  const marginPct = roundTo((marginUsd / b) * 100, 4);
  const below = (pct) => num(pct) !== null && marginUsd + MARGIN_TOLERANCE < (b * Number(pct)) / 100;
  const noThresholds = num(warningPct) === null && num(criticalPct) === null;
  const status = noThresholds ? 'unknown' : below(criticalPct) ? 'critical' : below(warningPct) ? 'warning' : 'ok';
  return { marginUsd, marginPct, status };
};

/**
 * Margin of an order (the order profit is computed in the app, not stored in SQL): income = order profit + shipping
 * charged to the customer, cost = effective courier cost, base = subtotal. Same definition as the Dashboard headline.
 */
export const computeOrderMargin = ({ orderProfit, shippingCharged, cost, subtotal, warningPct = null, criticalPct = null } = {}) => {
  const profit = num(orderProfit);
  const income = profit === null ? null : profit + (num(shippingCharged) ?? 0);
  return computeOperationMargin({ base: subtotal, income, cost, warningPct, criticalPct });
};

/**
 * Simulates one rule on one remittance the admin describes. Mirrors the SQL: amounts that cannot be derived are null
 * ("unknown"), never 0. Returns { cup, usd, reason?, margin }.
 * rule: { method, fixedCup, fixedAmount, cupPerUsd, percent, base, currency, rangeOp, rangeX, rangeY } | null.
 * `rate` is the USD->CUP rate typed by the admin (the database uses the live exchange_rates row for fixed USD and ranges).
 */
export const simulateRule = (rule, input = {}) => {
  const sent = num(input.amountSentUsd);
  const deliver = num(input.amountToDeliver);
  const rate = num(input.rate) > 0 ? num(input.rate) : null;
  const income = num(input.commissionUsd) === null ? null : num(input.commissionUsd) + (num(input.deliveryChargeUsd) ?? 0);
  const finish = (cup, reason) => {
    const usd = cup !== null && rate !== null ? roundMoney(cup / rate) : null;
    const margin = computeOperationMargin({
      base: sent, income, cost: usd, warningPct: input.warningPct, criticalPct: input.criticalPct
    });
    return { cup, usd, reason: cup === null ? reason : undefined, margin };
  };
  if (!rule || !RULE_METHODS.includes(rule.method)) return finish(null, 'no_rule');

  // Range in the rule currency (the simulated value is the USD sent / order subtotal; CUP needs the rate).
  const range = rangeFromForm(rule);
  if (range.from !== null || range.to !== null) {
    const sentCents = toCents(input.amountSentUsd);
    if (rule.currency === 'CUP' && rate === null) return finish(null, 'no_fx');
    // twin of SQL round(value * fx, 2), in cents
    const value = sentCents === null ? null : rule.currency === 'CUP' ? Math.round(sentCents * rate) : sentCents;
    const inRange = value !== null && (range.from === null || value > range.from) && (range.to === null || value <= range.to);
    if (!inRange) return finish(null, 'no_tier_match');
  }

  let cup = null;
  if (rule.method === 'fixed_amount') {
    const amount = num(rule.fixedAmount);
    if (rule.currency === 'USD') {
      if (amount === null) return finish(null, 'no_amount_basis');
      if (rate === null) return finish(null, 'no_fx');
      const result = finish(roundMoney(amount * rate));
      return { ...result, usd: amount, margin: computeOperationMargin({
        base: sent, income, cost: amount, warningPct: input.warningPct, criticalPct: input.criticalPct
      }) };
    }
    cup = amount;
  } else if (rule.method === 'fixed_cup') {
    cup = num(rule.fixedCup);
  } else if (rule.method === 'percent_of_base' && rule.base === 'nominal_usd' && rate === null) {
    return finish(null, 'no_fx');
  } else if (rule.method === 'per_usd_delivered') {
    const usdBase = rule.base === 'nominal_usd' ? sent : rule.base === 'delivered_cup' && deliver !== null && rate !== null ? roundMoney(deliver / rate) : null;
    cup = usdBase !== null && num(rule.cupPerUsd) !== null ? roundMoney(Number(rule.cupPerUsd) * usdBase) : null;
  } else if (num(rule.percent) !== null) {
    const pct = Number(rule.percent);
    if (rule.base === 'nominal_usd' && sent !== null && rate !== null) cup = roundMoney(roundMoney((pct / 100) * sent) * rate);
    else if (rule.base === 'delivered_cup' && deliver !== null) cup = roundMoney((pct / 100) * deliver);
  }
  return finish(cup, 'no_amount_basis');
};

/** Field errors of the rule form (keys = field names). Structural checks only: no business limit lives here. */
export const validateRuleForm = (form = {}) => {
  const errors = {};
  if (!String(form.code ?? '').trim()) errors.code = 'required';
  if (!String(form.name ?? '').trim()) errors.name = 'required';
  if (!RULE_APPLIES_TO.includes(form.appliesTo)) errors.appliesTo = 'invalid';
  if (!RULE_METHODS.includes(form.method)) errors.method = 'invalid';
  if (!RULE_CURRENCIES.includes(form.currency)) errors.currency = 'invalid';
  // same scope rule as the SQL method_scope_chk / base_scope_chk
  const anyScope = form.method === 'fixed_cup' || form.method === 'fixed_amount'
    || (form.method === 'percent_of_base' && form.base === 'nominal_usd');
  if (form.method && !anyScope && form.appliesTo !== 'remittance') {
    if (form.method === 'percent_of_base' && form.base === 'delivered_cup') errors.base = 'remittanceOnly';
    else errors.appliesTo = 'remittanceOnly';
  }
  if (form.typeId && form.appliesTo !== 'remittance') errors.typeId = 'remittanceOnly';
  const nonNegative = (field) => {
    if (!isNum(form[field]) || Number(form[field]) < 0) errors[field] = 'nonNegative';
  };
  if (form.method === 'fixed_cup') nonNegative('fixedCup');
  if (form.method === 'fixed_amount' && toCents(form.fixedAmount) === null) errors.fixedAmount = 'money';
  if (form.method === 'per_usd_delivered') nonNegative('cupPerUsd');
  if (form.method === 'percent_of_base') {
    if (!isNum(form.percent) || Number(form.percent) < 0 || Number(form.percent) > 100) errors.percent = 'percentRange';
  }
  if ((form.method === 'per_usd_delivered' || form.method === 'percent_of_base') && !RULE_BASES.includes(form.base)) errors.base = 'required';
  const op = form.rangeOp ?? 'none';
  if (!RANGE_OPERATORS.includes(op)) errors.rangeOp = 'invalid';
  const { from, to } = rangeFromForm({ ...form, rangeOp: op });
  if ((op === 'gt' || op === 'between') && from === null) errors.rangeX = 'money';
  if ((op === 'lte' || op === 'between') && to === null) errors.rangeY = 'money';
  if (op === 'between' && from !== null && to !== null && to <= from) errors.rangeY = 'tierOrder';
  if (form.validFrom && form.validTo && new Date(form.validTo) <= new Date(form.validFrom)) errors.validTo = 'windowOrder';
  return errors;
};

/** RPC arguments of admin_set_messenger_payment_type_v2: parameters of other methods are sent as null. */
export const buildRuleArgs = (form, { acceptGaps = false } = {}) => {
  const { from, to } = rangeFromForm(form);
  return {
    p_code: String(form.code).trim(),
    p_name: String(form.name).trim(),
    p_applies_to: form.appliesTo,
    p_method: form.method,
    p_fixed_cup: form.method === 'fixed_cup' ? Number(form.fixedCup) : null,
    p_cup_per_usd: form.method === 'per_usd_delivered' ? Number(form.cupPerUsd) : null,
    p_percent: form.method === 'percent_of_base' ? Number(form.percent) : null,
    p_base: form.method === 'per_usd_delivered' || form.method === 'percent_of_base' ? form.base : null,
    p_courier_id: form.courierId || null,
    p_zone_id: form.zoneId || null,
    p_type_id: form.typeId || null,
    // cents -> decimal text -> number: exact for 2 decimals, the RPC re-checks
    p_amount_from: from === null ? null : Number(centsToText(from)),
    p_amount_to: to === null ? null : Number(centsToText(to)),
    p_valid_from: form.validFrom ? new Date(form.validFrom).toISOString() : null,
    p_valid_to: form.validTo ? new Date(form.validTo).toISOString() : null,
    p_currency: form.currency,
    p_fixed_amount: form.method === 'fixed_amount' ? Number(centsToText(toCents(form.fixedAmount))) : null,
    p_accept_gaps: acceptGaps === true
  };
};

/** i18n key for a typed refusal of the courier RPCs (SQLSTATE + the documented message prefix). */
export const courierErrorKey = (error) => {
  const code = error?.code;
  const message = String(error?.message || '');
  if (code === '23P01' || message.includes('overlapping_rule')) return 'couriers.errors.overlap';
  if (code === '23505') return 'couriers.errors.duplicateName';
  if (code === '42501') return message.includes('super administrator') ? 'couriers.errors.superAdminOnly' : 'couriers.errors.forbidden';
  if (code === '22023') {
    if (message.includes('coverage_gap')) return 'couriers.errors.coverageGap';
    if (message.includes('mixed_currency_scope')) return 'couriers.errors.mixedCurrency';
    if (/at most \d+ decimals/.test(message)) return 'couriers.errors.decimals';
    if (message.includes('cannot be in the past')) return 'couriers.errors.pastDate';
    if (message.includes('every accrual must be')) return 'couriers.errors.notPayable';
    if (message.includes('unknown amount can be recalculated')) return 'couriers.errors.notRecalculable';
    if (message.includes('cannot be changed once the operation')) return 'couriers.errors.alreadyDelivered';
    return 'couriers.errors.invalid';
  }
  return 'couriers.errors.generic';
};

const NUMERIC_TEXT = /^-?\d+(\.\d+)?$/;
/** One CSV cell: quotes/commas escaped and spreadsheet formulas neutralised (leading = + - @ tab CR). */
export const csvCell = (value) => {
  if (value === null || value === undefined) return '';
  let text = String(value);
  const isNumber = typeof value === 'number' || NUMERIC_TEXT.test(text);
  if (!isNumber && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const REPORT_COLUMNS = [
  'courier', 'remittance_deliveries', 'order_deliveries', 'remittance_amount_sent_usd', 'accrued_cup', 'accrued_usd',
  'paid_cup', 'pending_cup', 'voided_cup', 'voided_after_payment_cup', 'unknown_amount_count',
  'margin_warning_count', 'margin_critical_count', 'margin_unknown_count'
];

/** CSV of admin_courier_report rows: aggregates only (no ids, no phones, no customer data). */
export const buildReportCsv = (rows, labels = {}) => {
  const header = REPORT_COLUMNS.map((key) => csvCell(labels[key] ?? key)).join(',');
  const lines = (rows || []).map((row) =>
    REPORT_COLUMNS.map((key) => csvCell(key === 'courier' ? row.courier_name ?? labels.unassigned ?? '' : row[key])).join(',')
  );
  return [header, ...lines].join('\n');
};
