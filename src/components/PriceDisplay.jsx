import React from 'react';
import { usePriceCalculation } from '@/hooks/usePriceCalculation';

/**
 * PriceDisplay Component
 *
 * Displays a price with automatic currency conversion
 * Replaces duplicate price display logic throughout the app
 *
 * @component
 * @param {Object} props
 * @param {number} props.amount - Price amount to display
 * @param {string} [props.currencyId] - UUID of original currency
 * @param {string} [props.targetCurrency] - UUID of target currency (defaults to selected)
 * @param {boolean} [props.showCurrencyCode=true] - Show currency code (e.g., "USD")
 * @param {boolean} [props.showCurrencySymbol=true] - Show currency symbol (e.g., "$")
 * @param {number} [props.decimals=2] - Number of decimal places
 * @param {string} [props.className] - Additional CSS classes
 * @param {boolean} [props.loading=false] - Show loading state
 * @param {string} [props.prefix] - Text prefix (e.g., "Price: ")
 * @param {string} [props.suffix] - Text suffix
 *
 * @example
 * <PriceDisplay
 *   amount={100}
 *   currencyId={productCurrencyId}
 *   showCurrencySymbol
 *   showCurrencyCode={false}
 * />
 * // Renders: $100.00
 *
 * @example
 * <PriceDisplay
 *   amount={100}
 *   currencyId={productCurrencyId}
 *   showCurrencyCode
 *   showCurrencySymbol={false}
 * />
 * // Renders: 100.00 USD
 */
export const PriceDisplay = ({
  amount,
  currencyId = null,
  targetCurrency = null,
  showCurrencyCode = true,
  showCurrencySymbol = true,
  decimals = 2,
  className = '',
  loading = false,
  prefix = '',
  suffix = ''
}) => {
  const {
    finalPrice,
    currency,
    isConverting,
    error
  } = usePriceCalculation({
    basePrice: amount,
    baseCurrencyId: currencyId,
    targetCurrency,
    itemType: 'product'
  });

  // Loading state
  if (loading || isConverting) {
    return (
      <span className={`inline-block bg-gray-200 animate-pulse rounded ${className}`}>
        <span className="invisible">${(0).toFixed(decimals)}</span>
      </span>
    );
  }

  // Error state
  if (error) {
    return (
      <span className={`text-red-600 font-medium ${className}`} title={error}>
        {prefix}Error{suffix}
      </span>
    );
  }

  // Determine display format
  const symbol = currency?.symbol || '$';
  const code = currency?.code || 'USD';
  const formattedPrice = finalPrice.toFixed(decimals);

  // Build display string based on options
  let displayText = '';
  if (prefix) displayText += prefix;

  if (showCurrencySymbol && !showCurrencyCode) {
    displayText += `${symbol}${formattedPrice}`;
  } else if (showCurrencyCode && !showCurrencySymbol) {
    displayText += `${formattedPrice} ${code}`;
  } else if (showCurrencySymbol && showCurrencyCode) {
    displayText += `${symbol}${formattedPrice} ${code}`;
  } else {
    displayText += formattedPrice;
  }

  if (suffix) displayText += suffix;

  return (
    <span className={`font-medium text-gray-900 ${className}`}>
      {displayText}
    </span>
  );
};

export default PriceDisplay;
