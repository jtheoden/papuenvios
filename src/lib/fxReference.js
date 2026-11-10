/**
 * External USD->EUR reference rate (informational only).
 *
 * The value is never persisted and never feeds a calculation or a quote: an admin may preload it
 * into the rate form, and saving goes through the regular, validated rate flow.
 */

// Fixed host on purpose: nothing user-controlled can redirect this request.
export const FX_REFERENCE_URL = 'https://api.exchangerate-api.com/v4/latest/USD';
export const FX_REFERENCE_PROVIDER_NAME = 'ExchangeRate-API';
export const FX_REFERENCE_PROVIDER_DOMAIN = 'exchangerate-api.com';
export const FX_REFERENCE_TIMEOUT_MS = 8000;
export const FX_REFERENCE_BOUNDS = Object.freeze({ min: 0.5, max: 1.5 });
export const FX_REFERENCE_STALE_HOURS = 48;

const MS_PER_HOUR = 3600 * 1000;
const MS_PER_SECOND = 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class FxReferenceError extends Error {
  /** @param {'network'|'timeout'|'aborted'|'invalid_payload'|'out_of_band'} code */
  constructor(code, message) {
    super(message || code);
    this.name = 'FxReferenceError';
    this.code = code;
  }
}

const parseProviderTimestamp = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return new Date(value * MS_PER_SECOND);
};

const parseProviderDate = (value) => {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return null;
  return Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()) ? null : value;
};

const readJson = async (response) => {
  try {
    return await response.json();
  } catch {
    throw new FxReferenceError('invalid_payload', 'Response is not valid JSON');
  }
};

const validatePayload = (data) => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new FxReferenceError('invalid_payload', 'Payload is not an object');
  }
  if (data.base !== 'USD') throw new FxReferenceError('invalid_payload', 'Unexpected base currency');
  const eur = data.rates && typeof data.rates === 'object' ? data.rates.EUR : undefined;
  if (typeof eur !== 'number' || !Number.isFinite(eur) || eur <= 0) {
    throw new FxReferenceError('invalid_payload', 'EUR rate missing or invalid');
  }
  if (eur < FX_REFERENCE_BOUNDS.min || eur > FX_REFERENCE_BOUNDS.max) {
    throw new FxReferenceError('out_of_band', 'EUR rate outside the sanity band');
  }
  return eur;
};

/**
 * @param {{signal?: AbortSignal, fetchImpl?: typeof fetch, now?: () => Date}} [options]
 * @returns {Promise<{pair: 'USD_EUR', rate: number, providerName: string, providerDomain: string,
 *   providerUpdatedAt: Date|null, providerDate: string|null, fetchedAt: Date}>}
 * @throws {FxReferenceError}
 */
export const fetchUsdEurReference = async ({ signal, fetchImpl = fetch, now = () => new Date() } = {}) => {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, FX_REFERENCE_TIMEOUT_MS);
  const onCallerAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onCallerAbort, { once: true });
  }

  try {
    let response;
    try {
      response = await fetchImpl(FX_REFERENCE_URL, { signal: controller.signal, credentials: 'omit' });
    } catch (error) {
      if (timedOut) throw new FxReferenceError('timeout', 'Reference request timed out');
      if (controller.signal.aborted) throw new FxReferenceError('aborted', 'Reference request aborted');
      throw new FxReferenceError('network', error?.message || 'Network error');
    }
    if (!response?.ok) throw new FxReferenceError('network', `Provider responded ${response?.status ?? 'without status'}`);

    const data = await readJson(response);
    const rate = validatePayload(data);

    return {
      pair: 'USD_EUR',
      rate,
      providerName: FX_REFERENCE_PROVIDER_NAME,
      providerDomain: FX_REFERENCE_PROVIDER_DOMAIN,
      providerUpdatedAt: parseProviderTimestamp(data.time_last_updated),
      providerDate: parseProviderDate(data.date),
      fetchedAt: now()
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onCallerAbort);
  }
};

/** Best known moment the provider refreshed the rate; null when it gave no usable date. */
export const referenceProviderMoment = (reference) => {
  if (reference?.providerUpdatedAt instanceof Date) return reference.providerUpdatedAt;
  if (reference?.providerDate) return new Date(`${reference.providerDate}T00:00:00Z`);
  return null;
};

/** Age of the provider's data in whole hours (null when unknown). */
export const referenceAgeHours = (reference, now = new Date()) => {
  const moment = referenceProviderMoment(reference);
  if (!moment) return null;
  return Math.max(0, Math.floor((now.getTime() - moment.getTime()) / MS_PER_HOUR));
};

/** Unknown age counts as stale: freshness must be proven, never assumed. */
export const evaluateReferenceFreshness = (reference, now = new Date()) => {
  const moment = referenceProviderMoment(reference);
  if (!moment) return 'stale';
  const ageMs = now.getTime() - moment.getTime();
  return ageMs > FX_REFERENCE_STALE_HOURS * MS_PER_HOUR ? 'stale' : 'fresh';
};
