/**
 * JS mirror of the refund window computed by the database (add_business_days, refund_hold_hours,
 * refund_business_days, trigger refund_request_on_cancel). The database is the source of truth: this module only
 * lets the UI preview and tick the queue state. Both sides are pinned by src/tests/fixtures/refund-window-vectors.json.
 *
 *   eligible_at = cancelled_at + REFUND_HOLD_HOURS real hours
 *   due_at      = end of the REFUND_BUSINESS_DAYS-th business day (Mon-Fri, America/New_York) after eligible_at
 */
import { REFUND_BUSINESS_DAYS, REFUND_HOLD_HOURS } from '@/lib/legalConfig';

const REFUND_TIME_ZONE = 'America/New_York';
const HOUR_MS = 3600 * 1000;
const DAY_SOON_MS = 24 * HOUR_MS;

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: REFUND_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric'
});

const toDate = (value) => (value instanceof Date ? value : new Date(value));

/** Wall-clock parts of an instant in New York, as numbers. */
const wallClock = (ms) => {
  const parts = {};
  formatter.formatToParts(new Date(ms)).forEach(({ type, value }) => {
    parts[type] = Number(value);
  });
  return parts;
};

/** New York wall clock minus UTC, in ms, at the given instant (negative). */
const zoneOffsetMs = (ms) => {
  const w = wallClock(ms);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(ms / 1000) * 1000;
};

/** The instant at which the New York wall clock reads year-month-day 00:00:00 (month is 1-based). */
const zonedMidnight = (year, month, day) => {
  const guess = Date.UTC(year, month - 1, day);
  const first = guess - zoneOffsetMs(guess);
  // Second pass settles the offset when the guess sits on the other side of a DST change.
  return new Date(guess - zoneOffsetMs(first));
};

/**
 * End of the n-th business day (Mon-Fri, New York) after the New York calendar day of `from`:
 * 00:00 New York of the following day. No holidays.
 * @param {Date|string} from
 * @param {number} days non-negative integer
 * @returns {Date}
 */
export const addBusinessDays = (from, days) => {
  if (!Number.isInteger(days) || days < 0) throw new RangeError('days must be a non-negative integer');
  const start = wallClock(toDate(from).getTime());
  const day = new Date(Date.UTC(start.year, start.month - 1, start.day));
  for (let counted = 0; counted < days; ) {
    day.setUTCDate(day.getUTCDate() + 1);
    const weekday = day.getUTCDay();
    if (weekday !== 0 && weekday !== 6) counted += 1;
  }
  day.setUTCDate(day.getUTCDate() + 1);
  return zonedMidnight(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate());
};

/** @returns {Date} first instant at which the refund may be paid. */
export const refundEligibleAt = (cancelledAt) => new Date(toDate(cancelledAt).getTime() + REFUND_HOLD_HOURS * HOUR_MS);

/** @returns {Date} deadline promised to the customer. */
export const refundDueAt = (cancelledAt) => addBusinessDays(refundEligibleAt(cancelledAt), REFUND_BUSINESS_DAYS);

/**
 * Queue state of an OPEN request. Order of the list: overdue, due_soon, on_time, on_hold.
 * @returns {'on_hold'|'on_time'|'due_soon'|'overdue'}
 */
export const refundQueueState = ({ eligibleAt, dueAt }, now = new Date()) => {
  const t = toDate(now).getTime();
  if (t < toDate(eligibleAt).getTime()) return 'on_hold';
  const left = toDate(dueAt).getTime() - t;
  if (left <= 0) return 'overdue';
  return left <= DAY_SOON_MS ? 'due_soon' : 'on_time';
};
