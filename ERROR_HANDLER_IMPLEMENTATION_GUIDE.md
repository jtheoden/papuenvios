# Error Handler Implementation Guide

**Status:** Phase 2.6 in progress - 4 of 15 critical services refactored

## Quick Summary

We've established a comprehensive error handling system using the `AppError` class. This guide provides the pattern and template for refactoring the remaining services.

### Completed Refactoring ✅

1. **userService.js** - User authentication, profile management, permission checking
2. **productService.js** - Product and category CRUD operations
3. **testimonialService.js** - Testimonial management with RPC calls
4. **comboService.js** - Combo bundle management with related items

### Remaining Services (11)

**Large & Complex:**
- orderService.js (1,022 lines, 16 functions) - ⏳
- remittanceService.js (1,100+ lines) - ⏳

**Medium Size:**
- bankService.js (10 KB)
- currencyService.js (10 KB)
- recipientService.js (15 KB)
- shippingService.js (12 KB)
- systemMessageService.js (11 KB)
- whatsappService.js (25 KB)
- zelleService.js (9 KB)

**Small Size:**
- carouselService.js (6 KB)
- visualSettingsService.js (5.5 KB)
- imageUtils.js (8 KB)
- passwordValidation.js (2.2 KB)

---

## Implementation Template

### Step 1: Add Imports

```javascript
// At the top of the service file, add:
import {
  handleError,
  logError,
  createValidationError,
  createNotFoundError,
  createConflictError,
  createPermissionError,
  parseSupabaseError,
  ERROR_CODES
} from './errorHandler';
```

### Step 2: Replace Error Pattern

**BEFORE (Old Pattern):**
```javascript
export const getUsers = async () => {
  try {
    const { data, error } = await supabase.from('users').select();
    if (error) throw error;
    return { data, error: null };  // ❌ Old pattern
  } catch (error) {
    console.error('Error:', error);  // ❌ console.error
    return { data: null, error };    // ❌ Old pattern
  }
};
```

**AFTER (New Pattern):**
```javascript
/**
 * Get all users
 * @throws {AppError} If database query fails
 * @returns {Promise<Array>} Array of users
 */
export const getUsers = async () => {
  try {
    const { data, error } = await supabase.from('users').select();

    if (error) {
      const appError = parseSupabaseError(error);  // ✅ Convert error
      logError(appError, { operation: 'getUsers' }); // ✅ Log with context
      throw appError;  // ✅ Throw AppError
    }

    return data;  // ✅ Return data directly, not {data, error}
  } catch (error) {
    if (error.code) throw error;  // ✅ Already an AppError
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getUsers' });
    throw appError;
  }
};
```

### Step 3: Add Validation for Create/Update Functions

```javascript
/**
 * Create a new user
 * @param {Object} userData - User data
 * @throws {AppError} If validation fails or creation fails
 * @returns {Promise<Object>} Created user
 */
export const createUser = async (userData) => {
  try {
    // ✅ Add input validation
    if (!userData.email) {
      throw createValidationError({ email: 'Email is required' });
    }

    if (!userData.password || userData.password.length < 8) {
      throw createValidationError(
        { password: 'Password must be at least 8 characters' },
        'Invalid password'
      );
    }

    const { data, error } = await supabase.from('users').insert([userData]).select().single();

    if (error) {
      const appError = parseSupabaseError(error);
      logError(appError, { operation: 'createUser', email: userData.email });
      throw appError;
    }

    return data;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'createUser' });
    throw appError;
  }
};
```

### Step 4: Handle Special Cases

**For 404 Not Found:**
```javascript
const { data, error } = await supabase.from('users').select().eq('id', userId).single();

if (error) {
  const appError = parseSupabaseError(error);
  if (!data) {
    throw createNotFoundError('User', userId);  // ✅ Specific 404 error
  }
  throw appError;
}
```

**For Duplicate/Conflict:**
```javascript
if (error?.code === '23505') {  // Unique constraint violation
  throw createConflictError('User', 'email');  // ✅ Specific 409 error
}
```

**For Graceful Fallback (Non-Critical Operations):**
```javascript
const { data: relatedData, error: relError } = await supabase.from('related').select();

if (relError) {
  const appError = parseSupabaseError(relError);
  logError(appError, {
    operation: 'getMainItem - related fetch',
    mainId: id
  });
  // Don't throw - just continue without related data
}
```

---

## Error Code Reference

Use these error codes for specific scenarios:

### Validation Errors (400)
```javascript
throw createValidationError(
  { fieldName: 'Error message' },
  'Human-readable message'
);
// Automatically maps to ERROR_CODES.VALIDATION_FAILED (400 HTTP)
```

### Not Found (404)
```javascript
throw createNotFoundError('Resource', resourceId);
// Automatically maps to ERROR_CODES.NOT_FOUND (404 HTTP)
```

### Conflict/Duplicate (409)
```javascript
throw createConflictError('User', 'email');
// Automatically maps to ERROR_CODES.ALREADY_EXISTS (409 HTTP)
```

### Permission Error (403)
```javascript
throw createPermissionError('delete users', 'admin');
// Automatically maps to ERROR_CODES.FORBIDDEN (403 HTTP)
```

### Database Error (500)
```javascript
parseSupabaseError(error);  // Handles PostgreSQL codes (23505, 23503, etc.)
// Returns AppError with appropriate error code
```

---

## Available Error Codes (25 Total)

### Authentication (401)
- `AUTH_REQUIRED`
- `INVALID_CREDENTIALS`
- `AUTH_SESSION_EXPIRED`
- `AUTH_FAILED`

### Authorization (403)
- `FORBIDDEN`
- `INSUFFICIENT_PERMISSIONS`
- `ROLE_REQUIRED`

### Validation (400)
- `VALIDATION_FAILED`
- `INVALID_INPUT`
- `MISSING_REQUIRED_FIELD`
- `INVALID_EMAIL`
- `INVALID_PHONE`

### Resource (404, 409)
- `NOT_FOUND`
- `ALREADY_EXISTS`
- `CONFLICT`

### Database (500)
- `DB_ERROR`
- `DB_UNIQUE_VIOLATION` (PostgreSQL 23505)
- `DB_FOREIGN_KEY_VIOLATION` (PostgreSQL 23503)

### Network (5xx)
- `NETWORK_ERROR`
- `TIMEOUT`
- `CONNECTION_FAILED`

### Business Logic (400, 409)
- `INSUFFICIENT_STOCK`
- `INVALID_OPERATION`
- `PAYMENT_FAILED`
- `DELIVERY_PROOF_REQUIRED`

### Server (500)
- `INTERNAL_SERVER_ERROR`
- `SERVICE_UNAVAILABLE`
- `NOT_IMPLEMENTED`

---

## Usage in Components

Once services are refactored, components should use try-catch:

```javascript
// BEFORE (Old pattern)
const { data: users, error } = await userService.getAllUsers();
if (error) {
  console.error('Failed:', error);
}

// AFTER (New pattern)
try {
  const users = await userService.getAllUsers();
  // Handle success
} catch (error) {
  if (error.code === 'VALIDATION_FAILED') {
    // Show validation errors
    console.log(error.context.fieldErrors);
  } else if (error.code === 'NOT_FOUND') {
    // Show not found message
  } else {
    // Generic error handling
    console.error(error.message);
  }
}
```

---

## Service Refactoring Priority

### Priority 1 (Business Critical)
1. **orderService.js** - Core ordering functionality
2. **remittanceService.js** - International transfers
3. **zelleService.js** - Payment integration

### Priority 2 (User-Facing)
4. **recipientService.js** - Recipient management
5. **shippingService.js** - Shipping calculations
6. **bankService.js** - Bank account management

### Priority 3 (Support Services)
7. **currencyService.js** - Currency conversion
8. **systemMessageService.js** - Admin messages
9. **whatsappService.js** - Notifications
10. **carouselService.js** - Homepage content
11. **visualSettingsService.js** - Theme configuration

---

## Batch Refactoring Script

To speed up refactoring multiple services:

1. Copy the template above
2. For each service, systematically:
   - Add imports (Step 1)
   - Update error handling (Step 2)
   - Add validation (Step 3)
   - Commit each service separately

3. Test by running:
   ```bash
   npm run dev
   # Open browser and test each service endpoint
   ```

---

## Key Patterns Summary

### Always Do:
✅ Add JSDoc comments with @throws and @returns
✅ Use parseSupabaseError() for Supabase errors
✅ Call logError() with operation context
✅ Add input validation with createValidationError()
✅ Check for null/missing data and use createNotFoundError()
✅ Use graceful fallback for non-critical operations
✅ Return data directly (not {data, error})
✅ Throw AppError instances (not raw errors)

### Never Do:
❌ Use console.error() (use logError instead)
❌ Return {data: null, error} pattern (throw instead)
❌ Swallow errors without logging
❌ Mix error patterns (throw AND return errors)
❌ Skip input validation on create/update
❌ Fail on non-critical operations (RPC calls, related data)

---

## Example: Complete Refactored Service

See these files for complete examples:
- [src/lib/userService.js](./src/lib/userService.js) - Auth & permissions pattern
- [src/lib/productService.js](./src/lib/productService.js) - CRUD with inventory
- [src/lib/testimonialService.js](./src/lib/testimonialService.js) - RPC calls with fallback
- [src/lib/comboService.js](./src/lib/comboService.js) - Related items management

---

## Next Steps

1. Use this template for remaining 11 services
2. Test each service after refactoring
3. Update components to use try-catch pattern
4. Run full test suite to verify error handling

---

**Generated:** November 21, 2025
**Last Updated:** During Phase 2.6 error handler implementation
