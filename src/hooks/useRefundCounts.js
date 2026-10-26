import { useEffect, useState } from 'react';
import { getRefundCounts } from '@/lib/refundService';

const REFRESH_MS = 60000;

/**
 * Open-refund counts for read-only surfaces (dashboard card). A source that fails reads as "nothing to show": the card
 * must never add errors to a page whose job is something else. Returns null until the first answer.
 * @param {{ enabled?: boolean }} options
 */
export const useRefundCounts = ({ enabled = true } = {}) => {
  const [counts, setCounts] = useState(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const value = await getRefundCounts();
        if (!cancelled) setCounts(value);
      } catch {
        if (!cancelled) setCounts(null);
      }
    };
    load();
    const interval = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled]);

  return counts;
};

export default useRefundCounts;
