/**
 * Price Calculation Service
 * Centralizes all pricing logic to ensure consistency across the application
 * Handles: base prices, profit margins, currency conversion, and discounts
 */

/**
 * Calculate final price with profit margin
 * @param {number} basePrice - Base price in original currency
 * @param {number} profitMargin - Profit margin as percentage (0-100)
 * @returns {number} Final price with margin applied
 */
export const calculatePriceWithMargin = (basePrice, profitMargin = 40) => {
  if (!basePrice || isNaN(basePrice)) return 0;

  const margin = Math.max(0, Math.min(100, profitMargin || 40)) / 100;
  const finalPrice = parseFloat(basePrice) * (1 + margin);

  return parseFloat(finalPrice.toFixed(2));
};

/**
 * Calculate price for display (use this INSTEAD of applying margin in UI)
 * The final_price from database already includes margin, don't apply it again
 * @param {number} price - Price from product (use final_price, not base_price)
 * @param {object} product - Full product object (optional, for context)
 * @returns {number} Display price (already includes margin)
 */
export const getDisplayPrice = (price, product = null) => {
  if (!price || isNaN(price)) return 0;
  return parseFloat(price).toFixed(2);
};

/**
 * Convert price between currencies
 * @param {number} amount - Amount to convert
 * @param {number} fromRate - Exchange rate of source currency
 * @param {number} toRate - Exchange rate of target currency
 * @returns {number} Converted amount
 */
export const convertPrice = (amount, fromRate = 1, toRate = 1) => {
  if (!amount || isNaN(amount) || !fromRate || isNaN(fromRate) || !toRate || isNaN(toRate)) {
    return 0;
  }

  const converted = (parseFloat(amount) / parseFloat(fromRate)) * parseFloat(toRate);
  return parseFloat(converted.toFixed(2));
};

/**
 * Calculate discount amount
 * @param {number} price - Original price
 * @param {number} discountPercent - Discount percentage (0-100)
 * @returns {number} Discount amount
 */
export const calculateDiscount = (price, discountPercent = 0) => {
  if (!price || isNaN(price) || !discountPercent || discountPercent <= 0) return 0;

  const discount = parseFloat(price) * (Math.min(100, discountPercent) / 100);
  return parseFloat(discount.toFixed(2));
};

/**
 * Apply discount to price
 * @param {number} price - Original price
 * @param {number} discountPercent - Discount percentage (0-100)
 * @returns {number} Price after discount
 */
export const applyDiscount = (price, discountPercent = 0) => {
  const discountAmount = calculateDiscount(price, discountPercent);
  return parseFloat((parseFloat(price) - discountAmount).toFixed(2));
};

/**
 * Calculate price with all modifiers: margin + discount
 * Use this for final price calculation in checkout
 * @param {object} params - Calculation parameters
 * @param {number} params.basePrice - Base price (cost)
 * @param {number} params.profitMargin - Profit margin % (0-100)
 * @param {number} params.discount - Discount percentage (0-100)
 * @param {number} params.exchangeRate - Currency exchange rate (1 = base currency)
 * @returns {object} Object with breakdown of calculation
 */
export const calculateCompletePrice = ({
  basePrice,
  profitMargin = 40,
  discount = 0,
  exchangeRate = 1
} = {}) => {
  if (!basePrice || isNaN(basePrice)) return null;

  const base = parseFloat(basePrice);

  // Step 1: Apply exchange rate
  const converted = convertPrice(base, 1, exchangeRate);

  // Step 2: Apply profit margin (if not already applied in database)
  const withMargin = calculatePriceWithMargin(converted, profitMargin);

  // Step 3: Apply discount (e.g., user category discount)
  const discountAmount = calculateDiscount(withMargin, discount);
  const final = applyDiscount(withMargin, discount);

  return {
    basePrice: parseFloat(base.toFixed(2)),
    afterExchange: parseFloat(converted.toFixed(2)),
    beforeDiscount: parseFloat(withMargin.toFixed(2)),
    discountAmount: parseFloat(discountAmount.toFixed(2)),
    discountPercent: Math.min(100, Math.max(0, discount)),
    finalPrice: parseFloat(final.toFixed(2)),
    profitMargin: Math.max(0, Math.min(100, profitMargin)),
    exchangeRate: parseFloat(exchangeRate)
  };
};

/**
 * Calculate cart subtotal with proper price handling
 * @param {array} cartItems - Array of cart items
 * @param {function} getPriceForItem - Function to get price for each item
 * @returns {number} Subtotal
 */
export const calculateCartSubtotal = (cartItems = [], getPriceForItem = null) => {
  if (!Array.isArray(cartItems) || cartItems.length === 0) return 0;

  const subtotal = cartItems.reduce((sum, item) => {
    const price = getPriceForItem ? getPriceForItem(item) : item.price || 0;
    const quantity = item.quantity || 1;
    return sum + (parseFloat(price) * parseInt(quantity, 10));
  }, 0);

  return parseFloat(subtotal.toFixed(2));
};

/**
 * Apply promotional offer to order
 * @param {number} subtotal - Original subtotal
 * @param {object} offer - Offer object from database
 * @returns {object} Discount and new subtotal
 */
export const applyOffer = (subtotal, offer = null) => {
  if (!offer || !offer.id) {
    return {
      discountAmount: 0,
      finalSubtotal: subtotal,
      offerApplied: false,
      reason: 'No offer provided'
    };
  }

  // Check minimum purchase amount
  if (offer.min_purchase_amount && subtotal < offer.min_purchase_amount) {
    return {
      discountAmount: 0,
      finalSubtotal: subtotal,
      offerApplied: false,
      reason: `Minimum purchase amount not met (${offer.min_purchase_amount} required)`
    };
  }

  let discountAmount = 0;

  if (offer.discount_type === 'percentage') {
    discountAmount = calculateDiscount(subtotal, offer.discount_value);
  } else if (offer.discount_type === 'fixed_amount') {
    discountAmount = Math.min(parseFloat(offer.discount_value), subtotal);
  }

  // Apply max discount cap if set
  if (offer.max_discount_amount) {
    discountAmount = Math.min(discountAmount, parseFloat(offer.max_discount_amount));
  }

  return {
    discountAmount: parseFloat(discountAmount.toFixed(2)),
    finalSubtotal: parseFloat((subtotal - discountAmount).toFixed(2)),
    offerApplied: true,
    offerId: offer.id,
    offerType: offer.discount_type,
    offerValue: offer.discount_value
  };
};

/**
 * Calculate user category discount
 * @param {string} userCategory - User category ('regular', 'pro', 'vip')
 * @param {number} discountValue - Discount percentage for this category
 * @returns {number} Discount percentage to apply
 */
export const getUserCategoryDiscount = (userCategory = 'regular', discountValue = 0) => {
  // Validate category
  const validCategories = ['regular', 'pro', 'vip'];
  const category = validCategories.includes(userCategory) ? userCategory : 'regular';

  // Return discount only if valid and > 0
  return Math.max(0, Math.min(100, discountValue || 0));
};

/**
 * Calculate final order total with all components
 * @param {object} params - Order calculation parameters
 * @param {number} params.subtotal - Subtotal before discounts
 * @param {number} params.categoryDiscount - User category discount percentage
 * @param {object} params.offer - Promotional offer (optional)
 * @param {number} params.shippingCost - Shipping cost
 * @param {number} params.taxPercent - Tax percentage (optional)
 * @returns {object} Complete order calculation breakdown
 */
export const calculateOrderTotal = ({
  subtotal = 0,
  categoryDiscount = 0,
  offer = null,
  shippingCost = 0,
  taxPercent = 0
} = {}) => {
  const sub = parseFloat(subtotal) || 0;
  const shipping = parseFloat(shippingCost) || 0;

  // Step 1: Apply category discount
  const categoryDiscountAmount = calculateDiscount(sub, categoryDiscount);
  const afterCategoryDiscount = sub - categoryDiscountAmount;

  // Step 2: Apply promotional offer (if any)
  const offerResult = applyOffer(afterCategoryDiscount, offer);
  const afterOfferDiscount = offerResult.finalSubtotal;

  // Step 3: Add shipping
  const beforeTax = afterOfferDiscount + shipping;

  // Step 4: Apply tax if configured
  const taxAmount = calculateDiscount(beforeTax, taxPercent);
  const total = beforeTax + taxAmount;

  return {
    subtotal: parseFloat(sub.toFixed(2)),
    categoryDiscountAmount: parseFloat(categoryDiscountAmount.toFixed(2)),
    categoryDiscountPercent: Math.max(0, Math.min(100, categoryDiscount)),
    afterCategoryDiscount: parseFloat(afterCategoryDiscount.toFixed(2)),
    offerDiscountAmount: offerResult.discountAmount,
    offerApplied: offerResult.offerApplied,
    afterAllDiscounts: parseFloat(afterOfferDiscount.toFixed(2)),
    shippingCost: parseFloat(shipping.toFixed(2)),
    subtotalWithShipping: parseFloat(beforeTax.toFixed(2)),
    taxAmount: parseFloat(taxAmount.toFixed(2)),
    taxPercent: Math.max(0, Math.min(100, taxPercent)),
    totalDiscount: parseFloat((categoryDiscountAmount + offerResult.discountAmount).toFixed(2)),
    total: parseFloat(total.toFixed(2))
  };
};

/**
 * Format price for display with currency symbol
 * @param {number} price - Price amount
 * @param {string} currencySymbol - Currency symbol (default: $)
 * @param {number} decimals - Number of decimal places (default: 2)
 * @returns {string} Formatted price string
 */
export const formatPrice = (price, currencySymbol = '$', decimals = 2) => {
  if (typeof price !== 'number' || isNaN(price)) return `${currencySymbol}0.00`;

  const formatted = parseFloat(price).toFixed(decimals);
  return `${currencySymbol}${formatted}`;
};

/**
 * Format price with currency code for international display
 * @param {number} price - Price amount
 * @param {string} currencyCode - Currency code (e.g., 'USD', 'EUR')
 * @param {number} decimals - Number of decimal places
 * @returns {string} Formatted price with code
 */
export const formatPriceWithCode = (price, currencyCode = 'USD', decimals = 2) => {
  if (typeof price !== 'number' || isNaN(price)) return `0.00 ${currencyCode}`;

  const formatted = parseFloat(price).toFixed(decimals);
  return `${formatted} ${currencyCode}`;
};
