import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));
import { isPermissionDeniedError, classifyCatalogError, classifyAdminCatalogError } from '@/lib/catalogErrors';
import { ADMIN_COST_RPC_UNAVAILABLE } from '@/lib/adminCostService';
import { parseSupabaseError } from '@/lib/errorHandler';

describe('isPermissionDeniedError', () => {
  it('detects a raw PostgREST 42501', () => {
    expect(isPermissionDeniedError({ code: '42501', message: 'permission denied for table products' })).toBe(true);
  });

  it('detects the 42501 kept inside an AppError produced by parseSupabaseError', () => {
    const wrapped = parseSupabaseError({ code: '42501', message: 'permission denied for table products' });
    expect(wrapped.code).not.toBe('42501');
    expect(isPermissionDeniedError(wrapped)).toBe(true);
  });

  it('detects postgresCode in the error context', () => {
    expect(isPermissionDeniedError({ code: 'DB_ERROR', context: { postgresCode: '42501' } })).toBe(true);
  });

  it.each([
    [null],
    [undefined],
    [{ code: '23505' }],
    [{ code: 'PGRST116' }],
    [new Error('boom')]
  ])('is false for %j', (error) => {
    expect(isPermissionDeniedError(error)).toBe(false);
  });
});

describe('classifyCatalogError', () => {
  it('returns "permission" for 42501 and "load" for any other failure', () => {
    expect(classifyCatalogError({ code: '42501' })).toBe('permission');
    expect(classifyCatalogError(new Error('network'))).toBe('load');
  });
});

describe('classifyAdminCatalogError (admin screens that read cost data through RPCs)', () => {
  it('a missing admin RPC (migration not applied) is "adminCosts"', () => {
    expect(classifyAdminCatalogError({ code: ADMIN_COST_RPC_UNAVAILABLE })).toBe('adminCosts');
  });

  it('a 42501 is "permission" and anything else is "load"', () => {
    expect(classifyAdminCatalogError(parseSupabaseError({ code: '42501', message: 'denied' }))).toBe('permission');
    expect(classifyAdminCatalogError(new Error('network down'))).toBe('load');
  });
});
