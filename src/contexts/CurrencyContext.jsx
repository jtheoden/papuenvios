import React, { createContext, useContext, useState, useEffect } from 'react';
import { getCurrencies } from '@/lib/currencyService';

const CurrencyContext = createContext();

/**
 * CurrencyProvider - Global currency management
 * Provides:
 * - currencies: List of active currencies
 * - selectedCurrency: Currently selected currency ID
 * - setSelectedCurrency: Function to change currency
 * - currentCurrency: Full object of selected currency
 * - currencySymbol: Symbol of selected currency
 * - currencyCode: Code (USD, EUR, CUP, etc.) of selected currency
 * - exchangeRate: Exchange rate multiplier from base currency
 * - formatCurrency: Function to format numbers with current currency
 */
export const CurrencyProvider = ({ children }) => {
  const [currencies, setCurrencies] = useState([]);
  const [selectedCurrency, setSelectedCurrency] = useState(null);
  const [loading, setLoading] = useState(true);

  // Load currencies on mount
  useEffect(() => {
    const loadCurrencies = async () => {
      setLoading(true);
      try {
        const { data } = await getCurrencies();
        if (data && data.length > 0) {
          setCurrencies(data);
          // Auto-select base currency or first one
          const baseCurrency = data.find(c => c.is_base);
          if (baseCurrency) {
            setSelectedCurrency(baseCurrency.id);
          } else {
            setSelectedCurrency(data[0].id);
          }
        }
      } catch (error) {
        console.error('Error loading currencies:', error);
      } finally {
        setLoading(false);
      }
    };

    loadCurrencies();
  }, []);

  // Get current currency object
  const currentCurrency = currencies.find(c => c.id === selectedCurrency);
  const currencySymbol = currentCurrency?.symbol || '$';
  const currencyCode = currentCurrency?.code || 'USD';
  const exchangeRate = currentCurrency?.exchange_rate || 1;

  // Format currency helper function
  const formatCurrency = (value) => {
    const converted = (value || 0) * exchangeRate;
    return converted.toFixed(2);
  };

  // Display currency with symbol and code
  const displayCurrency = (value) => {
    return `${currencySymbol}${formatCurrency(value)} ${currencyCode}`;
  };

  const value = {
    currencies,
    selectedCurrency,
    setSelectedCurrency,
    currentCurrency,
    currencySymbol,
    currencyCode,
    exchangeRate,
    formatCurrency,
    displayCurrency,
    loading
  };

  return (
    <CurrencyContext.Provider value={value}>
      {children}
    </CurrencyContext.Provider>
  );
};

/**
 * Hook to use currency context
 * @example
 * const { formatCurrency, currencySymbol, currencyCode } = useCurrency();
 */
export const useCurrency = () => {
  const context = useContext(CurrencyContext);
  if (!context) {
    throw new Error('useCurrency must be used within a CurrencyProvider');
  }
  return context;
};

export default CurrencyContext;
