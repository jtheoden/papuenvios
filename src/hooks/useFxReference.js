import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchUsdEurReference } from '@/lib/fxReference';

/**
 * Loads the external USD->EUR reference (informational, never persisted).
 *
 * - A newer request, a caller abort or unmount discards the older result.
 * - A failed refresh keeps the previous reference so the UI can show it as degraded.
 *
 * @param {{autoLoad?: boolean}} [options] autoLoad=false waits for the first explicit `check()`
 * @returns {{reference: object|null, loading: boolean, errorCode: string|null, check: () => Promise<void>}}
 */
export const useFxReference = ({ autoLoad = true } = {}) => {
  const [state, setState] = useState({ reference: null, loading: autoLoad, errorCode: null });
  const controllerRef = useRef(null);
  const mountedRef = useRef(true);

  const check = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState((prev) => ({ ...prev, loading: true, errorCode: null }));
    try {
      const reference = await fetchUsdEurReference({ signal: controller.signal });
      if (!mountedRef.current || controllerRef.current !== controller) return;
      setState({ reference, loading: false, errorCode: null });
    } catch (error) {
      if (!mountedRef.current || controllerRef.current !== controller) return;
      setState((prev) => ({ reference: prev.reference, loading: false, errorCode: error?.code || 'network' }));
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (autoLoad) check();
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, [autoLoad, check]);

  return { ...state, check };
};

export default useFxReference;
