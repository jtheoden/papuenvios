/**
 * Freshness of an exchange rate (pure, no dependencies).
 *
 * Clock choice: exchange_rates.effective_date is a calendar date, read as 00:00 UTC of that day, exactly
 * like the server does in get_payment_fx_status (see _payment_fx_latest). A future date counts as age 0.
 * Boundaries are inclusive like the server: age >= blockHours -> blocked, age >= warnHours -> warn.
 */

export const RATE_STATES = Object.freeze({
  NONE: 'none',
  OK: 'ok',
  WARN: 'warn',
  BLOCKED: 'blocked'
});

const MS_PER_HOUR = 3600 * 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

/** Age in hours (never negative) or null when the date is missing or invalid. */
export const rateAgeHours = (effectiveDate, now = new Date()) => {
  if (typeof effectiveDate !== 'string' || !ISO_DATE.test(effectiveDate)) return null;
  const start = Date.parse(`${effectiveDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(start)) return null;
  return Math.max(0, (now.getTime() - start) / MS_PER_HOUR);
};

/**
 * ok | warn | blocked | none. Thresholds are optional: a pair without them (USD->CUP, Zelle) can only be
 * `ok` or `none`; its age is informative and must never disable anything.
 */
export const rateAgeState = (effectiveDate, { warnHours, blockHours, now = new Date() } = {}) => {
  const age = rateAgeHours(effectiveDate, now);
  if (age === null) return RATE_STATES.NONE;
  if (Number.isFinite(blockHours) && age >= blockHours) return RATE_STATES.BLOCKED;
  if (Number.isFinite(warnHours) && age >= warnHours) return RATE_STATES.WARN;
  return RATE_STATES.OK;
};

/**
 * Card status for a pair read with getActiveRate. Thresholds are optional (see rateAgeState); keys the pair
 * does not have are omitted so the card hides the matching blocks. No rate -> { state: 'none' }.
 */
export const buildRateStatus = (activeRate, { warnHours, blockHours, now = new Date() } = {}) => {
  if (!activeRate) return { state: RATE_STATES.NONE };
  const status = {
    state: rateAgeState(activeRate.effective_date, { warnHours, blockHours, now }),
    mid_rate: activeRate.rate,
    age_hours: rateAgeHours(activeRate.effective_date, now),
    effective_date: activeRate.effective_date
  };
  if (Number.isFinite(warnHours)) status.fx_warn_hours = warnHours;
  if (Number.isFinite(blockHours)) status.fx_block_hours = blockHours;
  return status;
};
