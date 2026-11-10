/**
 * Catalog repricing services (phase 4). The migration may not be applied yet: a missing RPC/table must come back
 * as { unavailable: true } and never throw, so the rate flow keeps working exactly as before.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ rpc: vi.fn(), runs: vi.fn() }));
const cache = vi.hoisted(() => ({ invalidateCatalog: vi.fn() }));

vi.mock('@/lib/catalogCache', () => ({ invalidateCatalog: (...a) => cache.invalidateCatalog(...a) }));

vi.mock('@/lib/supabase', () => {
  const chain = {};
  ['select', 'order', 'limit'].forEach((m) => { chain[m] = () => chain; });
  chain.maybeSingle = () => db.runs();
  return { supabase: { rpc: (...a) => db.rpc(...a), from: () => chain } };
});
vi.mock('@/lib/errorHandler', async (orig) => ({ ...(await orig()), logError: vi.fn() }));

import { previewCatalogReprice, applyCatalogReprice, getCatalogRepriceStatus } from '@/lib/currencyService';

const UNAVAILABLE_ERRORS = [
  { code: 'PGRST202', message: 'Could not find the function' },
  { code: '42883', message: 'function does not exist' },
  { code: '42P01', message: 'relation does not exist' },
  { status: 404, message: 'Not Found' },
  { code: 'PGRST205', message: 'Could not find the table' },
  { message: 'Could not find the function public.apply_catalog_reprice(p_confirm_large) in the schema cache' },
  { message: 'relation "public.catalog_reprice_runs" does not exist' }
];

beforeEach(() => {
  db.rpc.mockReset();
  db.runs.mockReset();
  cache.invalidateCatalog.mockReset();
});

describe('previewCatalogReprice', () => {
  it('calls the RPC with the new rate and returns its payload', async () => {
    db.rpc.mockResolvedValue({ data: { products_affected: 3 }, error: null });
    await expect(previewCatalogReprice(520)).resolves.toEqual({ data: { products_affected: 3 } });
    expect(db.rpc).toHaveBeenCalledWith('preview_catalog_reprice', { p_rate: 520 });
  });

  it('sends null when no rate is given (uses the active rate)', async () => {
    db.rpc.mockResolvedValue({ data: {}, error: null });
    await previewCatalogReprice();
    expect(db.rpc).toHaveBeenCalledWith('preview_catalog_reprice', { p_rate: null });
  });

  it.each([0, -1, 'abc', NaN])('rejects the invalid rate %s without calling the RPC', async (rate) => {
    await expect(previewCatalogReprice(rate)).rejects.toMatchObject({ code: expect.any(String) });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it.each(UNAVAILABLE_ERRORS)('reports unavailable (no throw) for %o', async (error) => {
    db.rpc.mockResolvedValue({ data: null, error });
    await expect(previewCatalogReprice(520)).resolves.toEqual({ unavailable: true });
  });

  it('returns other database errors as { error }', async () => {
    db.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'forbidden' } });
    const result = await previewCatalogReprice(520);
    expect(result.error).toBeTruthy();
    expect(result.data).toBeUndefined();
  });
});

describe('applyCatalogReprice', () => {
  it('passes the large-change confirmation flag', async () => {
    db.rpc.mockResolvedValue({ data: { products_updated: 2 }, error: null });
    await expect(applyCatalogReprice(true)).resolves.toEqual({ data: { products_updated: 2 } });
    expect(db.rpc).toHaveBeenCalledWith('apply_catalog_reprice', { p_confirm_large: true, p_expected_rate: null });
  });

  it('defaults the flag to false', async () => {
    db.rpc.mockResolvedValue({ data: {}, error: null });
    await applyCatalogReprice();
    expect(db.rpc).toHaveBeenCalledWith('apply_catalog_reprice', { p_confirm_large: false, p_expected_rate: null });
  });

  it.each(UNAVAILABLE_ERRORS)('reports unavailable for %o', async (error) => {
    db.rpc.mockResolvedValue({ data: null, error });
    await expect(applyCatalogReprice(false)).resolves.toEqual({ unavailable: true });
  });

  it('returns an RPC failure as { error }, never throws', async () => {
    db.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'large_change_requires_confirmation' } });
    const result = await applyCatalogReprice(false);
    expect(result.error).toBeTruthy();
  });

  it('returns a rejected request as { error }', async () => {
    db.rpc.mockRejectedValue(new Error('network'));
    const result = await applyCatalogReprice(false);
    expect(result.error).toBeTruthy();
  });
});

describe('applyCatalogReprice drops the catalog cache only when prices moved', () => {
  it.each([
    [{ products_updated: 2, combos_updated: 0 }],
    [{ products_updated: 0, combos_updated: 1 }]
  ])('invalidates for %o', async (data) => {
    db.rpc.mockResolvedValue({ data, error: null });
    await applyCatalogReprice(false, 920);
    expect(cache.invalidateCatalog).toHaveBeenCalledTimes(1);
  });

  it('does not invalidate when nothing changed', async () => {
    db.rpc.mockResolvedValue({ data: { products_updated: 0, combos_updated: 0 }, error: null });
    await applyCatalogReprice(false, 920);
    expect(cache.invalidateCatalog).not.toHaveBeenCalled();
  });

  it.each([
    [{ data: null, error: { code: 'P0001', message: 'rate_changed' } }],
    [{ data: null, error: { code: 'PGRST202', message: 'x' } }],
    [{ data: null, error: { code: 'P0001', message: 'boom' } }]
  ])('does not invalidate on %o', async (response) => {
    db.rpc.mockResolvedValue(response);
    await applyCatalogReprice(false, 920);
    expect(cache.invalidateCatalog).not.toHaveBeenCalled();
  });
});

describe('applyCatalogReprice expected rate', () => {
  it('sends the rate the caller just confirmed', async () => {
    db.rpc.mockResolvedValue({ data: {}, error: null });
    await applyCatalogReprice(false, 920.5);
    expect(db.rpc).toHaveBeenCalledWith('apply_catalog_reprice', { p_confirm_large: false, p_expected_rate: 920.5 });
  });

  it.each([0, -3, 'abc'])('rejects the invalid expected rate %s', async (rate) => {
    await expect(applyCatalogReprice(false, rate)).rejects.toMatchObject({ code: expect.any(String) });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('flags rate_changed instead of a generic error', async () => {
    db.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'rate_changed' } });
    await expect(applyCatalogReprice(false, 920)).resolves.toEqual({ rateChanged: true });
  });
});

describe('getCatalogRepriceStatus', () => {
  it('returns the last run', async () => {
    db.runs.mockResolvedValue({ data: { rate: '520.000000', applied_at: '2026-11-10T10:00:00Z' }, error: null });
    await expect(getCatalogRepriceStatus()).resolves.toEqual({ data: { rate: '520.000000', applied_at: '2026-11-10T10:00:00Z' } });
  });

  it('returns data null when there was no run yet', async () => {
    db.runs.mockResolvedValue({ data: null, error: null });
    await expect(getCatalogRepriceStatus()).resolves.toEqual({ data: null });
  });

  it.each(UNAVAILABLE_ERRORS)('reports unavailable for %o', async (error) => {
    db.runs.mockResolvedValue({ data: null, error });
    await expect(getCatalogRepriceStatus()).resolves.toEqual({ unavailable: true });
  });
});
