import { supabase } from './supabase';
import {
  handleError,
  logError,
  createValidationError,
  createNotFoundError,
  parseSupabaseError,
  AppError,
  ERROR_CODES
} from './errorHandler';
import { rateAgeHours } from './rateAge';
import { subscribeApiWrites, dropApiCaches } from './requestBudget';

const ratesChangedListeners = new Set();

// Only an RLS error proves the role problem. A 0-row write may also mean the rate no longer exists, so it carries
// no requiredRole and the UI (which knows the role) picks the text.
const rateForbiddenError = () => new AppError(
  'Exchange rate not changed: only a super_admin can change exchange rates.',
  ERROR_CODES.FORBIDDEN,
  403,
  { requiredRole: 'super_admin' }
);
const rateNotChangedError = () => new AppError(
  'Exchange rate not changed: no matching active rate was found.',
  ERROR_CODES.NOT_FOUND,
  404,
  { reason: 'no_rows' }
);
const ratePairError = (code, message, context = {}) => new AppError(message, code, 409, context);
const isRlsViolation = (error) => error?.code === '42501' && /row-level security/i.test(error?.message || '');
const parseRateWriteError = (error) => (isRlsViolation(error) ? rateForbiddenError() : parseSupabaseError(error));

/**
 * Subscribe to exchange-rate writes so rate caches can invalidate themselves.
 * @param {function} listener
 * @returns {function} unsubscribe
 */
export const subscribeRatesChanged = (listener) => {
  ratesChangedListeners.add(listener);
  return () => ratesChangedListeners.delete(listener);
};

const notifyRatesChanged = () => {
  ratesChangedListeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      logError(error, { operation: 'notifyRatesChanged' });
    }
  });
};

/**
 * The rates changed (or the caller saw a priced amount differ from the displayed one): drop every cached rate read and
 * tell the rate caches (CurrencyContext reloads).
 */
export const invalidateRateCaches = () => {
  dropApiCaches();
  notifyRatesChanged();
};

// Any write to rates or currencies through the client (including the Settings save paths that update the table
// directly) invalidates the rate caches.
subscribeApiWrites((path) => {
  if (/^\/rest\/v1\/(exchange_rates|currencies)\b/.test(path)) notifyRatesChanged();
});

/**
 * Currency Service - Manages currency CRUD operations and rate conversions
 * Currencies: USD, EUR, CUP (Cuba market focus)
 * Rate conversion uses only active exchange_rates rows; without one it fails closed
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

    // Get currencies that have exchange rates (active OR base currency)
    const { data: currencies, error: currenciesError } = await supabase
      .from('currencies')
      .select('*')
      .or('is_active.eq.true,is_base.eq.true')
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
 * 1. Active direct rate in exchange_rates
 * 2. Inverse of the active opposite rate
 * 3. Otherwise throw SERVICE_UNAVAILABLE (no static or invented fallback)
 *
 * @param {string} fromCurrencyId - Source currency UUID
 * @param {string} toCurrencyId - Target currency UUID
 * @returns {Promise<number>} Conversion rate (amount in fromCurrency * rate = amount in toCurrency)
 * @throws {AppError} SERVICE_UNAVAILABLE if no active rate exists
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

    // One query for every pair (same URL -> deduped and cached by requestBudget): the latest active row of each pair.
    const { data: rows, error: rateError } = await supabase
      .from('exchange_rates')
      .select('from_currency_id, to_currency_id, rate, effective_date')
      .eq('is_active', true)
      .order('effective_date', { ascending: false });

    if (rateError) {
      throw parseSupabaseError(rateError);
    }

    const latestRate = (from, to) => (rows || []).find((r) => r.from_currency_id === from && r.to_currency_id === to)?.rate;

    // 1. Defined rate
    const direct = latestRate(fromCurrencyId, toCurrencyId);
    if (direct) {
      return parseFloat(direct);
    }

    // 2. Fallback: inverse rate
    const inverse = latestRate(toCurrencyId, fromCurrencyId);
    if (inverse) {
      return 1 / parseFloat(inverse);
    }

    // 3. No active pair: fail closed, never invent a rate
    throw new AppError(
      'No active exchange rate for this currency pair',
      ERROR_CODES.SERVICE_UNAVAILABLE,
      503,
      { from: fromCurrencyId, to: toCurrencyId }
    );

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

/** Latest active rate of a directed pair read from the server (never cached), or null. */
const readActivePairRate = async (fromCurrencyId, toCurrencyId) => {
  const { data, error } = await supabase
    .from('exchange_rates')
    .select('rate')
    .eq('from_currency_id', fromCurrencyId)
    .eq('to_currency_id', toCurrencyId)
    .eq('is_active', true)
    .order('effective_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw parseSupabaseError(error);
  }
  return data?.rate ? parseFloat(data.rate) : null;
};

/**
 * Conversion rate read live from the server (direct pair, else the inverse of the opposite pair; fail closed), for
 * every amount that is SAVED (order lines, product prices, remittances). getConversionRate is the cached display read.
 * @throws {AppError} SERVICE_UNAVAILABLE if no active rate exists
 */
export const getLiveConversionRate = async (fromCurrencyId, toCurrencyId) => {
  if (fromCurrencyId === toCurrencyId) return 1;
  const direct = await readActivePairRate(fromCurrencyId, toCurrencyId);
  if (direct) return direct;
  const inverse = await readActivePairRate(toCurrencyId, fromCurrencyId);
  if (inverse) return 1 / inverse;
  throw new AppError(
    'No active exchange rate for this currency pair',
    ERROR_CODES.SERVICE_UNAVAILABLE,
    503,
    { from: fromCurrencyId, to: toCurrencyId }
  );
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

    // Prices an operation (remittance confirmation, cart): live pair reads, never the cached all-rates read.
    return await getLiveConversionRate(fromCurrency.id, toCurrency.id);

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
        updated_at,
        is_active,
        market_rate,
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
 * Active rate of a directed pair by currency CODE, for display (single read source for the UI).
 * Fail closed: no active row or an unusable stored rate -> null, never 0. A failed read throws, so the
 * caller can tell "no rate" from "could not load" and offer a retry.
 *
 * @param {string} fromCode - e.g. 'USD'
 * @param {string} toCode - e.g. 'CUP'
 * @param {{now?: Date}} [options] now is injectable for tests
 * @returns {Promise<{rate: number, effective_date: string, updated_at: string|null, ageHours: number|null}|null>}
 * @throws {AppError} DB_ERROR if the query fails
 */
export const getActiveRate = async (fromCode, toCode, { now = new Date() } = {}) => {
  if (!fromCode || !toCode) return null;
  try {
    const { data, error } = await supabase
      .from('exchange_rates')
      .select('rate, effective_date, updated_at, from_currency:from_currency_id!inner(code), to_currency:to_currency_id!inner(code)')
      .eq('is_active', true)
      .eq('from_currency.code', String(fromCode).toUpperCase())
      .eq('to_currency.code', String(toCode).toUpperCase())
      .order('effective_date', { ascending: false })
      .order('updated_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw parseSupabaseError(error);
    }

    const rate = Number(data?.rate);
    if (!data || !Number.isFinite(rate) || rate <= 0) return null;

    return {
      rate,
      effective_date: data.effective_date,
      updated_at: data.updated_at ?? null,
      ageHours: rateAgeHours(data.effective_date, now)
    };
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getActiveRate', from: fromCode, to: toCode });
    logError(appError, { operation: 'getActiveRate', from: fromCode, to: toCode });
    throw appError;
  }
};

/**
 * All active rates as a `${fromCurrencyId}-${toCurrencyId}` -> rate map (one query, for screens that
 * convert many prices, e.g. the vendor catalog).
 * @returns {Promise<Object<string, number>>}
 * @throws {AppError} DB_ERROR if the query fails
 */
export const getActiveRatesMap = async () => {
  try {
    const { data, error } = await supabase
      .from('exchange_rates')
      .select('from_currency_id, to_currency_id, rate')
      .eq('is_active', true);

    if (error) {
      throw parseSupabaseError(error);
    }

    const map = {};
    (data || []).forEach((r) => {
      map[`${r.from_currency_id}-${r.to_currency_id}`] = r.rate;
    });
    return map;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getActiveRatesMap' });
    logError(appError, { operation: 'getActiveRatesMap' });
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
/**
 * Optional internal reference rate: undefined when not provided (the column is then left untouched), else a
 * positive finite number. Anything else is a validation error.
 */
const parseMarketRate = (value) => {
  if (value === null || value === undefined || value === '') return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw createValidationError({ marketRate: 'Market rate must be a positive finite number' }, 'Invalid market rate');
  }
  return numeric;
};

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
        is_active: true,
        ...(rateData.marketRate !== undefined && { market_rate: rateData.marketRate })
      }, {
        onConflict: 'from_currency_id,to_currency_id,effective_date'
      })
      .select()
      .single();

    if (error) {
      throw parseRateWriteError(error);
    }

    notifyRatesChanged();
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
 * Save both directions of an exchange-rate pair. Client-side compensation is best effort;
 * a future RPC is required for a transactional guarantee.
 * If the inverse write fails, the direct rate is put back as it was: restored when the upsert overwrote a
 * same-day row, deactivated when it created one. If that compensation fails too, EXCHANGE_RATE_PAIR_PARTIAL
 * tells the caller the pair is half written.
 */
export const saveExchangeRatePair = async ({ fromCurrencyId, toCurrencyId, rate, effectiveDate, marketRate }) => {
  const numericRate = Number(rate);
  if (!Number.isFinite(numericRate) || numericRate <= 0) {
    throw createValidationError({ rate: 'Rate must be a positive finite number' }, 'Invalid rate');
  }
  const market = parseMarketRate(marketRate);
  const effDate = effectiveDate || new Date().toISOString().split('T')[0];

  // The upsert overwrites a same-day row (active or not): remember it to be able to put it back.
  const { data: previousRows, error: previousError } = await supabase
    .from('exchange_rates')
    .select('id, rate, is_active, market_rate')
    .eq('from_currency_id', fromCurrencyId)
    .eq('to_currency_id', toCurrencyId)
    .eq('effective_date', effDate);
  if (previousError) throw parseSupabaseError(previousError);
  const previous = previousRows?.[0];

  const direct = await saveExchangeRate({ fromCurrencyId, toCurrencyId, rate: numericRate, effectiveDate: effDate, marketRate: market });
  try {
    const inverse = await saveExchangeRate({
      fromCurrencyId: toCurrencyId,
      toCurrencyId: fromCurrencyId,
      rate: 1 / numericRate,
      effectiveDate: effDate,
      marketRate: market === undefined ? undefined : 1 / market
    });
    return { direct, inverse };
  } catch (inverseError) {
    let compensationError = null;
    try {
      if (previous) {
        const { data, error } = await supabase
          .from('exchange_rates')
          .update({
            rate: previous.rate,
            is_active: previous.is_active,
            ...(market !== undefined && previous.market_rate != null && { market_rate: previous.market_rate })
          })
          .eq('id', previous.id)
          .select('id');
        if (error) throw parseRateWriteError(error);
        if (!data || data.length === 0) throw rateNotChangedError();
      } else {
        await deleteExchangeRate(direct.id);
      }
    } catch (error) {
      compensationError = error;
      logError(error, { operation: 'saveExchangeRatePair - restore direct rate', fromCurrencyId, toCurrencyId });
    }
    notifyRatesChanged();
    if (compensationError) {
      throw ratePairError(
        ERROR_CODES.EXCHANGE_RATE_PAIR_PARTIAL,
        'Exchange rate pair partially written: the inverse failed and the direct rate could not be restored.',
        { fromCurrencyId, toCurrencyId }
      );
    }
    throw inverseError;
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

    const { data, error } = await supabase
      .from('exchange_rates')
      .update({ is_active: false })
      .eq('id', rateId)
      .select('id');

    if (error) {
      throw parseRateWriteError(error);
    }
    if (!data || data.length === 0) {
      throw rateNotChangedError();
    }

    notifyRatesChanged();
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

const UNIQUE_VIOLATION = '23505';

/**
 * Update the ACTIVE row of a directed pair. exchange_rates is unique on (from, to, effective_date), and
 * the admin edit stamps today's date, so an INACTIVE leftover of the same pair and day (created, then
 * deactivated, earlier today) blocks the update with a unique violation. Only that inactive duplicate is
 * cleared, once, and the update is retried; an active row owning the date is never touched and the error
 * is surfaced.
 */
const updateActiveRateRow = async (fromCurrencyId, toCurrencyId, values) => {
  const run = () => supabase
    .from('exchange_rates')
    .update(values)
    .eq('from_currency_id', fromCurrencyId)
    .eq('to_currency_id', toCurrencyId)
    .eq('is_active', true)
    .select('id');

  const result = await run();
  if (result.error?.code !== UNIQUE_VIOLATION) return result;

  const { error: clearError } = await supabase
    .from('exchange_rates')
    .delete()
    .eq('from_currency_id', fromCurrencyId)
    .eq('to_currency_id', toCurrencyId)
    .eq('effective_date', values.effective_date)
    .eq('is_active', false)
    .select('id');
  if (clearError) return result;

  return run();
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
export const updateExchangeRatePair = async (fromCurrencyId, toCurrencyId, newRate, effectiveDate, options = {}) => {
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
    const market = parseMarketRate(options?.marketRate);
    const effDate = effectiveDate || new Date().toISOString().split('T')[0];

    const { data: previousDirectRows, error: previousDirectError } = await supabase
      .from('exchange_rates')
      .select('id, from_currency_id, to_currency_id, rate, effective_date, market_rate')
      .eq('from_currency_id', fromCurrencyId)
      .eq('to_currency_id', toCurrencyId)
      .eq('is_active', true);
    if (previousDirectError) throw parseSupabaseError(previousDirectError);

    const previousDirect = previousDirectRows?.[0];

    // Update direct rate (from→to)
    const { data: directRows, error: directError } = await updateActiveRateRow(
      fromCurrencyId, toCurrencyId,
      { rate: rate, effective_date: effDate, ...(market !== undefined && { market_rate: market }) }
    );

    if (directError) {
      throw parseRateWriteError(directError);
    }

    // The pair may have been deactivated or deleted since the admin loaded it: never report a no-op as saved.
    if (!directRows || directRows.length === 0) {
      throw rateNotChangedError();
    }

    // Update inverse rate (to→from)
    const { data: inverseRows, error: inverseError } = await updateActiveRateRow(
      toCurrencyId, fromCurrencyId,
      { rate: inverseRate, effective_date: effDate, ...(market !== undefined && { market_rate: 1 / market }) }
    );

    // An inverse that errors or matches no active row leaves the pair inconsistent: put the direct rate back.
    if (inverseError || !inverseRows || inverseRows.length === 0) {
      const cause = inverseError
        ? parseRateWriteError(inverseError)
        : ratePairError(
          ERROR_CODES.EXCHANGE_RATE_PAIR_INCOMPLETE,
          'Exchange rate pair incomplete: the inverse rate is missing or inactive; the direct rate was restored.',
          { fromCurrencyId, toCurrencyId }
        );
      let restored = false;
      if (previousDirect) {
        try {
          const { data: restoredRows, error: restoreError } = await updateActiveRateRow(
            fromCurrencyId,
            toCurrencyId,
            {
              rate: previousDirect.rate,
              effective_date: previousDirect.effective_date,
              ...(market !== undefined && previousDirect.market_rate != null && { market_rate: previousDirect.market_rate })
            }
          );
          if (restoreError) throw parseRateWriteError(restoreError);
          restored = Boolean(restoredRows && restoredRows.length > 0);
        } catch (restoreError) {
          logError(restoreError, { operation: 'updateExchangeRatePair - restore direct rate', fromCurrencyId, toCurrencyId });
        }
      }
      notifyRatesChanged();
      if (!restored) {
        throw ratePairError(
          ERROR_CODES.EXCHANGE_RATE_PAIR_PARTIAL,
          'Exchange rate pair partially updated: the inverse failed and the direct rate could not be restored.',
          { fromCurrencyId, toCurrencyId }
        );
      }
      throw cause;
    }

    notifyRatesChanged();
    return { updatedCount: directRows.length + inverseRows.length };
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
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(fromCurrencyId) || !uuidPattern.test(toCurrencyId)) {
      throw createValidationError({
        fromCurrencyId: !uuidPattern.test(fromCurrencyId) ? 'From currency ID must be a UUID' : null,
        toCurrencyId: !uuidPattern.test(toCurrencyId) ? 'To currency ID must be a UUID' : null
      }, 'Invalid currency IDs');
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
      throw parseRateWriteError(error);
    }
    if (!data || data.length === 0) {
      throw rateNotChangedError();
    }

    notifyRatesChanged();
    return { deletedCount: data.length };
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
