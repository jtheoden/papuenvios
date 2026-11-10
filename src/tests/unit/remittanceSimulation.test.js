import { describe, it, expect } from 'vitest';
import { calcForward, calcReverse, simulateRemittance } from '@/lib/remittanceCalculations';
import golden from '../fixtures/remittanceGoldenVectors.json';

// The admin simulator (RemittanceTypesConfig) must show exactly what the wizard will charge.
describe('simulateRemittance (admin simulator view model)', () => {
  it.each(golden.forward.filter((v) => !v.input.offer).map((v) => [v.name, v]))('send mode: %s', (_n, v) => {
    const sim = simulateRemittance({
      mode: 'send',
      amount: v.input.amount,
      exchangeRate: v.input.rate,
      commissionPercentage: v.input.pct,
      commissionFixed: v.input.fixed,
    });
    expect(sim.amount).toBe(v.expected.amountSent);
    expect(sim.totalCommission).toBe(v.expected.commission);
    expect(sim.amountToDeliver).toBe(v.expected.amountToDeliver);
    expect(sim.netAmount).toBe(Math.round((v.expected.amountSent - v.expected.commission) * 100) / 100);
    // the displayed breakdown adds up to the total commission
    expect(Math.round((sim.commPctAmount + sim.commFixedAmount) * 100) / 100).toBe(sim.totalCommission);
  });

  it.each(golden.reverse.map((v) => [v.name, v]))('receive mode: %s', (_n, v) => {
    const sim = simulateRemittance({
      mode: 'receive',
      amount: v.input.desired,
      exchangeRate: v.input.rate,
      commissionPercentage: v.input.pct,
      commissionFixed: v.input.fixed,
    });
    const send = calcReverse({ desiredReceive: v.input.desired, exchangeRate: v.input.rate, commissionPct: v.input.pct, commissionFixed: v.input.fixed });
    const fwd = calcForward({ amount: send, exchangeRate: v.input.rate, commissionPct: v.input.pct, commissionFixed: v.input.fixed });
    expect(sim.amount).toBe(send);
    expect(sim.amountToDeliver).toBe(fwd.amountToDeliver);
    expect(sim.amountToDeliver).toBeGreaterThanOrEqual(v.input.desired);
  });

  it('returns null in receive mode when the commission is 100% or more', () => {
    expect(simulateRemittance({ mode: 'receive', amount: 100, exchangeRate: 800, commissionPercentage: 100, commissionFixed: 0 })).toBeNull();
  });

  it('effective rate is delivered / sent', () => {
    const sim = simulateRemittance({ mode: 'send', amount: 100, exchangeRate: 800, commissionPercentage: 2.5, commissionFixed: 0 });
    expect(sim.effectiveRate).toBeCloseTo(780, 6);
  });
});
