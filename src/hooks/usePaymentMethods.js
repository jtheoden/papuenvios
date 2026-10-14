import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  isFlowBlocked,
  isPaymentMethodEnabled,
  listPaymentMethods,
  listPaymentMethodsForAdmin,
  setPaymentMethodEnabled
} from '@/lib/paymentMethodsService';

/**
 * Payment-method catalog for checkout gating (default) or the admin card.
 *
 * Customer mode never blocks on a failed read: until the list has been loaded,
 * `isMethodEnabled` / `isFlowBlocked` fail OPEN, because the BEFORE INSERT trigger
 * on orders / remittances is the real enforcement. Admin mode surfaces `error`
 * so the card can show an error state instead.
 *
 * The status is re-read when the window regains focus, and callers can force a
 * fresh read right before a final submit with `refresh()`.
 *
 * @param {{admin?: boolean}} [options]
 */
export const usePaymentMethods = ({ admin = false } = {}) => {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [methods, setMethods] = useState(null);
  const [loading, setLoading] = useState(Boolean(userId));
  const [error, setError] = useState(null);

  const mountedRef = useRef(true);
  const inflightRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(() => {
    if (!userId) return Promise.resolve(null);
    if (inflightRef.current) return inflightRef.current;

    const load = admin ? listPaymentMethodsForAdmin : listPaymentMethods;
    const request = (async () => {
      try {
        const rows = await load();
        if (mountedRef.current) {
          setMethods(rows);
          setError(null);
        }
        return rows;
      } catch (failure) {
        if (mountedRef.current) setError(failure);
        return null;
      } finally {
        inflightRef.current = null;
        if (mountedRef.current) setLoading(false);
      }
    })();

    inflightRef.current = request;
    return request;
  }, [userId, admin]);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    refresh();

    const onFocus = () => {
      refresh();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [userId, refresh]);

  const toggle = useCallback(
    async (params) => {
      const row = await setPaymentMethodEnabled(params);
      await refresh();
      return row;
    },
    [refresh]
  );

  const isMethodEnabled = useCallback((code, flow) => isPaymentMethodEnabled(methods, code, flow), [methods]);
  const isFlowBlockedFor = useCallback((flow) => isFlowBlocked(methods, flow), [methods]);

  return {
    methods,
    loading,
    error,
    refresh,
    toggle,
    isMethodEnabled,
    isFlowBlocked: isFlowBlockedFor
  };
};

export default usePaymentMethods;
