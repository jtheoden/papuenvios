# ⚠️ ERROR HANDLING STANDARD
**PapuEnvíos Project**
**Version:** 1.0
**Date:** 2025-11-21

---

## 📋 TABLE OF CONTENTS
1. [Overview](#overview)
2. [Error Types](#error-types)
3. [Implementation](#implementation)
4. [Usage Examples](#usage-examples)
5. [Testing](#testing)
6. [Logging Strategy](#logging-strategy)

---

## Overview

This document standardizes error handling across the PapuEnvíos application to ensure:
- Consistent error responses across all services
- Proper error logging for debugging and monitoring
- User-friendly error messages
- Secure error information (no sensitive data exposed)

### Current State (Problematic):
```javascript
// UserManagement.jsx
const { error } = await supabase
  .from('user_profiles')
  .update({ is_enabled })
  .eq('id', userId);

if (error) throw error; // ❌ Unhandled, loses context

// remittanceService.js
export const confirmDelivery = async () => {
  try {
    // ...
  } catch (error) {
    return { success: false, error: error.message }; // ❌ Inconsistent pattern
  }
}

// testimonialService.js
try {
  // ...
} catch (error) {
  console.error('Error:', error); // ❌ Insufficient logging
}
```

---

## Error Types

### 1. **AppError** (Custom Application Error)
```javascript
class AppError extends Error {
  constructor(message, code, httpStatus = 500, context = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.context = context; // Additional debugging info
    this.timestamp = new Date().toISOString();
  }
}
```

#### Error Codes (Standard):
```javascript
export const ERROR_CODES = {
  // Authentication
  'AUTH_REQUIRED': { httpStatus: 401, userMessage: 'Por favor, inicie sesión' },
  'AUTH_INVALID_CREDENTIALS': { httpStatus: 401, userMessage: 'Email o contraseña inválidos' },
  'AUTH_TOKEN_EXPIRED': { httpStatus: 401, userMessage: 'Su sesión ha expirado' },
  'AUTH_SESSION_LOST': { httpStatus: 401, userMessage: 'Sesión perdida, por favor inicie sesión nuevamente' },

  // Authorization
  'AUTH_FORBIDDEN': { httpStatus: 403, userMessage: 'No tiene permisos para esta operación' },
  'AUTH_INSUFFICIENT_ROLE': { httpStatus: 403, userMessage: 'Se requiere un rol superior' },

  // Validation
  'VALIDATION_FAILED': { httpStatus: 400, userMessage: 'Datos inválidos. Verifique su entrada' },
  'VALIDATION_MISSING_FIELD': { httpStatus: 400, userMessage: 'Campo requerido faltante' },
  'VALIDATION_INVALID_FORMAT': { httpStatus: 400, userMessage: 'Formato inválido' },

  // Database
  'DB_NOT_FOUND': { httpStatus: 404, userMessage: 'Registro no encontrado' },
  'DB_DUPLICATE_KEY': { httpStatus: 409, userMessage: 'Este registro ya existe' },
  'DB_CONSTRAINT_VIOLATION': { httpStatus: 409, userMessage: 'La operación viola restricciones de datos' },
  'DB_CONNECTION_ERROR': { httpStatus: 503, userMessage: 'Error de conexión a la base de datos' },

  // Business Logic
  'INSUFFICIENT_FUNDS': { httpStatus: 400, userMessage: 'Fondos insuficientes' },
  'DELIVERY_PROOF_REQUIRED': { httpStatus: 400, userMessage: 'Se requiere comprobante de entrega' },
  'PAYMENT_VALIDATION_FAILED': { httpStatus: 400, userMessage: 'Validación de pago fallida' },
  'REMITTANCE_INVALID_STATUS': { httpStatus: 400, userMessage: 'Estado de remesa inválido' },

  // File Operations
  'FILE_UPLOAD_FAILED': { httpStatus: 400, userMessage: 'Error al cargar archivo' },
  'FILE_TOO_LARGE': { httpStatus: 413, userMessage: 'El archivo es demasiado grande' },
  'FILE_INVALID_TYPE': { httpStatus: 400, userMessage: 'Tipo de archivo no permitido' },

  // Server
  'INTERNAL_SERVER_ERROR': { httpStatus: 500, userMessage: 'Error interno del servidor' },
  'SERVICE_UNAVAILABLE': { httpStatus: 503, userMessage: 'Servicio no disponible' },
  'OPERATION_TIMEOUT': { httpStatus: 504, userMessage: 'La operación tardó demasiado tiempo' },
};
```

### 2. **Error Response Format** (Standardized)
All service functions should return:
```javascript
{
  success: boolean,
  data?: any,
  error?: string,
  code?: string,
  timestamp?: string
}
```

**Success Case:**
```javascript
{
  success: true,
  data: { id: '123', name: 'Juan' },
  timestamp: '2025-11-21T10:30:00.000Z'
}
```

**Error Case:**
```javascript
{
  success: false,
  error: 'No tiene permisos para esta operación',
  code: 'AUTH_INSUFFICIENT_ROLE',
  timestamp: '2025-11-21T10:30:00.000Z'
}
```

---

## Implementation

### 1. Create Error Handler Module
**File:** `src/lib/errorHandler.js`

```javascript
/**
 * STANDARDIZED ERROR HANDLING
 * Centralizes error logging, formatting, and response generation
 */

export class AppError extends Error {
  constructor(message, code, httpStatus = 500, context = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.context = context;
    this.timestamp = new Date().toISOString();
  }
}

// Standard error codes and messages
export const ERROR_CODES = {
  'AUTH_REQUIRED': { httpStatus: 401, userMessage: 'Por favor, inicie sesión' },
  'AUTH_INVALID_CREDENTIALS': { httpStatus: 401, userMessage: 'Email o contraseña inválidos' },
  'AUTH_FORBIDDEN': { httpStatus: 403, userMessage: 'No tiene permisos' },
  'VALIDATION_FAILED': { httpStatus: 400, userMessage: 'Datos inválidos' },
  'DB_NOT_FOUND': { httpStatus: 404, userMessage: 'Registro no encontrado' },
  'DB_DUPLICATE_KEY': { httpStatus: 409, userMessage: 'Este registro ya existe' },
  'DELIVERY_PROOF_REQUIRED': { httpStatus: 400, userMessage: 'Se requiere comprobante de entrega' },
  'INTERNAL_SERVER_ERROR': { httpStatus: 500, userMessage: 'Error interno del servidor' },
  // ... more codes
};

/**
 * Log error with context and severity
 * @param {Error} error - The error object
 * @param {string} context - Where error occurred (e.g., 'userService.updateUser')
 * @param {object} additionalInfo - Extra debugging information
 */
export const logError = (error, context, additionalInfo = {}) => {
  const errorLog = {
    timestamp: new Date().toISOString(),
    context,
    message: error.message,
    code: error.code || 'UNKNOWN_ERROR',
    stack: error.stack,
    ...additionalInfo
  };

  // Log level based on severity
  if (error.httpStatus >= 500) {
    console.error('[ERROR - CRITICAL]', JSON.stringify(errorLog, null, 2));
    // TODO: Send to error tracking service (Sentry, etc.)
  } else if (error.httpStatus >= 400) {
    console.warn('[ERROR - CLIENT]', JSON.stringify(errorLog, null, 2));
  } else {
    console.log('[ERROR - INFO]', JSON.stringify(errorLog, null, 2));
  }

  return errorLog;
};

/**
 * Transform error to standard response format
 * @param {Error} error - The error object
 * @param {string} context - Where error occurred
 * @returns {object} Standardized error response
 */
export const handleError = (error, context) => {
  // Log the error with context
  logError(error, context);

  // If already an AppError, use as-is
  if (error instanceof AppError) {
    const errorCode = ERROR_CODES[error.code];
    return {
      success: false,
      error: errorCode?.userMessage || error.message,
      code: error.code,
      timestamp: error.timestamp
    };
  }

  // Handle Supabase errors
  if (error.message?.includes('401')) {
    return {
      success: false,
      error: 'Sesión expirada. Por favor, inicie sesión nuevamente',
      code: 'AUTH_TOKEN_EXPIRED',
      timestamp: new Date().toISOString()
    };
  }

  if (error.message?.includes('permission') || error.message?.includes('Policy')) {
    return {
      success: false,
      error: 'No tiene permisos para esta operación',
      code: 'AUTH_FORBIDDEN',
      timestamp: new Date().toISOString()
    };
  }

  if (error.message?.includes('duplicate')) {
    return {
      success: false,
      error: 'Este registro ya existe',
      code: 'DB_DUPLICATE_KEY',
      timestamp: new Date().toISOString()
    };
  }

  if (error.message?.includes('not found')) {
    return {
      success: false,
      error: 'Registro no encontrado',
      code: 'DB_NOT_FOUND',
      timestamp: new Date().toISOString()
    };
  }

  // Generic error
  return {
    success: false,
    error: 'Ocurrió un error inesperado. Intente nuevamente más tarde',
    code: 'INTERNAL_SERVER_ERROR',
    timestamp: new Date().toISOString()
  };
};

/**
 * Validate input data
 * @param {object} data - Data to validate
 * @param {object} schema - Validation schema { field: 'required|email|minLength:5' }
 * @returns {object} { valid: boolean, errors: {} }
 */
export const validateInput = (data, schema) => {
  const errors = {};

  Object.entries(schema).forEach(([field, rules]) => {
    const value = data[field];
    const rulesList = rules.split('|');

    rulesList.forEach(rule => {
      if (rule === 'required' && !value) {
        errors[field] = `${field} es requerido`;
      }
      if (rule === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        errors[field] = 'Email inválido';
      }
      if (rule.startsWith('minLength:')) {
        const minLength = parseInt(rule.split(':')[1]);
        if (value && value.toString().length < minLength) {
          errors[field] = `${field} debe tener al menos ${minLength} caracteres`;
        }
      }
    });
  });

  return {
    valid: Object.keys(errors).length === 0,
    errors
  };
};
```

### 2. Update Service Functions
**Example:** `src/lib/userService.js`

```javascript
import { AppError, handleError, validateInput, logError } from '@/lib/errorHandler';
import { supabase } from '@/lib/supabase';

/**
 * Update user role
 * @param {string} userId - User ID to update
 * @param {string} newRole - New role (admin, user, super_admin)
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 */
export const updateUserRole = async (userId, newRole) => {
  const context = 'userService.updateUserRole';

  try {
    // Validate input
    const validation = validateInput(
      { userId, newRole },
      { userId: 'required', newRole: 'required' }
    );

    if (!validation.valid) {
      throw new AppError(
        'Validation failed',
        'VALIDATION_FAILED',
        400,
        { errors: validation.errors }
      );
    }

    // Validate role value
    if (!['user', 'admin', 'super_admin'].includes(newRole)) {
      throw new AppError(
        'Invalid role value',
        'VALIDATION_INVALID_FORMAT',
        400,
        { validRoles: ['user', 'admin', 'super_admin'] }
      );
    }

    console.log(`[${context}] Updating user ${userId} to role ${newRole}`);

    const { data, error } = await supabase
      .from('user_profiles')
      .update({ role: newRole })
      .eq('id', userId)
      .select();

    if (error) {
      throw new AppError(
        error.message,
        'DB_UPDATE_FAILED',
        400,
        { userId, newRole, supabaseError: error }
      );
    }

    if (!data || data.length === 0) {
      throw new AppError(
        'User not found',
        'DB_NOT_FOUND',
        404,
        { userId }
      );
    }

    console.log(`[${context}] Successfully updated user ${userId}`);

    return {
      success: true,
      data: data[0],
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    return handleError(error, context);
  }
};

/**
 * Get all users with error handling
 * @returns {Promise<{success: boolean, data?: array, error?: string}>}
 */
export const getAllUsers = async () => {
  const context = 'userService.getAllUsers';

  try {
    console.log(`[${context}] Fetching all users`);

    const { data, error, status } = await supabase
      .from('user_profiles')
      .select('id, email, role, is_enabled, full_name, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      if (status === 401) {
        throw new AppError(
          'Authentication required',
          'AUTH_REQUIRED',
          401
        );
      }

      throw new AppError(
        error.message,
        'DB_QUERY_FAILED',
        500,
        { supabaseError: error }
      );
    }

    console.log(`[${context}] Found ${data?.length || 0} users`);

    return {
      success: true,
      data: data || [],
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    return handleError(error, context);
  }
};
```

### 3. Update Components to Use Standardized Errors

**Example:** `src/components/UserManagement.jsx`

```javascript
const handleRoleChange = async (userId, newRole) => {
  try {
    // Use standardized service error handling
    const result = await updateUserRole(userId, newRole);

    if (!result.success) {
      // Handle error response
      toast({
        title: 'Error al actualizar rol',
        description: result.error,
        variant: 'destructive'
      });
      return;
    }

    // Success
    toast({
      title: 'Éxito',
      description: 'Rol actualizado correctamente',
      variant: 'success'
    });

    await fetchUsers();

  } catch (error) {
    // Unexpected error (should not happen with proper error handling)
    console.error('Unexpected error:', error);
    toast({
      title: 'Error inesperado',
      description: 'Por favor, intente nuevamente',
      variant: 'destructive'
    });
  }
};
```

---

## Usage Examples

### Service Function Example:
```javascript
// src/lib/remittanceService.js
export const confirmDelivery = async (remittanceId, proofFile = null, notes = '') => {
  const context = 'remittanceService.confirmDelivery';

  try {
    // Validation
    if (!remittanceId) {
      throw new AppError(
        'Remittance ID is required',
        'VALIDATION_MISSING_FIELD',
        400,
        { field: 'remittanceId' }
      );
    }

    // Fetch remittance
    const { data: remittance, error } = await supabase
      .from('remittances')
      .select('*')
      .eq('id', remittanceId)
      .single();

    if (error || !remittance) {
      throw new AppError(
        'Remittance not found',
        'DB_NOT_FOUND',
        404,
        { remittanceId }
      );
    }

    // Business logic validation
    const hasExistingProof = remittance.delivery_proof_url?.trim() !== '';
    if (!proofFile && !hasExistingProof) {
      throw new AppError(
        'Delivery proof required',
        'DELIVERY_PROOF_REQUIRED',
        400,
        { remittanceId }
      );
    }

    // Proceed with delivery confirmation
    const { data, error: updateError } = await supabase
      .from('remittances')
      .update({ status: 'delivered', delivered_at: new Date().toISOString() })
      .eq('id', remittanceId)
      .select();

    if (updateError) {
      throw new AppError(
        updateError.message,
        'DB_UPDATE_FAILED',
        500,
        { remittanceId, supabaseError: updateError }
      );
    }

    return {
      success: true,
      data: data[0],
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    return handleError(error, context);
  }
};
```

### Component Usage Example:
```javascript
// src/components/AdminRemittancesTab.jsx
const handleConfirmDelivery = async (remittance) => {
  try {
    const result = await confirmDelivery(remittance.id, null, notes);

    if (!result.success) {
      toast({
        title: 'Error',
        description: result.error,
        variant: 'destructive'
      });
      return;
    }

    toast({
      title: 'Éxito',
      description: 'Entrega confirmada',
      variant: 'success'
    });

    await loadRemittances();

  } catch (error) {
    console.error('Unexpected error in handleConfirmDelivery:', error);
    toast({
      title: 'Error inesperado',
      description: 'Por favor, contacte al soporte',
      variant: 'destructive'
    });
  }
};
```

---

## Testing

### Unit Test Example:
```javascript
// src/__tests__/errorHandler.test.js
import { AppError, handleError, validateInput } from '@/lib/errorHandler';

describe('Error Handling', () => {
  test('AppError should capture error details', () => {
    const error = new AppError(
      'Invalid role',
      'VALIDATION_INVALID_FORMAT',
      400,
      { validRoles: ['user', 'admin'] }
    );

    expect(error.code).toBe('VALIDATION_INVALID_FORMAT');
    expect(error.httpStatus).toBe(400);
    expect(error.context.validRoles).toContain('user');
  });

  test('handleError should convert AppError to response', () => {
    const error = new AppError(
      'Permission denied',
      'AUTH_FORBIDDEN',
      403
    );

    const response = handleError(error, 'test.context');

    expect(response.success).toBe(false);
    expect(response.code).toBe('AUTH_FORBIDDEN');
    expect(response.error).toContain('No tiene permisos');
  });

  test('validateInput should validate required fields', () => {
    const validation = validateInput(
      { email: 'test@example.com', age: '' },
      { email: 'required|email', age: 'required' }
    );

    expect(validation.valid).toBe(false);
    expect(validation.errors.age).toBeDefined();
  });
});
```

---

## Logging Strategy

### Log Levels:
```
ERROR (500+):      System failures, database errors, critical issues
WARNING (400-499): Client errors, validation failures, business logic issues
INFO (Success):    Successful operations, important state changes
DEBUG:             Detailed operation flow (dev only)
```

### Structured Logging:
```javascript
// Every log should include:
{
  timestamp: ISO 8601 string,
  level: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG',
  context: 'module.function',
  message: string,
  code: string (if error),
  userId: string (if available),
  duration: number (execution time in ms),
  additionalData: object
}
```

### TODO: Remote Error Tracking
```javascript
// When implementing production monitoring:
// 1. Integrate Sentry or similar service
// 2. Add error tracking for 500+ status errors
// 3. Set up alerts for critical errors
// 4. Create dashboard for error monitoring
// 5. Implement error pattern detection
```

---

## Migration Plan

### Phase 1: Foundation (1-2 days)
- [ ] Create `errorHandler.js` module
- [ ] Document all error codes
- [ ] Add JSDoc comments

### Phase 2: Service Layer (2-3 days)
- [ ] Update `userService.js`
- [ ] Update `remittanceService.js`
- [ ] Update `orderService.js`
- [ ] Update remaining services

### Phase 3: Components (1-2 days)
- [ ] Update `UserManagement.jsx`
- [ ] Update `AdminRemittancesTab.jsx`
- [ ] Update other components

### Phase 4: Testing (1-2 days)
- [ ] Write unit tests
- [ ] Write integration tests
- [ ] Document patterns

---

**Status:** Ready for implementation
**Estimated Effort:** 5-7 days
**Risk:** LOW (purely code organization, no breaking changes)

