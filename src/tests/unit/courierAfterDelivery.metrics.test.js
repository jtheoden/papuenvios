import { describe, it, expect } from 'vitest';
import { computeCourierCostTotals, computeRemittanceCourierTotals, computeHeadline } from '@/lib/dashboardMetrics';
const now = new Date('2026-11-07T20:00:00Z');
const date = '2026-11-07T15:00:00Z';
describe('retroactive courier dashboard accounting', () => {
  it('subtracts a known remittance cost even without a shipping zone', () => {
    const totals = computeRemittanceCourierTotals([{ id: 'r', status: 'delivered', payment_validated_at: date, delivery_cost: 5 }], new Map([['r', 3]]), now);
    expect(totals.dailyRemittanceCourierCost).toBe(3);
    expect(computeHeadline({ remittanceCommission: 10, remittanceCourierCost: totals.dailyRemittanceCourierCost }).netIncome).toBe(7);
  });
  it('adds only known-cost orders Difference, counts unknowns, and accepts a known zero cost', () => {
    const orders = [5, 50, 8].map((shipping_cost, i) => ({ id: `${i}`, status: 'delivered', payment_status: 'validated', validated_at: date, shipping_cost }));
    const totals = computeCourierCostTotals(orders, new Map([['0', 3], ['1', null], ['2', 0]]), now);
    expect(totals.dailyCourierDifference).toBe(10);
    expect(totals.dailyCourierUnknownCount).toBe(1);
    expect(computeHeadline({ orderProfit: 20, orderCourierDifference: totals.dailyCourierDifference }).netIncome).toBe(30);
    expect(computeHeadline({ orderProfit: 20, orderCourierDifference: null }).netIncome).toBe(20);
  });
});
