import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { executePurgeRefundProofs, getExpiringProofs, previewPurgeRefundProofs } from '@/lib/refundService';

const K = 'refundAudit.';
const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-600';
const BUTTON = `inline-flex items-center justify-center min-h-[44px] px-4 rounded-lg text-sm font-medium ${FOCUS_RING}`;

/**
 * Admin-only retention tools of the refunds inbox: "expiring soon" notice and the purge of expired proofs. The purge is always
 * preview -> explicit confirmation -> execute with the previewed count (the Edge Function refuses any other number).
 */
const RefundProofsMaintenance = () => {
  const { t } = useLanguage();
  const [expiring, setExpiring] = useState(null);
  const [preview, setPreview] = useState(null); // { due, capped } while the confirmation is open
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null); // { tone: 'info' | 'error', text }
  const triggerRef = useRef(null);

  const mountedRef = useRef(true);
  const loadExpiring = useCallback(async () => {
    try {
      const value = await getExpiringProofs(30);
      if (mountedRef.current) setExpiring(value);
    } catch {
      if (mountedRef.current) setExpiring(null);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    loadExpiring();
    return () => {
      mountedRef.current = false;
    };
  }, [loadExpiring]);

  const close = () => {
    setPreview(null);
    triggerRef.current?.focus();
  };

  const startPurge = async () => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await previewPurgeRefundProofs();
      if (result.due === 0) setNotice({ tone: 'info', text: t(`${K}purge.none`) });
      else setPreview(result);
    } catch (err) {
      setNotice({ tone: 'error', text: t(err?.context?.reason === 'not_authorized' ? `${K}purge.forbidden` : `${K}purge.failed`) });
    } finally {
      setBusy(false);
    }
  };

  const confirmPurge = async () => {
    if (busy) return;
    const count = preview.due;
    setBusy(true);
    try {
      const done = await executePurgeRefundProofs(count);
      setNotice({ tone: 'info', text: t(`${K}purge.done`, done) });
      await loadExpiring(); // the "expiring soon" notice must not keep counting what was just deleted
    } catch (err) {
      setNotice({ tone: 'error', text: t(err?.context?.reason === 'count_changed' ? `${K}purge.countChanged` : `${K}purge.failed`) });
    } finally {
      setBusy(false);
      close();
    }
  };

  const showExpiring = expiring && (expiring.count > 0 || expiring.overdueUnpurged > 0);
  return (
    <section aria-labelledby="refund-maintenance-heading" className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
      <h3 id="refund-maintenance-heading" className="text-sm font-semibold text-gray-900">{t(`${K}purge.heading`)}</h3>
      {showExpiring && (
        <div className="text-sm text-amber-900 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2 space-y-0.5">
          {expiring.count > 0 && <p>{t(`${K}expiring.warning`, { count: expiring.count })}</p>}
          {expiring.overdueUnpurged > 0 && <p>{t(`${K}expiring.overdue`, { count: expiring.overdueUnpurged })}</p>}
        </div>
      )}
      <button
        ref={triggerRef}
        type="button"
        onClick={startPurge}
        aria-disabled={busy ? 'true' : undefined}
        className={`${BUTTON} border border-gray-400 bg-white text-gray-900 hover:bg-gray-50 ${busy ? 'opacity-60 cursor-wait' : ''}`}
      >
        {busy && !preview ? t(`${K}purge.checking`) : t(`${K}purge.button`)}
      </button>
      <div role="status" aria-live="polite">
        {notice?.tone === 'info' && <p className="text-sm text-gray-800">{notice.text}</p>}
      </div>
      {notice?.tone === 'error' && <p role="alert" className="text-sm text-red-800">{notice.text}</p>}

      <AlertDialog.Root open={Boolean(preview)} onOpenChange={(next) => !next && !busy && close()}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
          <AlertDialog.Content
            onEscapeKeyDown={(e) => busy && e.preventDefault()}
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              triggerRef.current?.focus();
            }}
            className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-5 space-y-3"
          >
            <AlertDialog.Title className="text-lg font-semibold text-gray-900">{t(`${K}purge.confirmTitle`)}</AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-gray-800">
              {t(`${K}purge.confirmBody`, { count: preview?.due ?? 0 })}
            </AlertDialog.Description>
            {preview?.capped && <p className="text-sm text-gray-700">{t(`${K}purge.capped`)}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <AlertDialog.Cancel
                aria-disabled={busy ? 'true' : undefined}
                className={`${BUTTON} border border-gray-400 bg-white text-gray-900 hover:bg-gray-50`}
              >
                {t(`${K}purge.cancel`)}
              </AlertDialog.Cancel>
              <button
                type="button"
                aria-disabled={busy ? 'true' : undefined}
                onClick={confirmPurge}
                className={`${BUTTON} bg-red-700 text-white hover:bg-red-800 ${busy ? 'opacity-60 cursor-wait' : ''}`}
              >
                {busy ? t(`${K}purge.running`) : t(`${K}purge.confirm`, { count: preview?.due ?? 0 })}
              </button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </section>
  );
};

export default RefundProofsMaintenance;
