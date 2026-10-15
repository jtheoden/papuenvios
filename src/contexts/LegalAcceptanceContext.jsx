import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import LegalAcceptanceGate from '@/components/LegalAcceptanceGate';
import { toast } from '@/components/ui/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { checkCurrentAcceptance } from '@/lib/legalAcceptanceService';

/**
 * Pass-through default so components rendered without the provider (isolated tests, storybook-like
 * usage) keep working. The app always mounts the provider in App.jsx.
 */
const LegalAcceptanceContext = createContext({ ensureAccepted: async () => true });

export const useLegalAcceptance = () => useContext(LegalAcceptanceContext);

/**
 * Exposes ensureAccepted(source): resolves true when the signed-in user has accepted the current
 * Terms + Privacy (and confirmed 18+), opening the gate modal if not. Resolves false if the user
 * cancels. Fails open ('unavailable') when the server-side RPCs are not deployed, so existing
 * flows are never blocked by a missing migration. The positive result is cached in memory only,
 * per user, never in localStorage.
 */
export const LegalAcceptanceProvider = ({ children }) => {
  const { user } = useAuth();
  const { t } = useLanguage();
  const userId = user?.id ?? null;
  const acceptedForRef = useRef(null);
  const pendingRef = useRef(null);
  const [modal, setModal] = useState({ open: false, source: 'checkout' });

  const settle = useCallback((value) => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    setModal((prev) => ({ ...prev, open: false }));
    pending?.resolve(value);
  }, []);

  useEffect(() => {
    if (acceptedForRef.current && acceptedForRef.current !== userId) acceptedForRef.current = null;
    // A pending gate belongs to the session that opened it: cancel it when the user changes or signs out.
    if (pendingRef.current && pendingRef.current.userId !== userId) settle(false);
    if (!userId) return undefined;
    let cancelled = false;
    checkCurrentAcceptance().then((status) => {
      if (!cancelled && status === 'accepted') acceptedForRef.current = userId;
    });
    return () => {
      cancelled = true;
    };
  }, [userId, settle]);

  const ensureAccepted = useCallback(
    async (source) => {
      if (!userId) return true;
      if (acceptedForRef.current === userId) return true;
      if (pendingRef.current) return pendingRef.current.promise;

      const status = await checkCurrentAcceptance();
      if (status === 'accepted') {
        acceptedForRef.current = userId;
        return true;
      }
      if (status === 'unavailable') return true;
      if (status === 'error') {
        // Do not let the action through silently: the user can simply press confirm again.
        toast({
          title: t('common.error'),
          description: t('legal.gate.errors.checkFailed'),
          variant: 'destructive',
        });
        return false;
      }

      // Another caller may have opened the gate while we awaited the lookup.
      if (pendingRef.current) return pendingRef.current.promise;

      let resolve;
      const promise = new Promise((r) => {
        resolve = r;
      });
      pendingRef.current = { promise, resolve, userId };
      setModal({ open: true, source });
      return promise;
    },
    [userId, t]
  );

  const handleAccepted = useCallback(() => {
    const pending = pendingRef.current;
    if (pending) acceptedForRef.current = pending.userId;
    settle(true);
  }, [settle]);

  const handleCancel = useCallback(() => settle(false), [settle]);

  const value = useMemo(() => ({ ensureAccepted }), [ensureAccepted]);

  return (
    <LegalAcceptanceContext.Provider value={value}>
      {children}
      <LegalAcceptanceGate
        open={modal.open}
        source={modal.source}
        onAccepted={handleAccepted}
        onCancel={handleCancel}
      />
    </LegalAcceptanceContext.Provider>
  );
};

export default LegalAcceptanceProvider;
