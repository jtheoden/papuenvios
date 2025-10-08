import { supabase } from './supabase';

/**
 * Currency Service - Manages currency CRUD operations
 * Currencies: USD, EUR, CUP (Cuba market focus)
 */

/**
 * Get all active currencies
 * @returns {Promise<{data: Array, error: any}>}
 */
export const getCurrencies = async () => {
  try {
    const { data, error } = await supabase
      .from('currencies')
      .select('*')
      .eq('is_active', true)
      .order('code', { ascending: true });

    if (error) throw error;

    return { data: data || [], error: null };
  } catch (error) {
    console.error('Error fetching currencies:', error);
    return { data: [], error };
  }
};

/**
 * Get all currencies (including inactive)
 * @returns {Promise<{data: Array, error: any}>}
 */
export const getAllCurrencies = async () => {
  try {
    const { data, error } = await supabase
      .from('currencies')
      .select('*')
      .order('code', { ascending: true });

    if (error) throw error;

    return { data: data || [], error: null };
  } catch (error) {
    console.error('Error fetching all currencies:', error);
    return { data: [], error };
  }
};

/**
 * Create a new currency
 * @param {Object} currencyData - Currency data
 * @param {string} currencyData.code - Currency code (USD, EUR, CUP)
 * @param {string} currencyData.name_es - Spanish name
 * @param {string} currencyData.name_en - English name
 * @param {string} currencyData.symbol - Currency symbol
 * @param {boolean} currencyData.is_base - Whether this is the base currency
 * @returns {Promise<{data: Object, error: any}>}
 */
export const createCurrency = async (currencyData) => {
  try {
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

    if (error) throw error;

    return { data, error: null };
  } catch (error) {
    console.error('Error creating currency:', error);
    return { data: null, error };
  }
};

/**
 * Update an existing currency
 * @param {string} currencyId - Currency UUID
 * @param {Object} currencyData - Updated currency data
 * @returns {Promise<{data: Object, error: any}>}
 */
export const updateCurrency = async (currencyId, currencyData) => {
  try {
    const { data, error } = await supabase
      .from('currencies')
      .update({
        name_es: currencyData.name_es,
        name_en: currencyData.name_en,
        symbol: currencyData.symbol,
        is_base: currencyData.is_base !== undefined ? currencyData.is_base : false,
        is_active: currencyData.is_active !== undefined ? currencyData.is_active : true,
        updated_at: new Date().toISOString()
      })
      .eq('id', currencyId)
      .select()
      .single();

    if (error) throw error;

    return { data, error: null };
  } catch (error) {
    console.error('Error updating currency:', error);
    return { data: null, error };
  }
};

/**
 * Soft delete a currency (set is_active = false)
 * @param {string} currencyId - Currency UUID
 * @returns {Promise<{data: boolean, error: any}>}
 */
export const deleteCurrency = async (currencyId) => {
  try {
    const { error } = await supabase
      .from('currencies')
      .update({ is_active: false })
      .eq('id', currencyId);

    if (error) throw error;

    return { data: true, error: null };
  } catch (error) {
    console.error('Error deleting currency:', error);
    return { data: false, error };
  }
};

/**
 * Get exchange rate between two currencies
 * @param {string} fromCurrencyCode - Source currency code
 * @param {string} toCurrencyCode - Target currency code
 * @returns {Promise<{data: number, error: any}>}
 */
export const getExchangeRate = async (fromCurrencyCode, toCurrencyCode) => {
  try {
    // If same currency, rate is 1
    if (fromCurrencyCode === toCurrencyCode) {
      return { data: 1, error: null };
    }

    // Get both currency IDs
    const { data: currencies, error: currError } = await supabase
      .from('currencies')
      .select('id, code')
      .in('code', [fromCurrencyCode, toCurrencyCode])
      .eq('is_active', true);

    if (currError) throw currError;

    if (!currencies || currencies.length !== 2) {
      throw new Error('One or both currencies not found');
    }

    const fromCurrency = currencies.find(c => c.code === fromCurrencyCode);
    const toCurrency = currencies.find(c => c.code === toCurrencyCode);

    // Look for direct exchange rate
    const { data: exchangeRate, error: rateError } = await supabase
      .from('exchange_rates')
      .select('rate')
      .eq('from_currency_id', fromCurrency.id)
      .eq('to_currency_id', toCurrency.id)
      .eq('is_active', true)
      .order('effective_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (rateError) throw rateError;

    if (exchangeRate) {
      return { data: parseFloat(exchangeRate.rate), error: null };
    }

    // If no direct rate, try inverse rate
    const { data: inverseRate, error: invError } = await supabase
      .from('exchange_rates')
      .select('rate')
      .eq('from_currency_id', toCurrency.id)
      .eq('to_currency_id', fromCurrency.id)
      .eq('is_active', true)
      .order('effective_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (invError) throw invError;

    if (inverseRate) {
      return { data: 1 / parseFloat(inverseRate.rate), error: null };
    }

    // No rate found - return 1 as fallback
    console.warn(`No exchange rate found for ${fromCurrencyCode} to ${toCurrencyCode}, using 1:1`);
    return { data: 1, error: null };

  } catch (error) {
    console.error('Error getting exchange rate:', error);
    return { data: null, error };
  }
};

/**
 * Convert amount from one currency to another
 * @param {number} amount - Amount to convert
 * @param {string} fromCurrencyCode - Source currency code
 * @param {string} toCurrencyCode - Target currency code
 * @returns {Promise<{data: number, error: any}>}
 */
export const convertCurrency = async (amount, fromCurrencyCode, toCurrencyCode) => {
  try {
    const { data: rate, error } = await getExchangeRate(fromCurrencyCode, toCurrencyCode);

    if (error) throw error;

    const convertedAmount = amount * rate;

    return { data: convertedAmount, error: null };
  } catch (error) {
    console.error('Error converting currency:', error);
    return { data: null, error };
  }
};

/**
 * Fetch official exchange rates from exchangerate-api.com (free tier)
 * Returns rates relative to USD
 * @returns {Promise<{data: Object, error: any}>}
 */
export const fetchOfficialRates = async () => {
  try {
    // Using exchangerate-api.com free tier (no API key needed for basic usage)
    const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD');

    if (!response.ok) {
      throw new Error('Failed to fetch exchange rates');
    }

    const data = await response.json();

    // Return rates for common currencies
    const rates = {
      EUR: 1 / (data.rates.EUR || 1), // EUR to USD rate
      GBP: 1 / (data.rates.GBP || 1), // GBP to USD rate
      CAD: 1 / (data.rates.CAD || 1), // CAD to USD rate
      MXN: 1 / (data.rates.MXN || 1), // MXN to USD rate
      USD: 1, // USD to USD is always 1
      // Note: CUP might not be in API, will need manual input
    };

    return { data: rates, error: null };
  } catch (error) {
    console.error('Error fetching official rates:', error);
    return { data: null, error };
  }
};

/**
 * Get all exchange rates
 * @returns {Promise<{data: Array, error: any}>}
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
        from_currency:from_currency_id(id, code, name_es, name_en, symbol),
        to_currency:to_currency_id(id, code, name_es, name_en, symbol)
      `)
      .eq('is_active', true)
      .order('effective_date', { ascending: false });

    if (error) throw error;

    return { data: data || [], error: null };
  } catch (error) {
    console.error('Error fetching exchange rates:', error);
    return { data: [], error };
  }
};

/**
 * Create or update exchange rate
 * @param {Object} rateData - Exchange rate data
 * @param {string} rateData.fromCurrencyId - Source currency ID
 * @param {string} rateData.toCurrencyId - Target currency ID
 * @param {number} rateData.rate - Exchange rate value
 * @param {string} rateData.effectiveDate - Effective date (optional, defaults to today)
 * @returns {Promise<{data: Object, error: any}>}
 */
export const saveExchangeRate = async (rateData) => {
  try {
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

    if (error) throw error;

    return { data, error: null };
  } catch (error) {
    console.error('Error saving exchange rate:', error);
    return { data: null, error };
  }
};

/**
 * Delete exchange rate
 * @param {string} rateId - Exchange rate ID
 * @returns {Promise<{data: boolean, error: any}>}
 */
export const deleteExchangeRate = async (rateId) => {
  try {
    const { error } = await supabase
      .from('exchange_rates')
      .update({ is_active: false })
      .eq('id', rateId);

    if (error) throw error;

    return { data: true, error: null };
  } catch (error) {
    console.error('Error deleting exchange rate:', error);
    return { data: false, error };
  }
};
