import { supabase } from './supabase';
import {
  handleError,
  logError,
  createValidationError,
  createNotFoundError,
  parseSupabaseError,
  ERROR_CODES,
  isSchemaMissingError
} from './errorHandler';

const OFFICIAL_RATE_FALLBACKS = {
  USD: 1,
  MLC: 1,
  CUP: 0.041
};

const OFFICIAL_RATES_STORAGE_KEY = 'officialRatesUnavailable';
const isBrowser = typeof window !== 'undefined';
const officialRatesDisabledByEnv = typeof import.meta !== 'undefined' && import.meta.env?.VITE_DISABLE_OFFICIAL_RATES === 'true';

const getPersistedOfficialRatesUnavailable = () => {
  if (!isBrowser) return false;
  try {
    return window.localStorage.getItem(OFFICIAL_RATES_STORAGE_KEY) === 'true';
  } catch (error) {
    console.warn('[currencyService] Unable to read official rates availability from storage:', error);
    return false;
  }
};

const markOfficialRatesUnavailable = () => {
  officialRatesUnavailable = true;
  if (!isBrowser) return;
  try {
    window.localStorage.setItem(OFFICIAL_RATES_STORAGE_KEY, 'true');
  } catch (error) {
    console.warn('[currencyService] Unable to persist official rates availability flag:', error);
  }
};

// Circuit breaker to avoid spamming Supabase when the table/columns are missing
let officialRatesUnavailable = officialRatesDisabledByEnv || getPersistedOfficialRatesUnavailable();

/**
 * Currency Service - Manages currency CRUD operations and rate conversions
 * Currencies: USD, EUR, CUP (Cuba market focus)
 * Rate Conversion Hierarchy: defined rates → official rates fallback
 */

/**
 * Get all active currencies
 * @returns {Promise<Array>} Array of active currency objects
 * @throws {AppError} DB_ERROR if query fails
 */
export const getCurrencies = async () => {
  try {
    const { data, error } = await supabase
      .from('currencies')
      .select('*')
      .eq('is_active', true)
      .order('code', { ascending: true });

    if (error) {
      throw parseSupabaseError(error);
    }

    return data || [];
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getCurrencies' });
    logError(appError, { operation: 'getCurrencies' });
    throw appError;
  }
};

/**
 * Get all currencies (including inactive)
 * @returns {Promise<Array>} Array of all currency objects
 * @throws {AppError} DB_ERROR if query fails
 */
export const getAllCurrencies = async () => {
  try {
    const { data, error } = await supabase
      .from('currencies')
      .select('*')
      .order('code', { ascending: true });

    if (error) {
      throw parseSupabaseError(error);
    }

    return data || [];
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getAllCurrencies' });
    logError(appError, { operation: 'getAllCurrencies' });
    throw appError;
  }
};

/**
 * Get active currencies that have associated exchange rates
 * Used for selectors in remittances, products, etc. where exchange rates are needed
 * @returns {Promise<Array>} Array of active currency objects with exchange rates
 * @throws {AppError} DB_ERROR if query fails
 */
export const getCurrenciesWithRates = async () => {
  try {
    // First get all active exchange rates to find which currencies have rates
    const { data: rates, error: ratesError } = await supabase
      .from('exchange_rates')
      .select('from_currency_id, to_currency_id')
      .eq('is_active', true);

    if (ratesError) {
      throw parseSupabaseError(ratesError);
    }

    // Collect unique currency IDs that appear in exchange rates
    const currencyIdsWithRates = new Set();
    (rates || []).forEach(rate => {
      currencyIdsWithRates.add(rate.from_currency_id);
      currencyIdsWithRates.add(rate.to_currency_id);
    });

    if (currencyIdsWithRates.size === 0) {
      return [];
    }

    // Get active currencies that have exchange rates
    const { data: currencies, error: currenciesError } = await supabase
      .from('currencies')
      .select('*')
      .eq('is_active', true)
      .in('id', Array.from(currencyIdsWithRates))
      .order('code', { ascending: true });

    if (currenciesError) {
      throw parseSupabaseError(currenciesError);
    }

    return currencies || [];
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getCurrenciesWithRates' });
    logError(appError, { operation: 'getCurrenciesWithRates' });
    throw appError;
  }
};

/**
 * Create a new currency (ADMIN ONLY)
 * @param {Object} currencyData - Currency data
 * @param {string} currencyData.code - Currency code (USD, EUR, CUP)
 * @param {string} currencyData.name_es - Spanish name
 * @param {string} currencyData.name_en - English name
 * @param {string} currencyData.symbol - Currency symbol
 * @param {boolean} [currencyData.is_base] - Whether this is the base currency
 * @returns {Promise<Object>} Created currency object
 * @throws {AppError} VALIDATION_FAILED if required fields missing, DB_ERROR on failure
 */
export const createCurrency = async (currencyData) => {
  try {
    // Input validation
    if (!currencyData.code || !currencyData.name_es || !currencyData.name_en || !currencyData.symbol) {
      throw createValidationError({
        code: !currencyData.code ? 'Currency code is required' : null,
        name_es: !currencyData.name_es ? 'Spanish name is required' : null,
        name_en: !currencyData.name_en ? 'English name is required' : null,
        symbol: !currencyData.symbol ? 'Currency symbol is required' : null
      }, 'Currency creation validation');
    }

    const { data, error } = await supabase
      .from('currencies')
      .insert([{
        code: currencyData.code.toUpperCase(),
        name_es: currencyData.name_es,
        name_en: currencyData.name_en,
        symbol: currencyData.symbol,
        is_base: currencyData.is_base || false,
        is_active: true
      }])
      .select()
      .single();

    if (error) {
      throw parseSupabaseError(error);
    }

    return data;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, {
      operation: 'createCurrency',
      code: currencyData.code
    });
    logError(appError, { operation: 'createCurrency', code: currencyData.code });
    throw appError;
  }
};

/**
 * Update an existing currency (ADMIN ONLY)
 * @param {string} currencyId - Currency UUID
 * @param {Object} currencyData - Updated currency data
 * @param {string} [currencyData.name_es] - Spanish name
 * @param {string} [currencyData.name_en] - English name
 * @param {string} [currencyData.symbol] - Currency symbol
 * @param {boolean} [currencyData.is_base] - Whether this is the base currency
 * @param {boolean} [currencyData.is_active] - Whether currency is active
 * @returns {Promise<Object>} Updated currency object
 * @throws {AppError} NOT_FOUND if currency not found, DB_ERROR on failure
 */
export const updateCurrency = async (currencyId, currencyData) => {
  try {
    if (!currencyId) {
      throw createValidationError({ currencyId: 'Currency ID is required' }, 'Missing currency ID');
    }

    const { data, error } = await supabase
      .from('currencies')
      .update({
        name_es: currencyData.name_es,
        name_en: currencyData.name_en,
        symbol: currencyData.symbol,
        is_base: currencyData.is_base !== undefined ? currencyData.is_base : undefined,
        is_active: currencyData.is_active !== undefined ? currencyData.is_active : undefined,
        updated_at: new Date().toISOString()
      })
      .eq('id', currencyId)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw createNotFoundError('Currency', currencyId);
      }
      throw parseSupabaseError(error);
    }

    return data;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, {
      operation: 'updateCurrency',
      currencyId
    });
    logError(appError, { operation: 'updateCurrency', currencyId });
    throw appError;
  }
};

/**
 * Soft delete a currency (set is_active = false) - ADMIN ONLY
 * @param {string} currencyId - Currency UUID
 * @returns {Promise<boolean>} True if successful
 * @throws {AppError} NOT_FOUND if currency not found, DB_ERROR on failure
 */
export const deleteCurrency = async (currencyId) => {
  try {
    if (!currencyId) {
      throw createValidationError({ currencyId: 'Currency ID is required' }, 'Missing currency ID');
    }

    const { error } = await supabase
      .from('currencies')
      .update({ is_active: false })
      .eq('id', currencyId);

    if (error) {
      throw parseSupabaseError(error);
    }

    return true;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, {
      operation: 'deleteCurrency',
      currencyId
    });
    logError(appError, { operation: 'deleteCurrency', currencyId });
    throw appError;
  }
};

/**
 * Get conversion rate between two currencies using IDs
 * CONVERSION HIERARCHY:
 * 1. Check exchange_rates table (defined/API rates)
 * 2. If not found, check official_currency_rates (fallback)
 * 3. If not found, throw SERVICE_UNAVAILABLE error
 *
 * @param {string} fromCurrencyId - Source currency UUID
 * @param {string} toCurrencyId - Target currency UUID
 * @returns {Promise<number>} Conversion rate (amount in fromCurrency * rate = amount in toCurrency)
 * @throws {AppError} NOT_FOUND if currencies not found, SERVICE_UNAVAILABLE if rates unavailable
 */
export const getConversionRate = async (fromCurrencyId, toCurrencyId) => {
  try {
    // Same currency = 1:1 rate
    if (fromCurrencyId === toCurrencyId) {
      return 1;
    }

    if (!fromCurrencyId || !toCurrencyId) {
      throw createValidationError({
        fromCurrencyId: !fromCurrencyId ? 'From currency ID required' : null,
        toCurrencyId: !toCurrencyId ? 'To currency ID required' : null
      }, 'Missing currency IDs');
    }

    // 1. Try to get defined rate
    const { data: rateData, error: rateError } = await supabase
      .from('exchange_rates')
      .select('rate')
      .eq('from_currency_id', fromCurrencyId)
      .eq('to_currency_id', toCurrencyId)
      .eq('is_active', true)
      .order('effective_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (rateError) {
      throw parseSupabaseError(rateError);
    }

    if (rateData && rateData.rate) {
      return parseFloat(rateData.rate);
    }

    // 2. Fallback: Try inverse rate
    const { data: inverseRateData, error: invError } = await supabase
      .from('exchange_rates')
      .select('rate')
      .eq('from_currency_id', toCurrencyId)
      .eq('to_currency_id', fromCurrencyId)
      .eq('is_active', true)
      .order('effective_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (invError) {
      throw parseSupabaseError(invError);
    }

    if (inverseRateData && inverseRateData.rate) {
      return 1 / parseFloat(inverseRateData.rate);
    }

    // 3. Fallback: Official currency rates (table or static defaults)
    const { data: fromCurr, error: err1 } = await supabase
      .from('currencies')
      .select('code')
      .eq('id', fromCurrencyId)
      .single();

    const { data: toCurr, error: err2 } = await supabase
      .from('currencies')
      .select('code')
      .eq('id', toCurrencyId)
      .single();

    if (err1 || err2) {
      throw createNotFoundError('Currency', fromCurrencyId || toCurrencyId);
    }

    const fetchOfficialRate = async (currencyCode) => {
      try {
        if (officialRatesUnavailable) {
          return OFFICIAL_RATE_FALLBACKS[currencyCode] ?? null;
        }

        const { data, error } = await supabase
          .from('official_currency_rates')
          .select('rate_to_usd')
          .eq('currency_code', currencyCode)
          .maybeSingle();

        if (error) {
          const parsed = parseSupabaseError(error);
          const supabaseCode = error?.code || parsed?.context?.originalError?.code || parsed?.context?.postgresCode || parsed?.code || error?.status;
          // If table/column is missing or inaccessible, gracefully fall back
          if (isSchemaMissingError(error) ||
              isSchemaMissingError(parsed) ||
              ['42P01', 'PGRST116', 'PGRST204', '42703', 404, '404'].includes(supabaseCode) ||
              error?.status === 404 ||
              parsed?.context?.originalError?.status === 404) {
            markOfficialRatesUnavailable();
            return OFFICIAL_RATE_FALLBACKS[currencyCode] ?? null;
          }
          throw parsed;
        }

        if (data?.rate_to_usd !== undefined && data?.rate_to_usd !== null) {
          return parseFloat(data.rate_to_usd);
        }

        return OFFICIAL_RATE_FALLBACKS[currencyCode] ?? null;
      } catch (rateError) {
        logError(rateError, { operation: 'getConversionRate - officialRateFallback', currency: currencyCode });
        if (isSchemaMissingError(rateError) || rateError?.status === 404) {
          markOfficialRatesUnavailable();
        }
        return OFFICIAL_RATE_FALLBACKS[currencyCode] ?? null;
      }
    };

    const fromRate = await fetchOfficialRate(fromCurr.code);
    const toRate = await fetchOfficialRate(toCurr.code);

    if (fromRate !== null && fromRate !== undefined && toRate !== null && toRate !== undefined) {
      // Calculate: (1 from_currency = X USD) / (1 to_currency = Y USD) = conversion rate
      return fromRate / toRate;
    }

    throw new Error(`Official rates not found for ${fromCurr.code} or ${toCurr.code}`);

  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.SERVICE_UNAVAILABLE, {
      operation: 'getConversionRate',
      from: fromCurrencyId,
      to: toCurrencyId
    });
    logError(appError, { operation: 'getConversionRate', from: fromCurrencyId, to: toCurrencyId });
    throw appError;
  }
};

/**
 * Convert price from one currency to another
 * General, reusable conversion utility across entire system
 *
 * @param {number} amount - Amount to convert
 * @param {string} fromCurrencyId - Source currency UUID
 * @param {string} toCurrencyId - Target currency UUID
 * @returns {Promise<string>} Converted amount as string with 2 decimal places
 * @throws {AppError} VALIDATION_FAILED if amount invalid, SERVICE_UNAVAILABLE if rates unavailable
 */
export const convertPrice = async (amount, fromCurrencyId, toCurrencyId) => {
  try {
    if (amount === null || amount === undefined || isNaN(amount)) {
      throw createValidationError({ amount: 'Valid numeric amount required' }, 'Invalid amount');
    }

    const rate = await getConversionRate(fromCurrencyId, toCurrencyId);
    const convertedAmount = (amount * rate).toFixed(2);
    return convertedAmount;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.SERVICE_UNAVAILABLE, {
      operation: 'convertPrice',
      amount,
      from: fromCurrencyId,
      to: toCurrencyId
    });
    logError(appError, { operation: 'convertPrice', amount, from: fromCurrencyId, to: toCurrencyId });
    throw appError;
  }
};

/**
 * Get all available conversion rates for a source currency (for UI display)
 * Returns map of all active currencies with their conversion rates
 *
 * @param {string} fromCurrencyId - Source currency UUID
 * @returns {Promise<Object>} Map of {currencyId: {currency, rate, symbol}}
 * @throws {AppError} DB_ERROR if query fails
 */
export const getAllConversionRates = async (fromCurrencyId) => {
  try {
    if (!fromCurrencyId) {
      throw createValidationError({ fromCurrencyId: 'Currency ID required' }, 'Missing currency ID');
    }

    const { data: currencies, error: currError } = await supabase
      .from('currencies')
      .select('id, code, symbol, name_es, name_en')
      .eq('is_active', true);

    if (currError) {
      throw parseSupabaseError(currError);
    }

    // Get conversion rates for all currencies
    const ratesMap = {};
    const conversionPromises = currencies.map(async (curr) => {
      try {
        const rate = await getConversionRate(fromCurrencyId, curr.id);
        ratesMap[curr.id] = {
          currency: curr,
          rate: rate,
          symbol: curr.symbol
        };
      } catch (error) {
        logError(error, {
          operation: 'getAllConversionRates - individual currency',
          fromCurrency: fromCurrencyId,
          toCurrency: curr.id
        });
        // Continue without this currency
      }
    });

    await Promise.all(conversionPromises);
    return ratesMap;

  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, {
      operation: 'getAllConversionRates',
      fromCurrencyId
    });
    logError(appError, { operation: 'getAllConversionRates', fromCurrencyId });
    throw appError;
  }
};

/**
 * Get exchange rate between two currencies using currency codes
 * (Wrapper for backward compatibility - uses getConversionRate internally)
 *
 * @param {string} fromCurrencyCode - Source currency code (USD, EUR, etc.)
 * @param {string} toCurrencyCode - Target currency code
 * @returns {Promise<number>} Conversion rate
 * @throws {AppError} NOT_FOUND if currencies not found, SERVICE_UNAVAILABLE if rates unavailable
 */
export const getExchangeRate = async (fromCurrencyCode, toCurrencyCode) => {
  try {
    // Same currency = 1:1 rate
    if (fromCurrencyCode === toCurrencyCode) {
      return 1;
    }

    if (!fromCurrencyCode || !toCurrencyCode) {
      throw createValidationError({
        fromCurrencyCode: !fromCurrencyCode ? 'From currency code required' : null,
        toCurrencyCode: !toCurrencyCode ? 'To currency code required' : null
      }, 'Missing currency codes');
    }

    // Get both currency IDs
    const { data: currencies, error: currError } = await supabase
      .from('currencies')
      .select('id, code')
      .in('code', [fromCurrencyCode, toCurrencyCode])
      .eq('is_active', true);

    if (currError) {
      throw parseSupabaseError(currError);
    }

    if (!currencies || currencies.length !== 2) {
      throw createNotFoundError('Currency', `${fromCurrencyCode} or ${toCurrencyCode}`);
    }

    const fromCurrency = currencies.find(c => c.code === fromCurrencyCode);
    const toCurrency = currencies.find(c => c.code === toCurrencyCode);

    return await getConversionRate(fromCurrency.id, toCurrency.id);

  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.SERVICE_UNAVAILABLE, {
      operation: 'getExchangeRate',
      from: fromCurrencyCode,
      to: toCurrencyCode
    });
    logError(appError, { operation: 'getExchangeRate', from: fromCurrencyCode, to: toCurrencyCode });
    throw appError;
  }
};

/**
 * Convert amount from one currency to another (using currency codes)
 * (Wrapper for backward compatibility - uses convertPrice internally)
 *
 * @param {number} amount - Amount to convert
 * @param {string} fromCurrencyCode - Source currency code
 * @param {string} toCurrencyCode - Target currency code
 * @returns {Promise<number>} Converted amount
 * @throws {AppError} VALIDATION_FAILED if amount invalid, SERVICE_UNAVAILABLE if rates unavailable
 */
export const convertCurrency = async (amount, fromCurrencyCode, toCurrencyCode) => {
  try {
    if (amount === null || amount === undefined || isNaN(amount)) {
      throw createValidationError({ amount: 'Valid numeric amount required' }, 'Invalid amount');
    }

    const rate = await getExchangeRate(fromCurrencyCode, toCurrencyCode);
    const convertedAmount = amount * rate;

    return convertedAmount;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.SERVICE_UNAVAILABLE, {
      operation: 'convertCurrency',
      amount,
      from: fromCurrencyCode,
      to: toCurrencyCode
    });
    logError(appError, { operation: 'convertCurrency', amount, from: fromCurrencyCode, to: toCurrencyCode });
    throw appError;
  }
};

/**
 * Fetch official exchange rates from exchangerate-api.com
 * Returns rates relative to USD (as fallback for missing defined rates)
 *
 * @returns {Promise<Object>} Map of {currencyCode: rateToUSD}
 * @throws {AppError} NETWORK_ERROR if API call fails
 */
export const fetchOfficialRates = async () => {
  try {
    const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD');

    if (!response.ok) {
      throw new Error('Failed to fetch exchange rates from API');
    }

    const data = await response.json();

    // Return rates for common currencies
    const rates = {
      EUR: data.rates.EUR || 1,
      GBP: data.rates.GBP || 1,
      CAD: data.rates.CAD || 1,
      MXN: data.rates.MXN || 1,
      USD: 1,
      // Note: CUP might not be in API, will need manual input
    };

    return rates;
  } catch (error) {
    const appError = handleError(error, ERROR_CODES.NETWORK_ERROR, {
      operation: 'fetchOfficialRates'
    });
    logError(appError, { operation: 'fetchOfficialRates' });
    throw appError;
  }
};

/**
 * Get all exchange rates (ADMIN VIEW)
 * @returns {Promise<Array>} Array of exchange rate objects with related currencies
 * @throws {AppError} DB_ERROR if query fails
 */
export const getAllExchangeRates = async () => {
  try {
    const { data, error } = await supabase
      .from('exchange_rates')
      .select(`
        id,
        rate,
        effective_date,
        is_active,
        from_currency_id,
        to_currency_id,
        from_currency:from_currency_id(id, code, name_es, name_en, symbol),
        to_currency:to_currency_id(id, code, name_es, name_en, symbol)
      `)
      .eq('is_active', true)
      .order('effective_date', { ascending: false });

    if (error) {
      throw parseSupabaseError(error);
    }

    return data || [];
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getAllExchangeRates' });
    logError(appError, { operation: 'getAllExchangeRates' });
    throw appError;
  }
};

/**
 * Create or update exchange rate (ADMIN ONLY)
 * @param {Object} rateData - Exchange rate data
 * @param {string} rateData.fromCurrencyId - Source currency UUID
 * @param {string} rateData.toCurrencyId - Target currency UUID
 * @param {number} rateData.rate - Exchange rate value
 * @param {string} [rateData.effectiveDate] - Effective date (defaults to today)
 * @returns {Promise<Object>} Created or updated exchange rate object
 * @throws {AppError} VALIDATION_FAILED if required fields missing, DB_ERROR on failure
 */
export const saveExchangeRate = async (rateData) => {
  try {
    // Input validation
    if (!rateData.fromCurrencyId || !rateData.toCurrencyId || rateData.rate === null || rateData.rate === undefined) {
      throw createValidationError({
        fromCurrencyId: !rateData.fromCurrencyId ? 'From currency ID required' : null,
        toCurrencyId: !rateData.toCurrencyId ? 'To currency ID required' : null,
        rate: rateData.rate === null || rateData.rate === undefined ? 'Rate value required' : null
      }, 'Exchange rate validation');
    }

    if (isNaN(parseFloat(rateData.rate))) {
      throw createValidationError({ rate: 'Rate must be a valid number' }, 'Invalid rate format');
    }

    const { data, error } = await supabase
      .from('exchange_rates')
      .upsert({
        from_currency_id: rateData.fromCurrencyId,
        to_currency_id: rateData.toCurrencyId,
        rate: parseFloat(rateData.rate),
        effective_date: rateData.effectiveDate || new Date().toISOString().split('T')[0],
        is_active: true
      }, {
        onConflict: 'from_currency_id,to_currency_id,effective_date'
      })
      .select()
      .single();

    if (error) {
      throw parseSupabaseError(error);
    }

    return data;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, {
      operation: 'saveExchangeRate',
      from: rateData.fromCurrencyId,
      to: rateData.toCurrencyId
    });
    logError(appError, {
      operation: 'saveExchangeRate',
      from: rateData.fromCurrencyId,
      to: rateData.toCurrencyId
    });
    throw appError;
  }
};

/**
 * Soft delete exchange rate (ADMIN ONLY)
 * @param {string} rateId - Exchange rate UUID
 * @returns {Promise<boolean>} True if successful
 * @throws {AppError} NOT_FOUND if rate not found, DB_ERROR on failure
 */
export const deleteExchangeRate = async (rateId) => {
  try {
    if (!rateId) {
      throw createValidationError({ rateId: 'Rate ID required' }, 'Missing rate ID');
    }

    const { error } = await supabase
      .from('exchange_rates')
      .update({ is_active: false })
      .eq('id', rateId);

    if (error) {
      throw parseSupabaseError(error);
    }

    return true;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, {
      operation: 'deleteExchangeRate',
      rateId
    });
    logError(appError, { operation: 'deleteExchangeRate', rateId });
    throw appError;
  }
};

/**
 * Update exchange rate pair - updates both direct and inverse rate (ADMIN ONLY)
 * @param {string} fromCurrencyId - From currency UUID
 * @param {string} toCurrencyId - To currency UUID
 * @param {number} newRate - New exchange rate value (for direct rate, inverse is calculated)
 * @param {string} [effectiveDate] - Effective date (defaults to today)
 * @returns {Promise<{updatedCount: number}>} Number of rates updated
 * @throws {AppError} DB_ERROR on failure
 */
export const updateExchangeRatePair = async (fromCurrencyId, toCurrencyId, newRate, effectiveDate) => {
  try {
    if (!fromCurrencyId || !toCurrencyId) {
      throw createValidationError({
        fromCurrencyId: !fromCurrencyId ? 'From currency ID required' : null,
        toCurrencyId: !toCurrencyId ? 'To currency ID required' : null
      }, 'Missing currency IDs');
    }

    if (newRate === null || newRate === undefined || isNaN(parseFloat(newRate))) {
      throw createValidationError({ rate: 'Valid rate value required' }, 'Invalid rate');
    }

    const rate = parseFloat(newRate);
    const inverseRate = 1 / rate;
    const effDate = effectiveDate || new Date().toISOString().split('T')[0];

    // Update direct rate (from→to)
    const { error: directError } = await supabase
      .from('exchange_rates')
      .update({ rate: rate, effective_date: effDate })
      .eq('from_currency_id', fromCurrencyId)
      .eq('to_currency_id', toCurrencyId)
      .eq('is_active', true);

    if (directError) {
      throw parseSupabaseError(directError);
    }

    // Update inverse rate (to→from)
    const { error: inverseError } = await supabase
      .from('exchange_rates')
      .update({ rate: inverseRate, effective_date: effDate })
      .eq('from_currency_id', toCurrencyId)
      .eq('to_currency_id', fromCurrencyId)
      .eq('is_active', true);

    if (inverseError) {
      throw parseSupabaseError(inverseError);
    }

    return { updatedCount: 2 };
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, {
      operation: 'updateExchangeRatePair',
      fromCurrencyId,
      toCurrencyId
    });
    logError(appError, { operation: 'updateExchangeRatePair', fromCurrencyId, toCurrencyId });
    throw appError;
  }
};

/**
 * Soft delete exchange rate pair - deletes both direct and inverse rate (ADMIN ONLY)
 * @param {string} fromCurrencyId - From currency UUID
 * @param {string} toCurrencyId - To currency UUID
 * @returns {Promise<{deletedCount: number}>} Number of rates deleted
 * @throws {AppError} DB_ERROR on failure
 */
export const deleteExchangeRatePair = async (fromCurrencyId, toCurrencyId) => {
  try {
    if (!fromCurrencyId || !toCurrencyId) {
      throw createValidationError({
        fromCurrencyId: !fromCurrencyId ? 'From currency ID required' : null,
        toCurrencyId: !toCurrencyId ? 'To currency ID required' : null
      }, 'Missing currency IDs');
    }

    // Delete both direct rate (from→to) and inverse rate (to→from)
    const { data, error } = await supabase
      .from('exchange_rates')
      .update({ is_active: false })
      .or(
        `and(from_currency_id.eq.${fromCurrencyId},to_currency_id.eq.${toCurrencyId}),` +
        `and(from_currency_id.eq.${toCurrencyId},to_currency_id.eq.${fromCurrencyId})`
      )
      .eq('is_active', true)
      .select('id');

    if (error) {
      throw parseSupabaseError(error);
    }

    return { deletedCount: data?.length || 0 };
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, {
      operation: 'deleteExchangeRatePair',
      fromCurrencyId,
      toCurrencyId
    });
    logError(appError, { operation: 'deleteExchangeRatePair', fromCurrencyId, toCurrencyId });
    throw appError;
  }
};
