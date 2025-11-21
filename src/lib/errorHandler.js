/**
 * Error Handling System
 *
 * Provides standardized error handling across all application services
 * Includes: AppError class, error transformation, logging, and user-friendly messages
 */

/**
 * AppError Class
 * Base class for all application errors with context, code, and HTTP status
 */
export class AppError extends Error {
  constructor(message, code = 'UNKNOWN_ERROR', httpStatus = 500, context = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.context = context;
    this.timestamp = new Date().toISOString();

    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      httpStatus: this.httpStatus,
      context: this.context,
      timestamp: this.timestamp
    };
  }
}

/**
 * Standard Error Codes
 * Used for consistent error identification and user messaging
 */
export const ERROR_CODES = {
  // Authentication (401)
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  AUTH_SESSION_EXPIRED: 'AUTH_SESSION_EXPIRED',
  AUTH_FAILED: 'AUTH_FAILED',

  // Authorization (403)
  FORBIDDEN: 'FORBIDDEN',
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
  ROLE_REQUIRED: 'ROLE_REQUIRED',

  // Validation (400)
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INVALID_INPUT: 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  INVALID_EMAIL: 'INVALID_EMAIL',
  INVALID_PHONE: 'INVALID_PHONE',

  // Resource (404, 409)
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  CONFLICT: 'CONFLICT',

  // Database
  DB_ERROR: 'DB_ERROR',
  DB_UNIQUE_VIOLATION: 'DB_UNIQUE_VIOLATION',
  DB_FOREIGN_KEY_VIOLATION: 'DB_FOREIGN_KEY_VIOLATION',

  // Network
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
  CONNECTION_FAILED: 'CONNECTION_FAILED',

  // Business Logic
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  INVALID_OPERATION: 'INVALID_OPERATION',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  DELIVERY_PROOF_REQUIRED: 'DELIVERY_PROOF_REQUIRED',

  // Server
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED'
};

/**
 * User-friendly error messages (should be internationalized in production)
 */
const ERROR_MESSAGES = {
  // Authentication
  [ERROR_CODES.AUTH_REQUIRED]: 'Authentication required. Please log in.',
  [ERROR_CODES.INVALID_CREDENTIALS]: 'Invalid email or password.',
  [ERROR_CODES.AUTH_SESSION_EXPIRED]: 'Your session has expired. Please log in again.',
  [ERROR_CODES.AUTH_FAILED]: 'Authentication failed. Please try again.',

  // Authorization
  [ERROR_CODES.FORBIDDEN]: 'You do not have permission to perform this action.',
  [ERROR_CODES.INSUFFICIENT_PERMISSIONS]: 'Insufficient permissions for this operation.',
  [ERROR_CODES.ROLE_REQUIRED]: 'This action requires a specific role.',

  // Validation
  [ERROR_CODES.VALIDATION_FAILED]: 'The provided data is invalid.',
  [ERROR_CODES.INVALID_INPUT]: 'One or more fields contain invalid values.',
  [ERROR_CODES.MISSING_REQUIRED_FIELD]: 'A required field is missing.',
  [ERROR_CODES.INVALID_EMAIL]: 'The email address is invalid.',
  [ERROR_CODES.INVALID_PHONE]: 'The phone number is invalid.',

  // Resource
  [ERROR_CODES.NOT_FOUND]: 'The requested resource was not found.',
  [ERROR_CODES.ALREADY_EXISTS]: 'This resource already exists.',
  [ERROR_CODES.CONFLICT]: 'There is a conflict with existing data.',

  // Database
  [ERROR_CODES.DB_ERROR]: 'A database error occurred. Please try again.',
  [ERROR_CODES.DB_UNIQUE_VIOLATION]: 'This value already exists in the system.',
  [ERROR_CODES.DB_FOREIGN_KEY_VIOLATION]: 'Cannot perform this operation due to data relationships.',

  // Network
  [ERROR_CODES.NETWORK_ERROR]: 'A network error occurred. Please check your connection.',
  [ERROR_CODES.TIMEOUT]: 'The request timed out. Please try again.',
  [ERROR_CODES.CONNECTION_FAILED]: 'Failed to connect to the server.',

  // Business Logic
  [ERROR_CODES.INSUFFICIENT_STOCK]: 'Insufficient stock available for this product.',
  [ERROR_CODES.INVALID_OPERATION]: 'This operation cannot be performed at this time.',
  [ERROR_CODES.PAYMENT_FAILED]: 'Payment processing failed.',
  [ERROR_CODES.DELIVERY_PROOF_REQUIRED]: 'Delivery proof is required to complete this operation.',

  // Server
  [ERROR_CODES.INTERNAL_SERVER_ERROR]: 'An internal server error occurred. Please try again later.',
  [ERROR_CODES.SERVICE_UNAVAILABLE]: 'The service is temporarily unavailable.',
  [ERROR_CODES.NOT_IMPLEMENTED]: 'This feature is not yet implemented.'
};

/**
 * Get user-friendly error message
 */
export const getUserFriendlyMessage = (code, defaultMessage) => {
  return ERROR_MESSAGES[code] || defaultMessage || 'An unexpected error occurred.';
};

/**
 * Error Logger
 * Logs errors with full context for debugging
 */
export const logError = (error, context = {}) => {
  const errorLog = {
    timestamp: new Date().toISOString(),
    name: error.name || 'Error',
    message: error.message,
    code: error.code || 'UNKNOWN',
    context: { ...context, ...error.context },
    stack: error.stack,
    url: typeof window !== 'undefined' ? window.location.href : null,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null
  };

  // Console logging
  console.error('[ERROR]', errorLog);

  // TODO: Send to error tracking service (Sentry, LogRocket, etc.)
  // if (window.__errorTracking) {
  //   window.__errorTracking.captureException(error, { contexts: errorLog });
  // }

  return errorLog;
};

/**
 * Safe Error Handler
 * Wraps errors and ensures they are always AppError instances
 */
export const handleError = (error, code = ERROR_CODES.INTERNAL_SERVER_ERROR, context = {}) => {
  let appError;

  if (error instanceof AppError) {
    appError = error;
  } else if (error instanceof Error) {
    appError = new AppError(error.message, code, 500, context);
  } else if (typeof error === 'string') {
    appError = new AppError(error, code, 500, context);
  } else {
    appError = new AppError('An unexpected error occurred', code, 500, { ...context, originalError: error });
  }

  // Log the error
  logError(appError, context);

  return {
    success: false,
    error: getUserFriendlyMessage(appError.code, appError.message),
    code: appError.code,
    details: appError  // For debugging (remove in production)
  };
};

/**
 * Try-Catch Wrapper for Async Functions
 * Useful for API route handlers and async functions
 */
export const asyncHandler = (fn) => {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      return handleError(error);
    }
  };
};

/**
 * Validation Error Handler
 * For form validation and input validation errors
 */
export const createValidationError = (fieldErrors = {}, message = 'Validation failed') => {
  return new AppError(message, ERROR_CODES.VALIDATION_FAILED, 400, {
    fieldErrors
  });
};

/**
 * Not Found Error Handler
 * For 404 resource not found errors
 */
export const createNotFoundError = (resource = 'Resource', id = null) => {
  const message = id ? `${resource} with ID ${id} not found` : `${resource} not found`;
  return new AppError(message, ERROR_CODES.NOT_FOUND, 404, { resource, id });
};

/**
 * Duplicate/Conflict Error Handler
 * For duplicate entries or conflicting data
 */
export const createConflictError = (resource = 'Resource', field = null) => {
  const message = field
    ? `${resource} with this ${field} already exists`
    : `${resource} already exists`;
  return new AppError(message, ERROR_CODES.ALREADY_EXISTS, 409, { resource, field });
};

/**
 * Permission Error Handler
 * For authorization failures
 */
export const createPermissionError = (action = 'perform this action', requiredRole = null) => {
  const message = requiredRole
    ? `You must have the ${requiredRole} role to ${action}`
    : `You do not have permission to ${action}`;
  return new AppError(message, ERROR_CODES.FORBIDDEN, 403, { action, requiredRole });
};

/**
 * Parse Supabase Error
 * Converts Supabase errors to AppError instances
 */
export const parseSupabaseError = (error) => {
  if (!error) return null;

  // PostgreSQL unique constraint violation
  if (error.code === '23505') {
    return new AppError(
      'This value already exists',
      ERROR_CODES.DB_UNIQUE_VIOLATION,
      409,
      { postgresCode: error.code }
    );
  }

  // PostgreSQL foreign key violation
  if (error.code === '23503') {
    return new AppError(
      'Cannot perform this operation due to data relationships',
      ERROR_CODES.DB_FOREIGN_KEY_VIOLATION,
      400,
      { postgresCode: error.code }
    );
  }

  // Generic database error
  if (error.code?.startsWith('2')) {
    return new AppError(
      error.message || 'Database error occurred',
      ERROR_CODES.DB_ERROR,
      500,
      { postgresCode: error.code, hint: error.hint }
    );
  }

  // Supabase authentication error
  if (error.message?.includes('Auth')) {
    return new AppError(error.message, ERROR_CODES.AUTH_FAILED, 401);
  }

  // Generic error
  return new AppError(
    error.message || 'An error occurred',
    ERROR_CODES.INTERNAL_SERVER_ERROR,
    500,
    { originalError: error }
  );
};

/**
 * Export for convenience
 */
export default {
  AppError,
  ERROR_CODES,
  ERROR_MESSAGES,
  handleError,
  logError,
  getUserFriendlyMessage,
  asyncHandler,
  createValidationError,
  createNotFoundError,
  createConflictError,
  createPermissionError,
  parseSupabaseError
};
