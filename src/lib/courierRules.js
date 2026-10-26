/**
 * Pure rules of the courier-management module (no Supabase import: safe for components and tests).
 * OWNER RULE: no amount, percentage, threshold, rate or tier is defined here. Everything numeric comes from the admin
 * (rule form, simulator inputs) or from the database. The calculations only mirror the SQL ones
 * (_courier_compute_accrual, _operation_margin) so the simulator shows what the database will do.
 */
import { roundMoney, roundTo } from './moneyPure';

export const RULE_METHODS = ['fixed_cup', 'per_usd_delivered', 'percent_of_base'];
export const RULE_APPLIES_TO = ['remittance', 'order', 'both'];
export const RULE_BASES = ['nominal_usd', 'delivered_cup'];

const MARGIN_TOLERANCE = 0.005;
const isNum = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const num = (v) => (isNum(v) ? Number(v) : null);

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
 * rule: { method, fixedCup, cupPerUsd, percent, base } | null
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

  let cup = null;
  if (rule.method === 'fixed_cup') {
    cup = num(rule.fixedCup);
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
  if (form.method && form.method !== 'fixed_cup' && form.appliesTo !== 'remittance') errors.appliesTo = 'remittanceOnly';
  if (form.typeId && form.appliesTo !== 'remittance') errors.typeId = 'remittanceOnly';
  const nonNegative = (field) => {
    if (!isNum(form[field]) || Number(form[field]) < 0) errors[field] = 'nonNegative';
  };
  if (form.method === 'fixed_cup') nonNegative('fixedCup');
  if (form.method === 'per_usd_delivered') nonNegative('cupPerUsd');
  if (form.method === 'percent_of_base') {
    if (!isNum(form.percent) || Number(form.percent) < 0 || Number(form.percent) > 100) errors.percent = 'percentRange';
  }
  if ((form.method === 'per_usd_delivered' || form.method === 'percent_of_base') && !RULE_BASES.includes(form.base)) errors.base = 'required';
  if (isNum(form.amountFrom) && Number(form.amountFrom) < 0) errors.amountFrom = 'nonNegative';
  if (isNum(form.amountTo) && Number(form.amountTo) < 0) errors.amountTo = 'nonNegative';
  if (isNum(form.amountFrom) && isNum(form.amountTo) && Number(form.amountTo) <= Number(form.amountFrom)) errors.amountTo = 'tierOrder';
  if (form.validFrom && form.validTo && new Date(form.validTo) <= new Date(form.validFrom)) errors.validTo = 'windowOrder';
  return errors;
};

/** RPC arguments of admin_set_messenger_payment_type: parameters of other methods are sent as null. */
export const buildRuleArgs = (form) => ({
  p_code: String(form.code).trim(),
  p_name: String(form.name).trim(),
  p_applies_to: form.appliesTo,
  p_method: form.method,
  p_fixed_cup: form.method === 'fixed_cup' ? Number(form.fixedCup) : null,
  p_cup_per_usd: form.method === 'per_usd_delivered' ? Number(form.cupPerUsd) : null,
  p_percent: form.method === 'percent_of_base' ? Number(form.percent) : null,
  p_base: form.method === 'fixed_cup' ? null : form.base,
  p_courier_id: form.courierId || null,
  p_zone_id: form.zoneId || null,
  p_type_id: form.typeId || null,
  p_amount_from: isNum(form.amountFrom) ? Number(form.amountFrom) : null,
  p_amount_to: isNum(form.amountTo) ? Number(form.amountTo) : null,
  p_valid_from: form.validFrom ? new Date(form.validFrom).toISOString() : null,
  p_valid_to: form.validTo ? new Date(form.validTo).toISOString() : null
});

/** i18n key for a typed refusal of the courier RPCs (SQLSTATE + the documented message prefix). */
export const courierErrorKey = (error) => {
  const code = error?.code;
  const message = String(error?.message || '');
  if (code === '23P01' || message.includes('overlapping_rule')) return 'couriers.errors.overlap';
  if (code === '23505') return 'couriers.errors.duplicateName';
  if (code === '42501') return message.includes('super administrator') ? 'couriers.errors.superAdminOnly' : 'couriers.errors.forbidden';
  if (code === '22023') {
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
