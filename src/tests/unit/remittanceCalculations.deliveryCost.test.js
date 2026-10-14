import { describe, it, expect } from 'vitest';
import { calcTotalToPay, calcForward } from '@/lib/remittanceCalculations';

describe('calcTotalToPay', () => {
  it('adds the delivery cost to the amount sent', () => {
    expect(calcTotalToPay({ amountSent: 100, deliveryCost: 5 })).toBe(105);
  });

  it('defaults the delivery cost to 0', () => {
    expect(calcTotalToPay({ amountSent: 100 })).toBe(100);
  });

  it('rounds to 2 decimals', () => {
    expect(calcTotalToPay({ amountSent: 0.1, deliveryCost: 0.2 })).toBe(0.3);
    expect(calcTotalToPay({ amountSent: 10.005, deliveryCost: 1.114 })).toBe(11.12);
  });

  it('treats negative, NaN or non-numeric delivery cost as 0', () => {
    expect(calcTotalToPay({ amountSent: 50, deliveryCost: -10 })).toBe(50);
    expect(calcTotalToPay({ amountSent: 50, deliveryCost: NaN })).toBe(50);
    expect(calcTotalToPay({ amountSent: 50, deliveryCost: 'abc' })).toBe(50);
    expect(calcTotalToPay({ amountSent: 50, deliveryCost: null })).toBe(50);
  });

  it('accepts numeric strings (DB numeric columns)', () => {
    expect(calcTotalToPay({ amountSent: '100.00', deliveryCost: '5.50' })).toBe(105.5);
  });

  it('never reduces the amount delivered: calcForward ignores delivery cost', () => {
    const base = { amount: 100, exchangeRate: 400, commissionPct: 2, commissionFixed: 1 };
    const before = calcForward(base).amountToDeliver;
    calcTotalToPay({ amountSent: 100, deliveryCost: 7 });
    expect(calcForward(base).amountToDeliver).toBe(before);
  });
});
