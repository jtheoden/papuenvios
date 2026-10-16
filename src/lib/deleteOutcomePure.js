import { ERROR_CODES } from '@/lib/errorHandler';

/**
 * True when a delete failed because the row no longer exists
 * (e.g. another user already deleted it). Deleting is idempotent, so the
 * UI should treat this as "already done" and refresh its stale list.
 */
export const isAlreadyDeletedError = (error) => error?.code === ERROR_CODES.NOT_FOUND;

/**
 * True when a bulk delete outcome means the local list is stale:
 * something was deleted, or some items were already gone (not_found).
 */
export const shouldRefreshAfterBulkDelete = (outcome) =>
  (outcome?.deleted?.length ?? 0) > 0 ||
  (outcome?.blocked ?? []).some((item) => item?.reason === 'not_found');
