import { describe, it, expect } from 'vitest';
import { AppError, ERROR_CODES, createNotFoundError } from '@/lib/errorHandler';
import { isAlreadyDeletedError, shouldRefreshAfterBulkDelete } from '@/lib/deleteOutcomePure';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';

describe('isAlreadyDeletedError', () => {
  it('is true for a NOT_FOUND AppError', () => {
    expect(isAlreadyDeletedError(createNotFoundError('Product', 'p1'))).toBe(true);
  });

  it('is false for other AppError codes', () => {
    expect(isAlreadyDeletedError(new AppError('x', ERROR_CODES.CONFLICT, 409))).toBe(false);
  });

  it('is false for a plain Error, null and undefined', () => {
    expect(isAlreadyDeletedError(new Error('boom'))).toBe(false);
    expect(isAlreadyDeletedError(null)).toBe(false);
    expect(isAlreadyDeletedError(undefined)).toBe(false);
  });
});

describe('shouldRefreshAfterBulkDelete', () => {
  it('refreshes when something was deleted', () => {
    expect(shouldRefreshAfterBulkDelete({ deleted: ['a'], blocked: [] })).toBe(true);
  });

  it('refreshes when a blocked item is not_found', () => {
    expect(
      shouldRefreshAfterBulkDelete({ deleted: [], blocked: [{ id: 'a', reason: 'not_found' }] })
    ).toBe(true);
  });

  it('does not refresh when only blocking_orders items are blocked', () => {
    expect(
      shouldRefreshAfterBulkDelete({ deleted: [], blocked: [{ id: 'a', reason: 'blocking_orders' }] })
    ).toBe(false);
  });

  it('does not refresh on an empty or missing outcome', () => {
    expect(shouldRefreshAfterBulkDelete({ deleted: [], blocked: [] })).toBe(false);
    expect(shouldRefreshAfterBulkDelete(null)).toBe(false);
    expect(shouldRefreshAfterBulkDelete({})).toBe(false);
  });
});

describe('inventory delete translations', () => {
  it.each(['productAlreadyDeleted', 'refreshFailed'])('%s exists and is non-empty in ES and EN', (key) => {
    expect(ES.vendor.inventory[key]?.length).toBeGreaterThan(0);
    expect(EN.vendor.inventory[key]?.length).toBeGreaterThan(0);
  });
});
