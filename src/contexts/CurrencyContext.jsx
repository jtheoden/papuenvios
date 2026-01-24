import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getCurrenciesWithRates, getConversionRate } from '@/lib/currencyService';

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
  // Start with null until currencies load (prevents invalid UUID queries)
  const [selectedCurrency, setSelectedCurrency] = useState(null);
  // Use useRef for cache to avoid unnecessary re-renders and dependency issues
  const exchangeRatesCacheRef = useRef(new Map());
  // Track cache version to trigger re-renders when rates are loaded
  const [cacheVersion, setCacheVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [conversionLoading, setConversionLoading] = useState(false);

  // Load currencies on mount (only active currencies with exchange rates)
  useEffect(() => {
    const loadCurrencies = async () => {
      setLoading(true);
      try {
        const data = await getCurrenciesWithRates();
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
    if (exchangeRatesCacheRef.current.has(cacheKey)) {
      return exchangeRatesCacheRef.current.get(cacheKey);
    }

    try {
      setConversionLoading(true);
      // getConversionRate returns a number directly, not an object with data/error
      const rate = await getConversionRate(fromCurrencyId, toCurrencyId);

      if (rate && rate !== null && !isNaN(rate)) {
        // Cache the result and trigger re-render
        exchangeRatesCacheRef.current.set(cacheKey, rate);
        // Increment version to trigger re-renders in components using cached rates
        setCacheVersion(prev => prev + 1);
        return rate;
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
  }, []);

  /**
   * Convert amount from one currency to another
   * SYNCHRONOUS VERSION - Uses cached rates or returns original amount if no cache
   * For render-phase calls. Use convertAmountAsync for guaranteed conversions.
   * @param {number} amount - Amount to convert
   * @param {string} fromCurrencyId - Source currency UUID
   * @param {string} toCurrencyId - Target currency UUID
   * @returns {number} Converted amount (or original if not cached)
   */
  const convertAmount = useCallback((amount, fromCurrencyId, toCurrencyId) => {
    if (!amount || amount === 0) return 0;
    if (!fromCurrencyId || !toCurrencyId) return amount;
    if (fromCurrencyId === toCurrencyId) return amount;

    // Check cache first (synchronous)
    const cacheKey = `${fromCurrencyId}-${toCurrencyId}`;
    if (exchangeRatesCacheRef.current.has(cacheKey)) {
      const rate = exchangeRatesCacheRef.current.get(cacheKey);
      return amount * rate;
    }

    // If not in cache, return original amount (avoid async in render)
    return amount;
  }, [cacheVersion]);

  /**
   * Async version for guaranteed conversions (use in effects/handlers)
   * @param {number} amount - Amount to convert
   * @param {string} fromCurrencyId - Source currency UUID
   * @param {string} toCurrencyId - Target currency UUID
   * @returns {Promise<number>} Converted amount
   */
  const convertAmountAsync = useCallback(async (amount, fromCurrencyId, toCurrencyId) => {
    if (!amount || amount === 0) return 0;

    const rate = await getConversionRateWithCache(fromCurrencyId, toCurrencyId);
    return amount * rate;
  }, [getConversionRateWithCache]);

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

  // Precache conversion rates when selected currency changes
  // This ensures convertAmount() returns correct values without waiting for API calls
  // MUST be after getConversionRateWithCache is defined to avoid TDZ error
  useEffect(() => {
    if (!selectedCurrency || currencies.length === 0) return;

    const preloadConversionRates = async () => {
      // Load conversion rates from all other currencies to the selected one
      const conversionPromises = currencies
        .filter(currency => currency.id !== selectedCurrency)
        .map(currency => getConversionRateWithCache(currency.id, selectedCurrency));

      try {
        await Promise.all(conversionPromises);
      } catch (error) {
        console.error('Error preloading conversion rates:', error);
      }
    };

    preloadConversionRates();
  }, [selectedCurrency, currencies, getConversionRateWithCache]);

  // Create currency map for quick access
  const currencyMap = useMemo(() => {
    const map = new Map();
    currencies.forEach(c => {
      map.set(c.id, c);
      map.set(c.code, c);
    });
    return map;
  }, [currencies]);

  // Memoize value object to ensure context subscribers re-render when it changes
  // CRITICAL: Include cacheVersion so when conversion rates load, subscribers are notified
  const value = useMemo(() => ({
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
    convertAmountAsync,
    convertToSelected,

    // Formatting utilities
    formatCurrency,
    displayCurrency
  }), [
    // State dependencies
    currencies,
    selectedCurrency,
    setSelectedCurrency,
    currentCurrency,
    loading,
    conversionLoading,
    // Properties dependencies
    currencySymbol,
    currencyCode,
    // Utilities dependencies
    getCurrencyById,
    getCurrencyByCode,
    getSymbol,
    getCode,
    formatDisplay,
    currencyMap,
    // Conversion dependencies - CRITICAL
    getConversionRateWithCache,
    convertAmount,
    convertAmountAsync,
    convertToSelected,
    // Formatting dependencies
    formatCurrency,
    displayCurrency,
    // Cache version to trigger updates when rates load
    cacheVersion
  ]);

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
