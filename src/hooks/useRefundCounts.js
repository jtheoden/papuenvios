import { useEffect, useState } from 'react';
import { getRefundCounts } from '@/lib/refundService';
import { useVisiblePolling, watchPoll } from '@/lib/visiblePolling';
import { ADMIN_PENDING_KEY, REFUND_COUNTS_KEY, affectsAdminPending } from '@/lib/adminPollKeys';

const OWN_POLL_MS = 30 * 60_000;

/**
 * Open-refund counts for read-only surfaces (dashboard card). A source that fails reads as "nothing to show": the card
 * must never add errors to a page whose job is something else. Returns null until the first answer.
 * Loads when shown, then follows every answer of the header badge (always mounted for admins; realtime, own writes and
 * its 5-minute poll refresh it). Its own poll is only a 30-minute backstop; nothing is asked while the tab is hidden.
 * @param {{ enabled?: boolean }} options
 */
export const useRefundCounts = ({ enabled = true } = {}) => {
  const [counts, setCounts] = useState(null);

  useVisiblePolling(REFUND_COUNTS_KEY, () => getRefundCounts(), {
    enabled,
    intervalMs: OWN_POLL_MS,
    refreshOnWrite: affectsAdminPending,
    onData: setCounts,
    onError: () => setCounts(null)
  });

  useEffect(() => {
    if (!enabled) return undefined;
    return watchPoll(ADMIN_PENDING_KEY, ({ refunds }) => setCounts(refunds ?? null));
  }, [enabled]);

  return counts;
};

export default useRefundCounts;
