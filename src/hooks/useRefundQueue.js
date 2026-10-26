import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listRefunds } from '@/lib/refundService';
import { summarizeRefunds, withQueueState } from '@/lib/refundRules';

const POLL_INTERVAL_MS = 30000;
const PAGE_SIZE = 200;

/**
 * The admin refunds queue (open and resolved requests): one load, a 30 s poll, and `reload` after every resolution.
 * No realtime subscription on purpose: the header badge already listens to orders / remittances (a cancellation shows
 * there at once) and the work tabs keep one realtime remittance subscription (UserPanel.adminTabs test). A new request
 * therefore appears in the list within 30 s.
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

  const reload = useCallback(async () => {
    try {
      const { items, total: serverTotal } = await listRefunds({ status: 'all', limit: PAGE_SIZE });
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
    } catch (err) {
      if (!mountedRef.current) return;
      // Keep the last good list on later failures; only a first-load failure is blocking.
      if (knownIdsRef.current) setRefreshFailed(true);
      else setError(err);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  const retry = useCallback(async () => {
    setLoading(true);
    setError(null);
    await reload();
  }, [reload]);

  useEffect(() => {
    if (!enabled) return undefined;
    reload();
    const interval = setInterval(reload, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [enabled, reload]);

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
