import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Loads one async resource with loading / error state.
 *
 * - `loader` must be referentially stable (module function or useCallback).
 * - A result that arrives after unmount, or after a newer reload started, is discarded.
 * - A failed reload keeps the previous data so a transient error does not blank the UI.
 *
 * @template T
 * @param {() => Promise<T>} loader
 * @param {{enabled?: boolean}} [options] enabled=false defers the first load (sequential probes)
 * @returns {{data: T|null, error: unknown, loading: boolean, reload: () => Promise<void>, setData: (value: T) => void}}
 */
export const useAsyncResource = (loader, { enabled = true } = {}) => {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const requestRef = useRef(0);

  const reload = useCallback(async () => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setState((prev) => ({ ...prev, loading: true }));
    try {
      const data = await loader();
      if (requestRef.current === requestId) setState({ data, error: null, loading: false });
    } catch (error) {
      if (requestRef.current === requestId) setState((prev) => ({ data: prev.data, error, loading: false }));
    }
  }, [loader]);

  useEffect(() => {
    if (!enabled) return undefined;
    reload();
    return () => {
      // Invalidate any in-flight request: its result must not touch an unmounted component.
      requestRef.current += 1;
    };
  }, [reload, enabled]);

  // A value set by the caller (e.g. the row just saved) must not be overwritten by an older in-flight reload.
  const setData = useCallback((data) => {
    requestRef.current += 1;
    setState({ data, error: null, loading: false });
  }, []);

  return { ...state, reload, setData };
};

export default useAsyncResource;
