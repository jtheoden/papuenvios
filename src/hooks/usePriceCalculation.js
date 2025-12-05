import { useState, useEffect, useMemo } from 'react';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useProfitMargin } from './useProfitMargin';

/**
 * usePriceCalculation Hook
 *
 * Combines currency conversion + profit margin calculation
 * Replaces duplicate price logic in ProductsPage and CartPage
 *
 * @param {Object} options - Configuration options
 * @param {number} options.basePrice - Original price amount
 * @param {string} options.baseCurrencyId - UUID of original currency
 * @param {string} options.targetCurrency - UUID of target currency (defaults to selected)
 * @param {string} options.itemType - Item type for margin: 'product' | 'combo' | 'remittance'
 * @param {number} options.markupPercent - Manual override for margin percentage
 *
 * @returns {Object} Price calculation result
 *   - basePrice: Number (original price converted to target currency)
 *   - markupAmount: Number (markup amount in target currency)
 *   - finalPrice: Number (base + markup in target currency)
 *   - currency: Object (full currency object of target)
 *   - isConverting: Boolean (conversion in progress)
 *   - error: String (error message if any)
 *
 * @example
 * const { finalPrice, currency } = usePriceCalculation({
 *   basePrice: 100,
 *   baseCurrencyId: productCurrencyId,
 *   itemType: 'product'
 * });
 */
export const usePriceCalculation = ({
  basePrice,
  baseCurrencyId,
  targetCurrency = null,
  itemType = 'product',
  markupPercent = null
} = {}) => {
  const {
    selectedCurrency,
    convertAmount,
    getCurrencyById,
    conversionLoading
  } = useCurrency();

  const { percentageValue, apply } = useProfitMargin({
    itemType,
    overridePercent: markupPercent
  });

  const [convertedBasePrice, setConvertedBasePrice] = useState(null);
  const [isConverting, setIsConverting] = useState(false);
  const [error, setError] = useState(null);

  // Use target currency or fall back to selected
  const targetCurrencyId = targetCurrency || selectedCurrency;

  // Perform currency conversion when dependencies change
  useEffect(() => {
    const performConversion = async () => {
      try {
        setError(null);
        setIsConverting(true);

        // If no base currency, use target as base (no conversion needed)
        if (!baseCurrencyId) {
          setConvertedBasePrice(basePrice || 0);
          return;
        }

        // Convert base price from source to target currency
        const converted = await convertAmount(
          basePrice,
          baseCurrencyId,
          targetCurrencyId
        );

        setConvertedBasePrice(converted);
      } catch (err) {
        console.error('Price calculation error:', err);
        setError(err.message);
        // Fallback to unconverted price on error
        setConvertedBasePrice(basePrice || 0);
      } finally {
        setIsConverting(false);
      }
    };

    if (basePrice && baseCurrencyId && targetCurrencyId) {
      performConversion();
    }
  }, [basePrice, baseCurrencyId, targetCurrencyId, convertAmount]);

  // Calculate markup amount and final price
  const priceData = useMemo(() => {
    if (convertedBasePrice === null || convertedBasePrice === undefined) {
      return {
        basePrice: 0,
        markupAmount: 0,
        finalPrice: 0
      };
    }

    const base = parseFloat(convertedBasePrice) || 0;
    const final = apply(base);
    const markup = final - base;

    return {
      basePrice: base,
      markupAmount: markup,
      finalPrice: final
    };
  }, [convertedBasePrice, apply]);

  const currency = useMemo(
    () => getCurrencyById(targetCurrencyId),
    [targetCurrencyId, getCurrencyById]
  );

  return {
    ...priceData,
    currency,
    markupPercent: percentageValue,
    isConverting: isConverting || conversionLoading,
    error
  };
};

export default usePriceCalculation;
