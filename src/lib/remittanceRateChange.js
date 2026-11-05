import { calcForward } from '@/lib/remittanceCalculations';
import { roundTo } from '@/lib/moneyPure';

/** Quote the current-type result for a remittance created at a previous rate. */
export const quoteRateChange = (remittance) => {
  const type = remittance?.remittance_types;
  const snapshotRate = remittance?.exchange_rate;
  const currentRate = type?.exchange_rate;
  if (!type || !Number.isFinite(snapshotRate) || snapshotRate <= 0 || !Number.isFinite(currentRate) || currentRate <= 0) {
    return null;
  }

  const discountAmount = Number(remittance.discount_amount);
  const offer = discountAmount > 0
    ? { discount_type: 'fixed_amount', discount_value: discountAmount }
    : null;
  const calc = calcForward({
    amount: remittance.amount_sent,
    exchangeRate: currentRate,
    commissionPct: type.commission_percentage || 0,
    commissionFixed: type.commission_fixed || 0,
    offer
  });

  return {
    snapshotRate,
    currentRate,
    rateUp: currentRate > snapshotRate,
    pctChange: roundTo((currentRate - snapshotRate) / snapshotRate * 100, 2),
    newCommission: calc.effectiveCommission,
    newAmountToDeliver: calc.amountToDeliver
  };
};
