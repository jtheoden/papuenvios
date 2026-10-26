import { describe, it, expect } from 'vitest';
import {
  computeOperationMargin, computeOrderMargin, simulateRule, validateRuleForm, buildRuleArgs, courierErrorKey,
  csvCell, buildReportCsv, shortId, RULE_METHODS
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
  const ok = { code: 'g', name: 'General', appliesTo: 'remittance', method: 'fixed_cup', fixedCup: '200', cupPerUsd: '', percent: '', base: '',
    courierId: '', zoneId: '', typeId: '', amountFrom: '', amountTo: '', validFrom: '', validTo: '' };

  it('accepts a complete fixed rule and maps it to the RPC arguments with empty values as null', () => {
    expect(validateRuleForm(ok)).toEqual({});
    expect(buildRuleArgs(ok)).toEqual({
      p_code: 'g', p_name: 'General', p_applies_to: 'remittance', p_method: 'fixed_cup', p_fixed_cup: 200, p_cup_per_usd: null,
      p_percent: null, p_base: null, p_courier_id: null, p_zone_id: null, p_type_id: null, p_amount_from: null, p_amount_to: null,
      p_valid_from: null, p_valid_to: null
    });
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
    expect(validateRuleForm({ ...ok, amountFrom: '50', amountTo: '50' })).toHaveProperty('amountTo');
    expect(validateRuleForm({ ...ok, code: ' ', name: '' })).toMatchObject({ code: expect.any(String), name: expect.any(String) });
  });
  it('exposes exactly the enumerated methods (no free-form expression)', () => {
    expect(RULE_METHODS).toEqual(['fixed_cup', 'per_usd_delivered', 'percent_of_base']);
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
