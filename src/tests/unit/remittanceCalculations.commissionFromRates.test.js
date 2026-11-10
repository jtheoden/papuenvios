/**
 * A9 - the admin types the market rate and the delivery rate; the commission percentage is derived and rounded to
 * the scale of the column that stores it: remittance_types.commission_percentage is numeric(20,10) (only
 * remittances.commission_percentage is numeric(5,2)). Rounding to 2 decimals would make a type edited and
 * saved unchanged drift (2.1857923497 -> 2.19). It is derived only when the rates are typed, never when a type is
 * loaded for edit (see RemittanceTypesConfig.commissionPreserved).
 */
import { describe, it, expect } from 'vitest';
import { calcCommissionFromRates, effectiveDeliveryRate, simulateRemittance } from '@/lib/remittanceCalculations';

describe('calcCommissionFromRates', () => {
  it('rounds to the 10 decimals of the column (520 market, 500 delivery -> 3.8461538462)', () => {
    expect(calcCommissionFromRates(520, 500)).toBe(3.8461538462);
  });

  it('reproduces the live rows exactly from their rate and effective delivery rate', () => {
    expect(calcCommissionFromRates(915, 895)).toBe(2.1857923497);
    expect(calcCommissionFromRates(103, 100)).toBe(2.9126213592);
    expect(calcCommissionFromRates(900, 850)).toBe(5.5555555556);
    expect(calcCommissionFromRates(105, 100)).toBe(4.7619047619);
  });

  it('keeps exact values', () => {
    expect(calcCommissionFromRates(915, 900)).toBe(1.6393442623);
    expect(calcCommissionFromRates(800, 780)).toBe(2.5);
  });

  it('is 0 when the delivery rate is not below the market rate', () => {
    expect(calcCommissionFromRates(900, 900)).toBe(0);
    expect(calcCommissionFromRates(900, 950)).toBe(0);
  });

  it('keeps the previous edge cases', () => {
    expect(calcCommissionFromRates(0, 500)).toBe(0);
    expect(calcCommissionFromRates(-1, 500)).toBe(0);
    expect(calcCommissionFromRates(520, 0)).toBe(100);
    expect(calcCommissionFromRates(520, NaN)).toBe(100);
  });
});

describe('effectiveDeliveryRate', () => {
  it('is the rate the customer really gets with the stored percentage (the typed delivery rate, to the cent)', () => {
    expect(effectiveDeliveryRate(520, 3.8461538462)).toBe(500);
    expect(effectiveDeliveryRate(915, 2.1857923497)).toBe(895);
  });

  it('equals the typed delivery rate when the percentage is exact', () => {
    expect(effectiveDeliveryRate(800, 2.5)).toBe(780);
  });
});

describe('the derived percentage is what the simulator and the stored type use', () => {
  it('100 USD at market 520 / delivery 500 delivers the amount of the 3.85 commission (cent-rounded by the contract)', () => {
    const pct = calcCommissionFromRates(520, 500);
    const sim = simulateRemittance({ mode: 'send', amount: 100, exchangeRate: 520, commissionPercentage: pct, commissionFixed: 0 });
    expect(sim.totalCommission).toBe(3.85);
    expect(sim.amountToDeliver).toBe(49998);
  });
});
