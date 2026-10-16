import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  fetchUsdEurReference,
  evaluateReferenceFreshness,
  FxReferenceError,
  FX_REFERENCE_URL,
  FX_REFERENCE_TIMEOUT_MS,
  FX_REFERENCE_BOUNDS,
  FX_REFERENCE_STALE_HOURS
} from '@/lib/fxReference';

const okResponse = (payload) => ({ ok: true, json: () => Promise.resolve(payload) });
const payload = (overrides = {}) => ({
  base: 'USD',
  date: '2026-10-16',
  time_last_updated: 1792108801,
  rates: { USD: 1, EUR: 0.892, CUP: 24 },
  ...overrides
});
const fetchReturning = (body) => vi.fn().mockResolvedValue(okResponse(body));
const codeOf = async (promise) => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(FxReferenceError);
    return error.code;
  }
  return 'did-not-throw';
};

afterEach(() => {
  vi.useRealTimers();
});

describe('fetchUsdEurReference', () => {
  it('returns the EUR rate with the provider metadata and the fetch time', async () => {
    const now = new Date('2026-10-16T12:00:00Z');
    const ref = await fetchUsdEurReference({ fetchImpl: fetchReturning(payload()), now: () => now });

    expect(ref).toEqual({
      pair: 'USD_EUR',
      rate: 0.892,
      providerName: 'ExchangeRate-API',
      providerDomain: 'exchangerate-api.com',
      providerUpdatedAt: new Date(1792108801 * 1000),
      providerDate: '2026-10-16',
      fetchedAt: now
    });
  });

  it('only talks to the fixed provider host and sends no credentials', async () => {
    const fetchImpl = fetchReturning(payload());
    await fetchUsdEurReference({ fetchImpl });

    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe(FX_REFERENCE_URL);
    expect(new URL(url).hostname).toBe('api.exchangerate-api.com');
    expect(options.credentials).toBe('omit');
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ['EUR missing', { rates: { USD: 1 } }],
    ['EUR zero', { rates: { EUR: 0 } }],
    ['EUR negative', { rates: { EUR: -0.9 } }],
    ['EUR NaN', { rates: { EUR: NaN } }],
    ['EUR Infinity', { rates: { EUR: Infinity } }],
    ['EUR string', { rates: { EUR: '0.89' } }],
    ['EUR null', { rates: { EUR: null } }],
    ['rates missing', { rates: undefined }],
    ['rates not an object', { rates: 'nope' }],
    ['base is not USD', { base: 'EUR' }],
    ['base missing', { base: undefined }]
  ])('rejects an invalid payload (%s) instead of falling back to 1', async (_label, overrides) => {
    const code = await codeOf(fetchUsdEurReference({ fetchImpl: fetchReturning(payload(overrides)) }));
    expect(code).toBe('invalid_payload');
  });

  it('rejects a payload that is not an object', async () => {
    expect(await codeOf(fetchUsdEurReference({ fetchImpl: fetchReturning(null) }))).toBe('invalid_payload');
    expect(await codeOf(fetchUsdEurReference({ fetchImpl: fetchReturning([1]) }))).toBe('invalid_payload');
  });

  it('rejects a body that is not JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.reject(new SyntaxError('bad')) });
    expect(await codeOf(fetchUsdEurReference({ fetchImpl }))).toBe('invalid_payload');
  });

  it.each([[0.49], [1.51], [92]])('rejects EUR=%s as out of the sanity band', async (value) => {
    const code = await codeOf(fetchUsdEurReference({ fetchImpl: fetchReturning(payload({ rates: { EUR: value } })) }));
    expect(code).toBe('out_of_band');
  });

  it('accepts the band edges', async () => {
    const low = await fetchUsdEurReference({ fetchImpl: fetchReturning(payload({ rates: { EUR: FX_REFERENCE_BOUNDS.min } })) });
    const high = await fetchUsdEurReference({ fetchImpl: fetchReturning(payload({ rates: { EUR: FX_REFERENCE_BOUNDS.max } })) });
    expect(low.rate).toBe(0.5);
    expect(high.rate).toBe(1.5);
  });

  it('maps a rejected fetch and a non-2xx response to a network error', async () => {
    expect(await codeOf(fetchUsdEurReference({ fetchImpl: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) }))).toBe('network');
    expect(await codeOf(fetchUsdEurReference({ fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 503 }) }))).toBe('network');
  });

  it('aborts after the timeout and reports it', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        })
    );

    const pending = codeOf(fetchUsdEurReference({ fetchImpl }));
    expect(FX_REFERENCE_TIMEOUT_MS).toBe(8000);
    await vi.advanceTimersByTimeAsync(FX_REFERENCE_TIMEOUT_MS + 1);

    expect(await pending).toBe('timeout');
  });

  it('reports a caller abort as aborted, not as a timeout', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        })
    );

    const pending = codeOf(fetchUsdEurReference({ fetchImpl, signal: controller.signal }));
    controller.abort();

    expect(await pending).toBe('aborted');
  });

  it('falls back to the provider date when the timestamp is missing or invalid', async () => {
    const missing = await fetchUsdEurReference({ fetchImpl: fetchReturning(payload({ time_last_updated: undefined })) });
    const invalid = await fetchUsdEurReference({ fetchImpl: fetchReturning(payload({ time_last_updated: 'x' })) });

    expect(missing.providerUpdatedAt).toBeNull();
    expect(missing.providerDate).toBe('2026-10-16');
    expect(invalid.providerUpdatedAt).toBeNull();
  });

  it('keeps no provider date when it is malformed', async () => {
    const ref = await fetchUsdEurReference({ fetchImpl: fetchReturning(payload({ date: 'yesterday', time_last_updated: undefined })) });
    expect(ref.providerDate).toBeNull();
  });
});

describe('evaluateReferenceFreshness', () => {
  const base = { providerUpdatedAt: null, providerDate: null };
  const now = new Date('2026-10-18T00:00:00Z');
  const hoursAgo = (hours) => new Date(now.getTime() - hours * 3600 * 1000);

  it('exposes the stale threshold as a constant', () => {
    expect(FX_REFERENCE_STALE_HOURS).toBe(48);
  });

  it('is fresh within the threshold (inclusive)', () => {
    expect(evaluateReferenceFreshness({ ...base, providerUpdatedAt: hoursAgo(15) }, now)).toBe('fresh');
    expect(evaluateReferenceFreshness({ ...base, providerUpdatedAt: hoursAgo(48) }, now)).toBe('fresh');
  });

  it('is stale beyond the threshold', () => {
    expect(evaluateReferenceFreshness({ ...base, providerUpdatedAt: hoursAgo(60) }, now)).toBe('stale');
  });

  it('uses the provider date (UTC midnight) when there is no timestamp', () => {
    expect(evaluateReferenceFreshness({ ...base, providerDate: '2026-10-17' }, now)).toBe('fresh');
    expect(evaluateReferenceFreshness({ ...base, providerDate: '2026-10-10' }, now)).toBe('stale');
  });

  it('is stale when the provider gave no usable date at all', () => {
    expect(evaluateReferenceFreshness(base, now)).toBe('stale');
  });
});
