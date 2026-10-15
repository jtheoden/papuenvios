/**
 * Single source of truth for legal-page parameters.
 * Change windows, version and dates here; Terms, Privacy and notices read from this module.
 * Values marked "proposal" are drafts pending owner / attorney confirmation.
 */

/** Version identifier of the published Terms + Privacy texts (ISO date). */
export const LEGAL_VERSION = '2026-10-15';

/** Human-visible "last updated" date shown on the legal pages (ISO date). */
export const LEGAL_LAST_UPDATED = '2026-10-15';

/** Hours after a transaction within which a claim must be raised (existing text: 48h). */
export const CLAIM_WINDOW_HOURS = 48;

/** Business days to return a refund to the original Zelle method (proposal). */
export const REFUND_BUSINESS_DAYS = 5;

/** Business hours the team may take to verify an uploaded payment proof (existing text: 24h). */
export const PAYMENT_VERIFICATION_BUSINESS_HOURS = 24;

/** Days of advance notice before changes to the Terms take effect (existing text: 7 days). */
export const TERMS_CHANGE_NOTICE_DAYS = 7;

/** Retention of activity_logs rows, enforced by migration 20260809000002 (pg_cron purge). */
export const ACTIVITY_LOGS_RETENTION_DAYS = 90;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Support email read from VITE_SUPPORT_EMAIL.
 * @returns {string|null} A trimmed, syntactically valid address, or null when not configured.
 */
export const getSupportEmail = () => {
  const raw = import.meta.env.VITE_SUPPORT_EMAIL;
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return EMAIL_PATTERN.test(value) ? value : null;
};
