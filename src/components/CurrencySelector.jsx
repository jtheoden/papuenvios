import React, { useCallback } from 'react';
import { useCurrency } from '@/contexts/CurrencyContext';

/**
 * CurrencySelector Component
 *
 * Reusable currency selection dropdown
 * Replaces duplicate selector logic in ProductsPage, CartPage, etc.
 *
 * @component
 * @param {Object} props
 * @param {string} props.selectedCurrency - UUID of selected currency
 * @param {Function} props.onCurrencyChange - Callback when currency changes
 * @param {string} [props.label] - Optional label text
 * @param {boolean} [props.showSymbol=true] - Show currency symbol in options
 * @param {boolean} [props.disabled=false] - Disable the selector
 * @param {string} [props.size='md'] - Size: 'sm' | 'md' | 'lg'
 * @param {string} [props.className] - Additional CSS classes
 *
 * @example
 * <CurrencySelector
 *   selectedCurrency={selectedCurrency}
 *   onCurrencyChange={setSelectedCurrency}
 *   label="Select Currency"
 *   showSymbol
 * />
 */
export const CurrencySelector = ({
  selectedCurrency,
  onCurrencyChange,
  label = null,
  showSymbol = true,
  disabled = false,
  size = 'md',
  className = ''
}) => {
  const { currencies, loading } = useCurrency();

  const handleChange = useCallback((e) => {
    const currencyId = e.target.value;
    if (onCurrencyChange) {
      onCurrencyChange(currencyId);
    }
  }, [onCurrencyChange]);

  // Size-based class mappings
  const sizeClasses = {
    sm: 'px-2 py-1 text-sm',
    md: 'px-3 py-2 text-base',
    lg: 'px-4 py-3 text-lg'
  };

  const selectClasses = `
    ${sizeClasses[size] || sizeClasses.md}
    border border-gray-300
    rounded-lg
    bg-white
    text-gray-900
    font-medium
    cursor-pointer
    transition-colors
    hover:border-gray-400
    focus:outline-none
    focus:ring-2
    focus:ring-blue-500
    focus:ring-offset-0
    disabled:opacity-50
    disabled:cursor-not-allowed
    disabled:hover:border-gray-300
    ${className}
  `;

  if (loading) {
    return (
      <div className="flex items-center gap-2">
        {label && <label className="font-medium text-gray-700">{label}</label>}
        <div className="px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-500 animate-pulse">
          Loading currencies...
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {label && (
        <label htmlFor="currency-selector" className="font-medium text-gray-700 text-sm">
          {label}
        </label>
      )}
      <select
        id="currency-selector"
        value={selectedCurrency || ''}
        onChange={handleChange}
        disabled={disabled || loading || currencies.length === 0}
        className={selectClasses}
      >
        {currencies.length === 0 ? (
          <option value="">No currencies available</option>
        ) : (
          currencies.map((currency) => (
            <option key={currency.id} value={currency.id}>
              {currency.code}
            </option>
          ))
        )}
      </select>
    </div>
  );
};

export default CurrencySelector;
