/**
 * Application Constants
 * Centralized configuration values to eliminate magic numbers and duplicate strings
 */

// localStorage key where supabase-js keeps the session (see src/lib/supabase.js)
export const AUTH_STORAGE_KEY = 'papuenvios-auth';

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
  PROFILE_FETCH: 5000,         // 5s - RLS now fixed, standard query time. Max 5s total auth requirement
  // Per-attempt budget while the role is not resolved yet (first login, no cached
  // role): mobile/lossy links (e.g. Cuba) routinely need >5s, and giving up early
  // used to downgrade the person to a regular user. Background refreshes of an
  // already resolved role keep the short PROFILE_FETCH budget.
  PROFILE_FETCH_INITIAL: 12000,
  // Total budget (from the first profile fetch) before protected routes stop showing the
  // "verifying permissions" spinner and offer "Acceso restringido" + retry; background
  // recovery keeps running and re-grants access if the profile arrives later.
  ROLE_VERIFY_MAX: 15000,
  INIT_AUTH: 6000,             // 6s - global safety timeout (1s buffer for profile + cleanup)
  DEFAULT_QUERY: 10000,
  CAROUSEL_SLIDE: 5000,
};

// Retry Configuration
export const RETRY_CONFIG = {
  PROFILE_FETCH_ATTEMPTS: 2,   // Max 2 attempts: 1st attempt + 1 retry (reduced from 3)
  PROFILE_FETCH_DELAY: 300,    // 300ms delay between retries (reduced from 1000ms)
  // Background recovery while the role is unresolved/provisional: backoff steps,
  // then a steady interval, capped so a permanently missing profile stops polling.
  PROFILE_RECOVERY_DELAYS: [2000, 5000, 10000, 20000],
  PROFILE_RECOVERY_INTERVAL: 30000,
  PROFILE_RECOVERY_MAX_ATTEMPTS: 20,
  ROLE_CACHE_MAX_AGE: 30 * 24 * 60 * 60 * 1000, // 30 days; the cache is a UI hint only
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
  DISPATCHED: 'dispatched',     // Orden despachada/en tránsito
  DELIVERED: 'delivered',       // Orden entregada (con evidencia)
  COMPLETED: 'completed',       // Orden completada (confirmada por usuario)
  CANCELLED: 'cancelled',       // Orden cancelada
};

// Payment Status
export const PAYMENT_STATUS = {
  PENDING: 'pending',
  PROOF_UPLOADED: 'proof_uploaded', // Comprobante de pago subido, esperando validación
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
