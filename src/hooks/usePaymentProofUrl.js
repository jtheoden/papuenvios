import { useEffect, useState } from 'react';
import { getPaymentProofSignedUrl } from '@/lib/paymentProofService';

/**
 * Resolves a stored order payment proof into a short-lived signed URL.
 * @param {string|null|undefined} value orders.payment_proof_url
 * @returns {{ url: string|null, loading: boolean, error: boolean }}
 */
export const usePaymentProofUrl = (value) => {
  const [state, setState] = useState({ url: null, loading: Boolean(value), error: false });

  useEffect(() => {
    if (!value) {
      setState({ url: null, loading: false, error: false });
      return undefined;
    }
    let cancelled = false;
    setState({ url: null, loading: true, error: false });
    getPaymentProofSignedUrl(value)
      .then((res) => {
        if (cancelled) return;
        setState(res.success ? { url: res.signedUrl, loading: false, error: false } : { url: null, loading: false, error: true });
      })
      .catch(() => {
        if (!cancelled) setState({ url: null, loading: false, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [value]);

  return state;
};
