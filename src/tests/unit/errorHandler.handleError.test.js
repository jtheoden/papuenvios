import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError, ERROR_CODES, handleError, asyncHandler } from '@/lib/errorHandler';

describe('handleError', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns an AppError (throwable) for a plain Error', () => {
    const result = handleError(new Error('boom'), ERROR_CODES.DB_ERROR, { operation: 'x' });
    expect(result).toBeInstanceOf(AppError);
    expect(result.code).toBe(ERROR_CODES.DB_ERROR);
    expect(result.message).toBe('boom');
  });

  it('returns the same AppError instance when given one', () => {
    const original = new AppError('nope', ERROR_CODES.FORBIDDEN, 403);
    expect(handleError(original)).toBe(original);
  });

  it('wraps strings and unknown values', () => {
    expect(handleError('text').message).toBe('text');
    expect(handleError({ a: 1 })).toBeInstanceOf(AppError);
  });
});

describe('asyncHandler', () => {
  it('rejects with an AppError instead of resolving to an error-shaped value', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const wrapped = asyncHandler(async () => { throw new Error('fail'); });
    await expect(wrapped()).rejects.toBeInstanceOf(AppError);
  });
});
