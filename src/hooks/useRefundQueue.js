import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listRefunds } from '@/lib/refundService';
import { summarizeRefunds, withQueueState } from '@/lib/refundRules';
import { useVisiblePolling, watchPoll, POLL_REALTIME_FALLBACK_MS } from '@/lib/visiblePolling';
import { ADMIN_PENDING_KEY, REFUND_QUEUE_KEY, affectsAdminPending } from '@/lib/adminPollKeys';

const PAGE_SIZE = 200;
const loadQueue = () => listRefunds({ status: 'all', limit: PAGE_SIZE });

/**
 * The admin refunds queue (open and resolved requests): one load, `reload` after every resolution, and a reload
 * whenever the header badge's refund counts change. No realtime subscription on purpose: the header badge already
 * listens to orders / remittances (a cancellation creates the request and shows there at once) and the work tabs keep
 * one realtime remittance subscription (UserPanel.adminTabs test). Own writes reload it too; a 5-minute poll (visible
 * tab only) is the safety net.
 *
 * actionableCount / overdueCount are recomputed from the stored instants on every render of fresh data, so they match
 * the badge (RPC admin_refund_counts uses the same predicates).
 *
 * @param {{ enabled?: boolean }} options
 */
export const useRefundQueue = ({ enabled = true } = {}) => {
  const [refunds, setRefunds] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const knownIdsRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const onData = useCallback(({ items, total: serverTotal }) => {
    if (!mountedRef.current) return;
    const actionableIds = items
      .map((r) => withQueueState(r))
      .filter((r) => r.status === 'pending' && r.queueState !== 'on_hold')
      .map((r) => r.id);
    if (knownIdsRef.current) {
      setNewCount(actionableIds.filter((id) => !knownIdsRef.current.has(id)).length);
    }
    knownIdsRef.current = new Set(actionableIds);
    setRefunds(items);
    setTotal(serverTotal);
    setError(null);
    setRefreshFailed(false);
    setLoading(false);
  }, []);

  const onError = useCallback((err) => {
    if (!mountedRef.current) return;
    // Keep the last good list on later failures; only a first-load failure is blocking.
    if (knownIdsRef.current) setRefreshFailed(true);
    else setError(err);
    setLoading(false);
  }, []);

  const reload = useVisiblePolling(REFUND_QUEUE_KEY, loadQueue, {
    enabled,
    intervalMs: POLL_REALTIME_FALLBACK_MS,
    refreshOnWrite: affectsAdminPending,
    onData,
    onError
  });

  // A refund created/changed elsewhere (seen by the badge through realtime) reloads the list.
  const lastCountsRef = useRef(null);
  useEffect(() => {
    if (!enabled) return undefined;
    return watchPoll(ADMIN_PENDING_KEY, ({ refunds: counts }) => {
      const signature = JSON.stringify(counts ?? null);
      if (lastCountsRef.current !== null && lastCountsRef.current !== signature) reload();
      lastCountsRef.current = signature;
    });
  }, [enabled, reload]);

  const retry = useCallback(async () => {
    setLoading(true);
    setError(null);
    await reload();
  }, [reload]);

  const summary = useMemo(() => summarizeRefunds(refunds.map((r) => withQueueState(r))), [refunds]);

  return {
    refunds,
    total,
    loading,
    error,
    refreshFailed,
    newCount,
    reload,
    retry,
    actionableCount: summary.actionable,
    overdueCount: summary.overdue
  };
};

export default useRefundQueue;
