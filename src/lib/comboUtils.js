/**
 * Combo Calculation Utilities
 * Shared calculations for combo pricing and currency conversion
 */

/**
 * Convert price between currencies using exchange rates
 * @param {number} amount - Amount to convert
 * @param {string} fromCurrency - Source currency code
 * @param {string} toCurrency - Target currency code
 * @param {object} exchangeRates - Exchange rates map
 * @returns {number} Converted amount
 */
export const convertPrice = (amount, fromCurrency, toCurrency, exchangeRates, baseCurrency = 'USD') => {
  if (!amount || fromCurrency === toCurrency) return amount;

  // Anchor conversions to the configured base currency to avoid double-application errors
  const toBaseKey = `${fromCurrency}/${baseCurrency}`;
  const fromBaseKey = `${toCurrency}/${baseCurrency}`;

  const rateToBase = exchangeRates?.[toBaseKey];
  const rateFromBase = exchangeRates?.[fromBaseKey];

  const amountInBase = rateToBase ? amount / rateToBase : amount;
  const converted = rateFromBase ? amountInBase * rateFromBase : amountInBase;

  // Fallback to direct/inverse pair if base-anchored rates are missing
  if (!rateToBase || !rateFromBase) {
    const directKey = `${fromCurrency}/${toCurrency}`;
    const inverseKey = `${toCurrency}/${fromCurrency}`;

    if (exchangeRates?.[directKey]) {
      return Math.round(amount * exchangeRates[directKey] * 100) / 100;
    }

    if (exchangeRates?.[inverseKey]) {
      return Math.round((amount / exchangeRates[inverseKey]) * 100) / 100;
    }
  }

  return Math.round(converted * 100) / 100;
};

/**
 * Calculate combo prices (base and final with profit margin)
 * @param {object} combo - Combo object with products, productQuantities, profitMargin
 * @param {array} products - Available products for lookup
 * @param {object} exchangeRates - Exchange rates for conversion
 * @param {string} selectedCurrency - Target currency code
 * @param {string} baseCurrency - Base currency code
 * @returns {object} { base, final } prices
 */
export const calculateComboPrices = (
  combo,
  products = [],
  exchangeRates = {},
  selectedCurrency = 'USD',
  baseCurrency = 'USD'
) => {
  if (!combo || !combo.products) {
    return { base: 0, final: 0 };
  }

  // Calculate total base price from selected products
  let basePrice = 0;

  (combo.products || []).forEach(productId => {
    const product = products.find(p => p.id === productId);
    if (product) {
      const quantity = combo.productQuantities?.[productId] || 1;
      const productPrice = product.base_price || product.price || 0;

      // Convert product price to selected currency if needed
      const convertedPrice = selectedCurrency !== baseCurrency
        ? convertPrice(productPrice, baseCurrency, selectedCurrency, exchangeRates, baseCurrency)
        : productPrice;

      basePrice += convertedPrice * quantity;
    }
  });

  // Round to 2 decimals
  basePrice = Math.round(basePrice * 100) / 100;

  // Apply profit margin (combo's own margin, not product margins)
  const profitMargin = parseFloat(combo.profitMargin) || 0;
  const finalPrice = basePrice * (1 + profitMargin / 100);
  const roundedFinalPrice = Math.round(finalPrice * 100) / 100;

  return {
    base: basePrice,
    final: roundedFinalPrice
  };
};

/**
 * Compute combo pricing using stored base totals (when available) and
 * a caller-provided currency converter to keep user/admin views in sync.
 *
 * @param {Object} params
 * @param {Object} params.combo - Combo object (expects base_total_price/profit_margin)
 * @param {Array} [params.products=[]] - Product catalog for price lookups
 * @param {Function} params.convert - Conversion fn(amount, fromCurrencyId, toCurrencyId)
 * @param {string} params.selectedCurrencyId - Target currency UUID
 * @param {string} params.baseCurrencyId - Base currency UUID
 * @param {number} [params.defaultProfitMargin=0] - Default combo margin when absent
 * @returns {{ basePrice: number, finalPrice: number }}
 */
export const computeComboPricing = ({
  combo,
  products = [],
  convert,
  selectedCurrencyId,
  baseCurrencyId,
  defaultProfitMargin = 0
}) => {
  if (!combo) return { basePrice: 0, finalPrice: 0 };

  const storedBaseTotal = parseFloat(combo.baseTotalPrice ?? combo.base_total_price ?? 0) || 0;
  const profitMargin = parseFloat(combo.profitMargin ?? combo.profit_margin ?? defaultProfitMargin) || 0;

  // Normalize product prices to base currency when possible to avoid drift
  let computedBaseTotal = 0;
  (combo.products || []).forEach(productId => {
    const product = products.find(p => p.id === productId);
    if (!product) return;

    const quantity = combo.productQuantities?.[productId] || 1;
    const basePrice = parseFloat(product.base_price ?? 0) || 0;

    let normalizedPrice = basePrice;
    if (convert && baseCurrencyId && product.base_currency_id && product.base_currency_id !== baseCurrencyId) {
      normalizedPrice = convert(basePrice, product.base_currency_id, baseCurrencyId);
    }

    computedBaseTotal += normalizedPrice * quantity;
  });

  const baseTotal = computedBaseTotal > 0 ? computedBaseTotal : storedBaseTotal;
  const baseInSelected = convert && selectedCurrencyId && baseCurrencyId && selectedCurrencyId !== baseCurrencyId
    ? convert(baseTotal, baseCurrencyId, selectedCurrencyId)
    : baseTotal;

  const roundedBase = Math.round((baseInSelected || 0) * 100) / 100;
  const finalPrice = Math.round(roundedBase * (1 + profitMargin / 100) * 100) / 100;

  return { basePrice: roundedBase, finalPrice };
};

/**
 * Check for stock issues in combo products
 * @param {object} combo - Combo object
 * @param {array} products - Available products
 * @param {string} language - Current language (es/en)
 * @returns {array} Array of stock issues
 */
export const checkComboStockIssues = (combo, products = [], language = 'es') => {
  const issues = [];

  if (!combo.products) return issues;

  combo.products.forEach(productId => {
    const product = products.find(p => p.id === productId);
    const requiredQuantity = combo.productQuantities?.[productId] || 1;
    const availableStock = product?.stock || 0;
    const productName = product?.name_es || product?.name || 'Unknown';

    if (availableStock === 0) {
      issues.push({
        productName,
        issue: 'out_of_stock',
        required: requiredQuantity,
        available: 0
      });
    } else if (availableStock < requiredQuantity) {
      issues.push({
        productName,
        issue: 'insufficient',
        required: requiredQuantity,
        available: availableStock
      });
    }
  });

  return issues;
};
