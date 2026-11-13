/**
 * Rules of the super admin manual financial entries (RPC superadmin_add_financial_entry). Pure.
 * The server re-validates everything; these checks keep the form and the service honest before the round trip.
 */
import { roundMoney, roundTo } from './moneyPure';
import { REASON_MIN_LENGTH, REASON_MAX_LENGTH } from './commissionOverrideRules';
import { getBusinessWindowDates } from './dashboardMetrics';

export const ENTRY_KINDS = ['income', 'expense'];

/** @returns {Record<string, string>} error codes by field; {} when valid. `today` is an ISO date (YYYY-MM-DD). */
export const validateFinancialEntry = ({ kind, amount, entryDate, reason }, today) => {
  const errors = {};
  if (!ENTRY_KINDS.includes(kind)) errors.kind = 'invalid';
  const number = Number(amount);
  if (!Number.isFinite(number) || number <= 0 || Math.abs(roundTo(number, 2) - number) > 1e-9) errors.amount = 'invalid';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(entryDate || '')) || entryDate > today) errors.entryDate = 'invalid';
  const length = String(reason || '').trim().length;
  if (length < REASON_MIN_LENGTH || length > REASON_MAX_LENGTH) errors.reason = 'invalid';
  return errors;
};

/** Net effect on the profit of the entries dated on or after `sinceDate` (ISO): incomes add, expenses subtract. */
export const sumEntriesNet = (entries, sinceDate) =>
  roundMoney(
    (entries || [])
      .filter((entry) => entry.entry_date >= sinceDate)
      .reduce((sum, entry) => sum + (entry.kind === 'income' ? 1 : -1) * Number(entry.amount), 0)
  );

/** Today's calendar date (YYYY-MM-DD) in the business time zone: the date the server and the Dashboard use. */
export const businessToday = (now = new Date()) => getBusinessWindowDates(now).daily;

/** Net of the entries per Dashboard window (business-calendar day, month, year), the same windows as sales and commissions. */
export const manualEntriesNetByWindow = (entries, now = new Date()) => {
  const since = getBusinessWindowDates(now);
  return {
    daily: sumEntriesNet(entries, since.daily),
    monthly: sumEntriesNet(entries, since.monthly),
    yearly: sumEntriesNet(entries, since.yearly)
  };
};
