/**
 * Application Constants
 * Centralized configuration values to eliminate magic numbers and duplicate strings
 */

// Super Admin Configuration
// NOTE: This should ideally be handled server-side with RLS policies
// Client-side email checks are for UI convenience only, NOT security
export const SUPER_ADMIN_EMAILS = ['jtheoden@gmail.com', 'jtheoden@googlemail.com'];

// File Upload Limits
export const FILE_SIZE_LIMITS = {
  PAYMENT_PROOF: 5 * 1024 * 1024, // 5MB
  AVATAR: 2 * 1024 * 1024, // 2MB
  PRODUCT_IMAGE: 5 * 1024 * 1024, // 5MB
  CAROUSEL_IMAGE: 10 * 1024 * 1024, // 10MB
};

// Supported File Types
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];

// Timeouts (milliseconds)
export const TIMEOUTS = {
  PROFILE_FETCH: 30000,        // Increased to 30s - first DB query is slower, subsequent are cached
  INIT_AUTH: 40000,            // Increased to 40s - give RLS evaluation time
  DEFAULT_QUERY: 10000,
  CAROUSEL_SLIDE: 5000,
};

// Retry Configuration
export const RETRY_CONFIG = {
  PROFILE_FETCH_ATTEMPTS: 3,   // Number of retry attempts for profile fetch
  PROFILE_FETCH_DELAY: 1000,   // Delay between retries (ms)
};

// Default Values
export const DEFAULTS = {
  PRODUCT_PROFIT_MARGIN: 40, // percentage
  COMBO_PROFIT_MARGIN: 35, // percentage
  MIN_STOCK_ALERT: 10,
  DISPLAY_ORDER: 0,
};

// Storage Buckets
export const STORAGE_BUCKETS = {
  PRODUCTS: 'products',
  CAROUSEL: 'carousel-images',
  PAYMENT_PROOFS: 'payment-proofs',
  AVATARS: 'avatars',
};

// Order Status
export const ORDER_STATUS = {
  PENDING: 'pending',           // Orden creada, esperando validación de pago
  PROCESSING: 'processing',     // Pago validado, orden siendo procesada
  SHIPPED: 'shipped',          // Orden enviada/despachada
  DELIVERED: 'delivered',      // Orden entregada (con evidencia)
  COMPLETED: 'completed',      // Orden completada (confirmada por usuario)
  CANCELLED: 'cancelled',      // Orden cancelada
};

// Payment Status
export const PAYMENT_STATUS = {
  PENDING: 'pending',
  VALIDATED: 'validated',
  REJECTED: 'rejected',
};

// Item Types
export const ITEM_TYPES = {
  PRODUCT: 'product',
  COMBO: 'combo',
  REMITTANCE: 'remittance',
};

// User Roles
export const USER_ROLES = {
  USER: 'user',
  ADMIN: 'admin',
  SUPER_ADMIN: 'super_admin',
};

// Currency Codes
export const CURRENCY_CODES = {
  USD: 'USD',
  CUP: 'CUP',
  EUR: 'EUR',
};

// Validation Rules
export const VALIDATION = {
  MIN_PASSWORD_LENGTH: 6,
  MAX_TEXT_LENGTH: 500,
  MAX_DESCRIPTION_LENGTH: 2000,
  PHONE_REGEX: /^[0-9+\-\s()]+$/,
};
