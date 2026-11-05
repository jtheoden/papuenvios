import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRealtimeRemittances } from '@/hooks/useRealtimeSubscription';
import { TO_PROCESS_STATUSES, getAdminWorkRemittances } from '@/lib/remittanceService';
import { useVisiblePolling, POLL_REALTIME_FALLBACK_MS } from '@/lib/visiblePolling';
import { WORK_REMITTANCES_KEY, affectsAdminPending } from '@/lib/adminPollKeys';

/**
 * Remittances that need admin attention, kept fresh by one realtime subscription and own writes, plus a
 * 5-minute polling safety net (visible tab only) in case a realtime event is missed.
 *
 * @param {{ enabled?: boolean }} options
 * @returns {{
 *   remittances: Array, loading: boolean, error: Error|null (first load failed),
 *   refreshFailed: boolean (a later refresh failed; list is the last good one), retry: () => Promise<void>,
 *   toProcessCount: number, newCount: number, reload: () => Promise<void>
 * }}
 */
export const usePendingRemittances = ({ enabled = true } = {}) => {
  const [remittances, setRemittances] = useState([]);
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

  const onData = useCallback((data) => {
    if (!mountedRef.current) return;
    const toProcessIds = data
      .filter((r) => TO_PROCESS_STATUSES.includes(r.status))
      .map((r) => r.id);
    if (knownIdsRef.current) {
      const fresh = toProcessIds.filter((id) => !knownIdsRef.current.has(id));
      setNewCount(fresh.length);
    }
    knownIdsRef.current = new Set(toProcessIds);

    setRemittances(data);
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

  const reload = useVisiblePolling(WORK_REMITTANCES_KEY, () => getAdminWorkRemittances(), {
    enabled,
    intervalMs: POLL_REALTIME_FALLBACK_MS,
    refreshOnWrite: affectsAdminPending,
    onData,
    onError
  });

  const retry = useCallback(async () => {
    setLoading(true);
    setError(null);
    await reload();
  }, [reload]);

  useRealtimeRemittances({ enabled, onUpdate: reload });

  const toProcessCount = useMemo(
    () => remittances.filter((r) => TO_PROCESS_STATUSES.includes(r.status)).length,
    [remittances]
  );

  return { remittances, loading, error, refreshFailed, toProcessCount, newCount, reload, retry };
};
