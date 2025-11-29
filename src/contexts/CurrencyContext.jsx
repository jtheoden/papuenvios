import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { getCurrencies, getConversionRate } from '@/lib/currencyService';

const CurrencyContext = createContext();

/**
 * CurrencyProvider - Global currency management (Enhanced)
 *
 * Provides centralized currency management with:
 * - Global currency selection (single source of truth)
 * - Currency lookup utilities (by ID, by code)
 * - Price conversion with caching
 * - Exchange rate management
 *
 * Features:
 * - Automatic exchange rate caching to avoid N+1 queries
 * - Memoized lookups for performance
 * - Support for multi-currency price calculations
 * - Profit margin integration
 */
export const CurrencyProvider = ({ children }) => {
  const [currencies, setCurrencies] = useState([]);
  const [selectedCurrency, setSelectedCurrency] = useState(null);
  const [exchangeRatesCache, setExchangeRatesCache] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [conversionLoading, setConversionLoading] = useState(false);

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
  const currentCurrency = useMemo(
    () => currencies.find(c => c.id === selectedCurrency),
    [currencies, selectedCurrency]
  );
  const currencySymbol = currentCurrency?.symbol || '$';
  const currencyCode = currentCurrency?.code || 'USD';

  /**
   * Lookup currency by ID
   * @param {string} currencyId - UUID of currency
   * @returns {Object|null} Currency object or null
   */
  const getCurrencyById = useCallback((currencyId) => {
    return currencies.find(c => c.id === currencyId) || null;
  }, [currencies]);

  /**
   * Lookup currency by code
   * @param {string} code - Currency code (USD, EUR, CUP, etc.)
   * @returns {Object|null} Currency object or null
   */
  const getCurrencyByCode = useCallback((code) => {
    return currencies.find(c => c.code === code) || null;
  }, [currencies]);

  /**
   * Get symbol for currency ID
   * @param {string} currencyId - UUID of currency
   * @returns {string} Currency symbol
   */
  const getSymbol = useCallback((currencyId) => {
    return getCurrencyById(currencyId)?.symbol || '$';
  }, [getCurrencyById]);

  /**
   * Get code for currency ID
   * @param {string} currencyId - UUID of currency
   * @returns {string} Currency code
   */
  const getCode = useCallback((currencyId) => {
    return getCurrencyById(currencyId)?.code || 'USD';
  }, [getCurrencyById]);

  /**
   * Format currency display (e.g., "USD ($)")
   * @param {string} currencyId - UUID of currency
   * @returns {string} Formatted display string
   */
  const formatDisplay = useCallback((currencyId) => {
    const curr = getCurrencyById(currencyId);
    if (!curr) return 'USD ($)';
    return `${curr.code} (${curr.symbol})`;
  }, [getCurrencyById]);

  /**
   * Get conversion rate between two currencies
   * Uses cache to avoid repeated API calls
   * @param {string} fromCurrencyId - Source currency UUID
   * @param {string} toCurrencyId - Target currency UUID
   * @returns {Promise<number>} Conversion rate or null if not found
   */
  const getConversionRateWithCache = useCallback(async (fromCurrencyId, toCurrencyId) => {
    // Same currency = 1:1 rate
    if (fromCurrencyId === toCurrencyId) {
      return 1;
    }

    // Check cache
    const cacheKey = `${fromCurrencyId}-${toCurrencyId}`;
    if (exchangeRatesCache.has(cacheKey)) {
      return exchangeRatesCache.get(cacheKey);
    }

    try {
      setConversionLoading(true);
      const { data, error } = await getConversionRate(fromCurrencyId, toCurrencyId);

      if (!error && data) {
        // Cache the result
        setExchangeRatesCache(prev => {
          const newCache = new Map(prev);
          newCache.set(cacheKey, data.rate);
          return newCache;
        });
        return data.rate;
      }

      // Fallback to 1:1 if rate not found
      console.warn(`No conversion rate found from ${fromCurrencyId} to ${toCurrencyId}`);
      return 1;
    } catch (error) {
      console.error('Error getting conversion rate:', error);
      return 1; // Fallback to 1:1
    } finally {
      setConversionLoading(false);
    }
  }, [exchangeRatesCache]);

  /**
   * Convert amount from one currency to another
   * @param {number} amount - Amount to convert
   * @param {string} fromCurrencyId - Source currency UUID
   * @param {string} toCurrencyId - Target currency UUID
   * @returns {Promise<number>} Converted amount
   */
  const convertAmount = useCallback(async (amount, fromCurrencyId, toCurrencyId) => {
    if (!amount || amount === 0) return 0;

    const rate = await getConversionRateWithCache(fromCurrencyId, toCurrencyId);
    return amount * rate;
  }, [getConversionRateWithCache]);

  /**
   * Convert amount to selected currency
   * @param {number} amount - Amount to convert
   * @param {string} fromCurrencyId - Source currency UUID
   * @returns {Promise<number>} Amount in selected currency
   */
  const convertToSelected = useCallback((amount, fromCurrencyId) => {
    return convertAmount(amount, fromCurrencyId, selectedCurrency);
  }, [convertAmount, selectedCurrency]);

  /**
   * Format number as currency (original simple formatter)
   * @param {number} value - Value to format
   * @param {number} decimals - Decimal places (default 2)
   * @returns {string} Formatted value
   */
  const formatCurrency = useCallback((value, decimals = 2) => {
    return (value || 0).toFixed(decimals);
  }, []);

  /**
   * Display currency with symbol and code
   * @param {number} value - Value to display
   * @param {string} currencyId - Currency UUID (defaults to selected)
   * @returns {string} Formatted display (e.g., "$123.45 USD")
   */
  const displayCurrency = useCallback((value, currencyId = selectedCurrency) => {
    const symbol = getSymbol(currencyId);
    const code = getCode(currencyId);
    const formatted = formatCurrency(value);
    return `${symbol}${formatted} ${code}`;
  }, [selectedCurrency, getSymbol, getCode, formatCurrency]);

  // Create currency map for quick access
  const currencyMap = useMemo(() => {
    const map = new Map();
    currencies.forEach(c => {
      map.set(c.id, c);
      map.set(c.code, c);
    });
    return map;
  }, [currencies]);

  const value = {
    // State
    currencies,
    selectedCurrency,
    setSelectedCurrency,
    currentCurrency,
    loading,
    conversionLoading,

    // Display properties
    currencySymbol,
    currencyCode,

    // Lookup utilities
    getCurrencyById,
    getCurrencyByCode,
    getSymbol,
    getCode,
    formatDisplay,
    currencyMap,

    // Conversion utilities
    getConversionRateWithCache,
    convertAmount,
    convertToSelected,

    // Formatting utilities
    formatCurrency,
    displayCurrency
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
