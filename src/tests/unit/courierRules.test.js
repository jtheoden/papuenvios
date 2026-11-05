import { describe, it, expect } from 'vitest';
import {
  computeOperationMargin, computeOrderMargin, simulateRule, validateRuleForm, buildRuleArgs, courierErrorKey,
  csvCell, buildReportCsv, shortId, RULE_METHODS, RULE_CURRENCIES, RANGE_OPERATORS, toCents, centsToText, rangeFromForm,
  formFromRange, rangesOverlap, coverageGaps, analyzeRuleConflicts, coverageGapsFromError
} from '@/lib/courierRules';

describe('computeOperationMargin (twin of SQL _operation_margin)', () => {
  it('is unknown (never 0) when cost, income or base are missing or the base is not positive', () => {
    for (const a of [[100, 2.4, null], [100, null, 1], [0, 2, 1], [null, 2, 1], [-5, 2, 1], [undefined, 2, 1]]) {
      expect(computeOperationMargin({ base: a[0], income: a[1], cost: a[2] })).toEqual({ marginUsd: null, marginPct: null, status: 'unknown' });
    }
  });
  it('never alerts without thresholds (status unknown, not ok), even on a loss, keeping the numbers', () => {
    expect(computeOperationMargin({ base: 100, income: 2.4, cost: 3 })).toEqual({ marginUsd: -0.6, marginPct: -0.6, status: 'unknown' });
  });
  it('classifies with a 0.005 tolerance, inclusive at the limit (same vectors as the SQL tests)', () => {
    const m = (income, cost, warningPct, criticalPct) => computeOperationMargin({ base: 100, income, cost, warningPct, criticalPct }).status;
    expect(m(3, 1, 3, 1)).toBe('warning');
    expect(m(3, 2, 3, 1)).toBe('warning');
    expect(m(3, 2.01, 3, 1)).toBe('critical');
    expect(m(4, 1, 3, 1)).toBe('ok');
    expect(m(4, 1.01, 3, 1)).toBe('warning');
    expect(m(1, 3, 3, 0)).toBe('critical');
    expect(m(1, 3, null, 0)).toBe('critical');
    expect(m(2.4, 0, 3, null)).toBe('warning');
  });
});

describe('computeOrderMargin (orders: the profit lives in the app)', () => {
  it('income = order profit + shipping charged; cost = effective courier cost; base = subtotal', () => {
    expect(computeOrderMargin({ orderProfit: 10, shippingCharged: 5, cost: 2, subtotal: 100 })).toMatchObject({ marginUsd: 13, marginPct: 13, status: 'unknown' });
  });
  it('unknown courier cost or profit => unknown, never a margin computed as if the cost were 0', () => {
    expect(computeOrderMargin({ orderProfit: 10, shippingCharged: 5, cost: null, subtotal: 100 }).status).toBe('unknown');
    expect(computeOrderMargin({ orderProfit: null, shippingCharged: 5, cost: 1, subtotal: 100 }).status).toBe('unknown');
  });
  it('uses the thresholds when given', () => {
    expect(computeOrderMargin({ orderProfit: 1, shippingCharged: 0, cost: 2, subtotal: 100, criticalPct: 0 }).status).toBe('critical');
  });
});

describe('simulateRule (mirrors the SQL calculation; all inputs are typed by the admin)', () => {
  const op = { amountSentUsd: 100, amountToDeliver: 79056, rate: 810, commissionUsd: 2.4, deliveryChargeUsd: 0 };
  const sim = (rule, extra = {}) => simulateRule(rule, { ...op, ...extra });

  it('fixed_cup', () => {
    expect(sim({ method: 'fixed_cup', fixedCup: 200 })).toMatchObject({ cup: 200, usd: 0.25 });
  });
  it('per_usd_delivered with both bases', () => {
    expect(sim({ method: 'per_usd_delivered', cupPerUsd: 1.5, base: 'nominal_usd' })).toMatchObject({ cup: 150, usd: 0.19 });
    expect(sim({ method: 'per_usd_delivered', cupPerUsd: 1, base: 'delivered_cup' })).toMatchObject({ cup: 97.6, usd: 0.12 });
  });
  it('percent_of_base with both bases', () => {
    expect(sim({ method: 'percent_of_base', percent: 2, base: 'nominal_usd' })).toMatchObject({ cup: 1620, usd: 2 });
    expect(sim({ method: 'percent_of_base', percent: 0.5, base: 'delivered_cup' })).toMatchObject({ cup: 395.28, usd: 0.49 });
  });
  it('a missing basis or rate gives an unknown amount (null), never 0', () => {
    expect(sim({ method: 'percent_of_base', percent: 1, base: 'delivered_cup' }, { amountToDeliver: null }).cup).toBeNull();
    expect(sim({ method: 'fixed_cup', fixedCup: 200 }, { rate: null })).toMatchObject({ cup: 200, usd: null });
    expect(sim(null)).toMatchObject({ cup: null, usd: null, reason: 'no_rule' });
  });
  it('reports the margin and flags it against the thresholds the owner set (none => no alert)', () => {
    const rule = { method: 'fixed_cup', fixedCup: 2000 };
    expect(sim(rule).margin).toMatchObject({ marginUsd: -0.07, status: 'unknown' });
    expect(sim(rule, { criticalPct: 0 }).margin.status).toBe('critical');
    expect(sim({ method: 'fixed_cup', fixedCup: 200 }, { warningPct: 3 }).margin.status).toBe('warning');
  });
});

describe('validateRuleForm / buildRuleArgs', () => {
  const ok = { code: 'g', name: 'General', appliesTo: 'remittance', method: 'fixed_cup', fixedCup: '200', fixedAmount: '', cupPerUsd: '',
    percent: '', base: '', currency: 'USD', courierId: '', zoneId: '', typeId: '', rangeOp: 'none', rangeX: '', rangeY: '',
    validFrom: '', validTo: '' };

  it('accepts a complete fixed rule and maps it to the v2 RPC arguments with empty values as null', () => {
    expect(validateRuleForm(ok)).toEqual({});
    expect(buildRuleArgs(ok)).toEqual({
      p_code: 'g', p_name: 'General', p_applies_to: 'remittance', p_method: 'fixed_cup', p_fixed_cup: 200, p_cup_per_usd: null,
      p_percent: null, p_base: null, p_courier_id: null, p_zone_id: null, p_type_id: null, p_amount_from: null, p_amount_to: null,
      p_valid_from: null, p_valid_to: null, p_currency: 'USD', p_fixed_amount: null, p_accept_gaps: false
    });
  });
  it('fixed_amount: any scope, a money value in the chosen currency; p_accept_gaps only when confirmed', () => {
    const f = { ...ok, method: 'fixed_amount', fixedCup: '', fixedAmount: '2.50', currency: 'USD', appliesTo: 'order' };
    expect(validateRuleForm(f)).toEqual({});
    expect(buildRuleArgs(f, { acceptGaps: true })).toMatchObject({
      p_method: 'fixed_amount', p_fixed_amount: 2.5, p_fixed_cup: null, p_currency: 'USD', p_applies_to: 'order', p_accept_gaps: true
    });
    expect(validateRuleForm({ ...f, fixedAmount: '' })).toHaveProperty('fixedAmount', 'money');
    expect(validateRuleForm({ ...f, fixedAmount: '1.005' })).toHaveProperty('fixedAmount', 'money');
    expect(validateRuleForm({ ...f, fixedAmount: '-1' })).toHaveProperty('fixedAmount', 'money');
    expect(validateRuleForm({ ...f, currency: 'EUR' })).toHaveProperty('currency');
    expect(validateRuleForm({ ...f, fixedAmount: '10000000000' })).toHaveProperty('fixedAmount', 'moneyMax');
    expect(validateRuleForm({ ...f, fixedAmount: '9999999999.99' })).toEqual({});
    expect(validateRuleForm({ ...f, rangeOp: 'gt', rangeX: '10000000000.00' })).toHaveProperty('rangeX', 'moneyMax');
  });
  it('percent of the nominal USD is allowed for orders; delivered_cup and per-USD stay remittance-only', () => {
    expect(validateRuleForm({ ...ok, method: 'percent_of_base', fixedCup: '', percent: '2', base: 'nominal_usd', appliesTo: 'order' })).toEqual({});
    expect(validateRuleForm({ ...ok, method: 'percent_of_base', fixedCup: '', percent: '2', base: 'delivered_cup', appliesTo: 'order' })).toHaveProperty('base', 'remittanceOnly');
    expect(validateRuleForm({ ...ok, method: 'per_usd_delivered', fixedCup: '', cupPerUsd: '1', base: 'nominal_usd', appliesTo: 'order' })).toHaveProperty('appliesTo', 'remittanceOnly');
  });
  it('range operators map to (from, to] and are validated in cents (2 decimals max, X < Y)', () => {
    const r = (rangeOp, rangeX = '', rangeY = '') => ({ ...ok, rangeOp, rangeX, rangeY });
    expect(buildRuleArgs(r('gt', '100'))).toMatchObject({ p_amount_from: 100, p_amount_to: null });
    expect(buildRuleArgs(r('lte', '', '100'))).toMatchObject({ p_amount_from: null, p_amount_to: 100 });
    expect(buildRuleArgs(r('between', '100', '200.5'))).toMatchObject({ p_amount_from: 100, p_amount_to: 200.5 });
    expect(buildRuleArgs(r('none', '5', '9'))).toMatchObject({ p_amount_from: null, p_amount_to: null });
    expect(validateRuleForm(r('gt', ''))).toHaveProperty('rangeX', 'money');
    expect(validateRuleForm(r('lte', '', '100.005'))).toHaveProperty('rangeY', 'money');
    expect(validateRuleForm(r('between', '100', '100'))).toHaveProperty('rangeY', 'tierOrder');
    expect(validateRuleForm(r('between', '100.01', '100'))).toHaveProperty('rangeY', 'tierOrder');
    expect(validateRuleForm(r('between', '100', '100.01'))).toEqual({});
    expect(validateRuleForm(r('weird'))).toHaveProperty('rangeOp');
  });
  it('requires the parameter of the chosen method and drops the others', () => {
    expect(validateRuleForm({ ...ok, fixedCup: '' })).toHaveProperty('fixedCup');
    expect(validateRuleForm({ ...ok, fixedCup: '-1' })).toHaveProperty('fixedCup');
    expect(validateRuleForm({ ...ok, method: 'percent_of_base', percent: '101', base: 'nominal_usd' })).toHaveProperty('percent');
    expect(validateRuleForm({ ...ok, method: 'percent_of_base', percent: '5', base: '' })).toHaveProperty('base');
    const args = buildRuleArgs({ ...ok, method: 'percent_of_base', percent: '2.5', base: 'nominal_usd', fixedCup: '999' });
    expect(args).toMatchObject({ p_percent: 2.5, p_base: 'nominal_usd', p_fixed_cup: null });
  });
  it('per-USD and percent methods only apply to remittances; a type only to remittance rules; tiers must be ordered', () => {
    expect(validateRuleForm({ ...ok, method: 'per_usd_delivered', cupPerUsd: '1', base: 'nominal_usd', appliesTo: 'both' })).toHaveProperty('appliesTo');
    expect(validateRuleForm({ ...ok, appliesTo: 'order', typeId: 't1' })).toHaveProperty('typeId');
    expect(validateRuleForm({ ...ok, rangeOp: 'between', rangeX: '50', rangeY: '50' })).toHaveProperty('rangeY');
    expect(validateRuleForm({ ...ok, code: ' ', name: '' })).toMatchObject({ code: expect.any(String), name: expect.any(String) });
  });
  it('exposes exactly the enumerated methods, currencies and operators (no free-form expression)', () => {
    expect(RULE_METHODS).toEqual(['fixed_amount', 'fixed_cup', 'per_usd_delivered', 'percent_of_base']);
    expect(RULE_CURRENCIES).toEqual(['USD', 'CUP']);
    expect(RANGE_OPERATORS).toEqual(['none', 'gt', 'lte', 'between']);
  });
});

describe('cents helpers (never floats)', () => {
  it('toCents accepts ^\\d+(\\.\\d{1,2})?$ only and returns integer cents', () => {
    expect(toCents('100')).toBe(10000);
    expect(toCents('100.1')).toBe(10010);
    expect(toCents('0.29')).toBe(29); // 0.29 * 100 = 28.999999999999996 as a float
    expect(toCents('100.01')).toBe(10001);
    expect(toCents(100.01)).toBe(10001);
    for (const bad of ['', ' ', '100.005', '-1', '1e3', '1,5', 'abc', '.5', '5.', null, undefined]) expect(toCents(bad), String(bad)).toBeNull();
    // same maximum as the server / numeric(12,2)
    expect(toCents('9999999999.99')).toBe(999999999999);
    expect(toCents('10000000000')).toBeNull();
    expect(centsToText(10001)).toBe('100.01');
    expect(centsToText(5)).toBe('0.05');
  });
  it('form <-> range round-trip', () => {
    expect(rangeFromForm({ rangeOp: 'lte', rangeY: '100' })).toEqual({ from: null, to: 10000 });
    expect(rangeFromForm({ rangeOp: 'gt', rangeX: '100' })).toEqual({ from: 10000, to: null });
    expect(rangeFromForm({ rangeOp: 'between', rangeX: '100', rangeY: '200' })).toEqual({ from: 10000, to: 20000 });
    expect(rangeFromForm({ rangeOp: 'none' })).toEqual({ from: null, to: null });
    expect(formFromRange('100.00', '200.00')).toEqual({ rangeOp: 'between', rangeX: '100.00', rangeY: '200.00' });
    expect(formFromRange(null, '100.00')).toEqual({ rangeOp: 'lte', rangeX: '', rangeY: '100.00' });
    expect(formFromRange('0.00', null)).toEqual({ rangeOp: 'gt', rangeX: '0.00', rangeY: '' });
    expect(formFromRange(null, null)).toEqual({ rangeOp: 'none', rangeX: '', rangeY: '' });
  });
});

describe('overlaps and gaps (twin of the RPC checks)', () => {
  const R1 = { from: null, to: 10000 };
  const R2 = { from: 10000, to: 20000 };
  const R3 = { from: 20000, to: null };
  it('half-open (from, to]: adjacent ranges do not overlap, intersecting ones do', () => {
    expect(rangesOverlap(R1, R2)).toBe(false);
    expect(rangesOverlap(R2, R3)).toBe(false);
    expect(rangesOverlap(R1, { from: 9999, to: 20000 })).toBe(true); // "more than 99.99"
    expect(rangesOverlap(R3, { from: 50000, to: null })).toBe(true);
  });
  it('reference ladder is covered; "more than 100.01" leaves (100, 100.01]; start/end gaps reported', () => {
    expect(coverageGaps([R1, R2, R3])).toEqual([]);
    expect(coverageGaps([R1, { from: 10001, to: 20000 }, R3])).toEqual([{ from: 10000, to: 10001 }]);
    expect(coverageGaps([{ from: 5000, to: 6000 }])).toEqual([{ from: null, to: 5000 }, { from: 6000, to: null }]);
    expect(coverageGaps([{ from: 0, to: null }])).toEqual([{ from: null, to: 0 }]); // "more than 0" leaves 0.00 out
  });
  it('analyzeRuleConflicts compares against the current rules of the same scope, excluding the code being versioned', () => {
    const row = (o) => ({ code: 'x', is_active: true, valid_to: null, applies_to: 'remittance', currency: 'USD', courier_id: null,
      shipping_zone_id: null, remittance_type_id: null, amount_from: null, amount_to: null, ...o });
    const rules = [row({ code: 'R1', amount_to: '100.00' }), row({ code: 'R3', amount_from: '200.00' }),
      row({ code: 'Z', shipping_zone_id: 'z1', amount_from: '5.00' })];
    const form = (o) => ({ code: 'R2', appliesTo: 'remittance', currency: 'USD', courierId: '', zoneId: '', typeId: '', rangeOp: 'between', rangeX: '100', rangeY: '200', ...o });
    expect(analyzeRuleConflicts(form(), rules)).toEqual({ overlap: false, mixedCurrency: false, gaps: [] });
    expect(analyzeRuleConflicts(form({ rangeX: '100.01' }), rules).gaps).toEqual([{ kind: 'remittance', from: 10000, to: 10001 }]);
    expect(analyzeRuleConflicts(form({ rangeX: '99.99' }), rules).overlap).toBe(true);
    expect(analyzeRuleConflicts(form({ currency: 'CUP' }), rules).mixedCurrency).toBe(true);
    expect(analyzeRuleConflicts(form({ code: 'R1', rangeOp: 'lte', rangeX: '', rangeY: '100' }), rules).overlap).toBe(false); // new version of R1
    expect(analyzeRuleConflicts(form({ rangeOp: 'none' }), rules)).toEqual({ overlap: false, mixedCurrency: false, gaps: [] });
    // a rule without tramo in the same scope covers every gap
    expect(analyzeRuleConflicts(form({ rangeX: '100.01' }), [...rules, row({ code: 'flat' })]).gaps).toEqual([]);
    // 'order' rules are another kind; 'both' is checked for both kinds
    expect(analyzeRuleConflicts(form({ appliesTo: 'both' }), rules).gaps).toEqual([{ kind: 'order', from: null, to: 10000 }, { kind: 'order', from: 20000, to: null }]);
    // closed or inactive rules do not count
    expect(analyzeRuleConflicts(form({ rangeX: '99.99' }), rules.map((r) => ({ ...r, is_active: false }))).overlap).toBe(false);
  });
  it('validity windows: same rules as the RPC (overlap/currency on intersecting windows; coverage only by rules spanning the whole window)', () => {
    const NOW = Date.parse('2026-11-05T12:00:00Z');
    const row = (o) => ({ code: 'x', is_active: true, valid_from: '2026-11-01T00:00:00Z', valid_to: null, applies_to: 'remittance',
      currency: 'USD', courier_id: null, shipping_zone_id: null, remittance_type_id: null, amount_from: null, amount_to: null, ...o });
    const form = (o) => ({ code: 'N', appliesTo: 'remittance', currency: 'USD', courierId: '', zoneId: '', typeId: '', rangeOp: 'lte', rangeY: '100',
      validFrom: '', validTo: '', ...o });
    const ending = [row({ code: 'OLD', amount_to: '100.00', valid_to: '2026-12-01T00:00:00Z' })];
    // contiguous windows: the new rule starts exactly when the old one ends -> no overlap, no mixed currency
    expect(analyzeRuleConflicts(form({ validFrom: '2026-12-01T00:00:00Z' }), ending, NOW).overlap).toBe(false);
    expect(analyzeRuleConflicts(form({ validFrom: '2026-12-01T00:00:00Z', currency: 'CUP' }), ending, NOW).mixedCurrency).toBe(false);
    // intersecting windows -> overlap (and the other currency is refused)
    expect(analyzeRuleConflicts(form({ validFrom: '2026-11-20T00:00:00Z' }), ending, NOW).overlap).toBe(true);
    expect(analyzeRuleConflicts(form(), ending, NOW).overlap).toBe(true); // empty start = now
    expect(analyzeRuleConflicts(form({ validFrom: '2026-11-20T00:00:00Z', currency: 'CUP' }), ending, NOW).mixedCurrency).toBe(true);
    // a rule that ends before the new one does not cover it; one that spans it does
    const gtForm = form({ rangeOp: 'gt', rangeX: '100', rangeY: '' });
    expect(analyzeRuleConflicts(gtForm, ending, NOW).gaps).toEqual([{ kind: 'remittance', from: null, to: 10000 }]);
    expect(analyzeRuleConflicts({ ...gtForm, validTo: '2026-11-30T00:00:00Z' }, ending, NOW).gaps).toEqual([]);
    // a rule scheduled after the window start does not cover it either
    const later = [row({ code: 'LATER', amount_to: '100.00', valid_from: '2026-11-10T00:00:00Z' })];
    expect(analyzeRuleConflicts(gtForm, later, NOW).gaps).toEqual([{ kind: 'remittance', from: null, to: 10000 }]);
    // an unreadable date: the form does not decide (the server will)
    expect(analyzeRuleConflicts(form({ validFrom: 'not a date' }), ending, NOW)).toEqual({ overlap: false, mixedCurrency: false, gaps: [] });
  });
  it('coverageGapsFromError reads the JSON detail of a coverage_gap refusal (in cents)', () => {
    const e = { code: '22023', message: 'coverage_gap: ...', details: '{"currency":"USD","gaps":[{"kind":"order","from":100,"to":100.01}]}' };
    expect(coverageGapsFromError(e)).toEqual([{ kind: 'order', from: 10000, to: 10001 }]);
    expect(coverageGapsFromError({ code: '22023', message: 'other' })).toBeNull();
    expect(coverageGapsFromError({ message: 'coverage_gap', details: 'not json' })).toEqual([]);
  });
});

describe('simulateRule: fixed amount and ranges (phase A)', () => {
  const op = { amountSentUsd: 100, rate: 830, commissionUsd: 2.4, deliveryChargeUsd: 0 };
  it('fixed amount in CUP or in USD (converted at the given rate; no rate => no_fx, never 1.0)', () => {
    expect(simulateRule({ method: 'fixed_amount', fixedAmount: '250', currency: 'CUP' }, op)).toMatchObject({ cup: 250, usd: 0.3 });
    expect(simulateRule({ method: 'fixed_amount', fixedAmount: '2', currency: 'USD' }, op)).toMatchObject({ cup: 1660, usd: 2 });
    expect(simulateRule({ method: 'fixed_amount', fixedAmount: '2', currency: 'USD' }, { ...op, rate: '' })).toMatchObject({ cup: null, reason: 'no_fx' });
  });
  it('the range is checked in the rule currency: outside => no_tier_match; a CUP range without rate => no_fx', () => {
    const rule = { method: 'fixed_amount', fixedAmount: '5', currency: 'USD', rangeOp: 'lte', rangeY: '100' };
    expect(simulateRule(rule, op).cup).not.toBeNull();
    expect(simulateRule(rule, { ...op, amountSentUsd: '100.01' })).toMatchObject({ cup: null, reason: 'no_tier_match' });
    const cupRule = { method: 'fixed_amount', fixedAmount: '5', currency: 'CUP', rangeOp: 'gt', rangeX: '83000' };
    expect(simulateRule(cupRule, op)).toMatchObject({ cup: null, reason: 'no_tier_match' }); // 83000.00 is not > 83000
    expect(simulateRule(cupRule, { ...op, amountSentUsd: '100.01' }).cup).toBe(5);
    expect(simulateRule(cupRule, { ...op, rate: '' })).toMatchObject({ cup: null, reason: 'no_fx' });
  });
  it('percent of the nominal USD without a rate is no_fx', () => {
    expect(simulateRule({ method: 'percent_of_base', percent: 2, base: 'nominal_usd' }, { ...op, rate: '' })).toMatchObject({ cup: null, reason: 'no_fx' });
  });
});

describe('courierErrorKey: typed RPC errors', () => {
  const key = (error) => courierErrorKey(error);
  it('maps the documented refusals', () => {
    expect(key({ code: '23P01', message: 'overlapping_rule: ...' })).toBe('couriers.errors.overlap');
    expect(key({ code: '23505', message: 'duplicate key' })).toBe('couriers.errors.duplicateName');
    expect(key({ code: '42501', message: 'insufficient_privilege: only a super administrator can void a paid accrual' })).toBe('couriers.errors.superAdminOnly');
    expect(key({ code: '42501', message: 'insufficient_privilege: courier management is for administrators' })).toBe('couriers.errors.forbidden');
    expect(key({ code: '22023', message: 'invalid_argument: valid_from cannot be in the past' })).toBe('couriers.errors.pastDate');
    expect(key({ code: '22023', message: 'invalid_argument: every accrual must be calculated, unpaid, of known amount and of this courier' })).toBe('couriers.errors.notPayable');
    expect(key({ code: '22023', message: 'invalid_status: only a calculated delivery accrual with an unknown amount can be recalculated' })).toBe('couriers.errors.notRecalculable');
    expect(key({ code: '22023', message: 'invalid_status: the courier cannot be changed once the operation is delivered' })).toBe('couriers.errors.alreadyDelivered');
    expect(key({ code: '22023', message: 'coverage_gap: the ranges of this scope leave values without a rule' })).toBe('couriers.errors.coverageGap');
    expect(key({ code: '22023', message: 'mixed_currency_scope: the ranges of this scope already use another currency' })).toBe('couriers.errors.mixedCurrency');
    expect(key({ code: '22023', message: 'invalid_argument: amounts accept at most 2 decimals' })).toBe('couriers.errors.decimals');
    expect(key({ code: '22023', message: 'invalid_argument: percent accepts at most 3 decimals and cup_per_usd at most 4 decimals' })).toBe('couriers.errors.decimals');
    expect(key({ code: '22023', message: 'invalid_argument: amounts accept at most 9999999999.99' })).toBe('couriers.errors.amountMax');
    expect(key({ code: '22023', message: 'invalid_argument: NaN is not a valid amount, rate or percentage' })).toBe('couriers.errors.invalid');
    // phase B: subscriptions
    expect(key({ code: '22023', message: 'invalid_argument: this payment type belongs to another courier' })).toBe('couriers.errors.ownedByOther');
    expect(key({ code: '22023', message: 'invalid_argument: unknown payment type code or no active version' })).toBe('couriers.errors.noActiveVersion');
    expect(key({ code: '22023', message: 'invalid_argument: this payment type is subscribed by another courier; unsubscribe it first' })).toBe('couriers.errors.subscribedElsewhere');
    expect(key({ code: '22023', message: 'invalid_argument: courier not found or inactive' })).toBe('couriers.errors.courierInactive');
    expect(key({ code: '22023', message: 'something else' })).toBe('couriers.errors.invalid');
    expect(key({ code: '55P03' })).toBe('couriers.errors.generic');
    expect(key(null)).toBe('couriers.errors.generic');
  });
});

describe('CSV export is safe', () => {
  it('escapes quotes, separators and neutralises spreadsheet formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('\t=x')).toBe("'\t=x");
    expect(csvCell(null)).toBe('');
    expect(csvCell(-5)).toBe('-5'); // real negative numbers stay numbers
  });
  it('writes aggregates only: no ids, phones or customer data, and keeps unknown amounts apart', () => {
    const csv = buildReportCsv(
      [{ courier_id: 'secret-uuid', courier_name: '=Pedro', remittance_deliveries: 2, order_deliveries: 1, remittance_amount_sent_usd: '200.00',
        accrued_cup: '2450.00', accrued_usd: '3.00', paid_cup: '0', pending_cup: '2450.00', voided_cup: '0', voided_after_payment_cup: '0',
        unknown_amount_count: 1, margin_warning_count: 0, margin_critical_count: 0, margin_unknown_count: 1 }],
      { courier: 'Courier', unassigned: 'Unassigned' }
    );
    const [header, row] = csv.split('\n');
    expect(header).toContain('Courier');
    expect(csv).not.toContain('secret-uuid');
    expect(row.startsWith("'=Pedro,")).toBe(true);
    expect(header.split(',')).toHaveLength(row.split(',').length);
  });
});

describe('shortId', () => {
  it('truncates ids for logs', () => {
    expect(shortId('123e4567-e89b-12d3-a456-426614174000')).toBe('123e4567');
    expect(shortId(null)).toBe('');
  });
});
