import { applyOffer, calculateDiscount } from './priceCalculationService';

/**
 * Builds a consistent discount breakdown for any amount using
 * category discounts and optional offers.
 */
export const buildDiscountBreakdown = ({ amount = 0, categoryPercent = 0, offer = null } = {}) => {
  const base = parseFloat(amount) || 0;
  const categoryAmount = calculateDiscount(base, categoryPercent);
  const afterCategory = base - categoryAmount;

  const offerResult = applyOffer(afterCategory, offer);
  const offerAmount = offerResult.discountAmount || 0;

  const offerPercent = offer
    ? offer.discount_type === 'percentage'
      ? parseFloat(offer.discount_value) || 0
      : afterCategory > 0
        ? (offerAmount / afterCategory) * 100
        : 0
    : 0;

  const totalDiscountAmount = parseFloat((categoryAmount + offerAmount).toFixed(2));
  const totalDiscountPercent = derivePercentFromAmount(base, totalDiscountAmount);

  return {
    baseAmount: base,
    finalAmount: parseFloat((offerResult.finalSubtotal || afterCategory).toFixed(2)),
    category: {
      percent: Math.max(0, categoryPercent || 0),
      amount: parseFloat(categoryAmount.toFixed(2))
    },
    offer: {
      percent: parseFloat(offerPercent.toFixed(2)),
      amount: parseFloat(offerAmount.toFixed(2)),
      type: offer?.discount_type || null,
      code: offer?.code || null
    },
    total: {
      amount: totalDiscountAmount,
      percent: parseFloat(totalDiscountPercent.toFixed(2))
    }
  };
};

/**
 * Derive discount percent from an amount and discount value.
 */
export const derivePercentFromAmount = (amount = 0, discountAmount = 0) => {
  const base = parseFloat(amount) || 0;
  const discount = parseFloat(discountAmount) || 0;

  if (base <= 0 || discount <= 0) return 0;
  return (discount / base) * 100;
};
