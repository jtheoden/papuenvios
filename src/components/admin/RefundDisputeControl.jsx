import React, { useId, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { setRefundDispute } from '@/lib/refundService';

const K = 'refundAudit.dispute.';
const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-600';
const BUTTON = `inline-flex items-center justify-center min-h-[44px] px-3 rounded-lg border border-gray-400 bg-white text-sm font-medium text-gray-800 hover:bg-gray-50 ${FOCUS_RING}`;

/**
 * One toggle to open or close the dispute of a refund (an open dispute stops the purge of its proof). `open` is the real state
 * (RPC admin_refund_dispute_states); the parent hides this control when that state is unknown. The admin who is the customer of
 * the refund cannot use it (the database refuses it too).
 */
const RefundDisputeControl = ({ refund, open = false, isOwn = false }) => {
  const { t } = useLanguage();
  const [isOpen, setIsOpen] = useState(open);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const ownId = useId();

  const toggle = async () => {
    if (isOwn || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const result = await setRefundDispute(refund.id, !isOpen);
      setIsOpen(result.open === true);
      setMessage(t(result.open === true ? `${K}opened` : `${K}closed`));
    } catch {
      setMessage('');
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const number = refund.operation_number;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {isOpen && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">{t(`${K}badge`)}</span>}
      <button
        type="button"
        aria-disabled={isOwn || busy ? 'true' : undefined}
        aria-describedby={isOwn ? ownId : undefined}
        aria-label={t(isOpen ? `${K}closeAria` : `${K}openAria`, { number })}
        onClick={toggle}
        className={`${BUTTON} ${isOwn ? 'cursor-not-allowed bg-gray-100 text-gray-600' : ''}`}
      >
        {t(isOpen ? `${K}close` : `${K}open`)}
      </button>
      {isOwn && <p id={ownId} className="basis-full text-xs text-gray-700">{t(`${K}ownBlocked`)}</p>}
      <p role="status" aria-live="polite" className="basis-full text-xs text-gray-800">{message}</p>
      {failed && <p role="alert" className="basis-full text-xs text-red-800">{t(`${K}failed`)}</p>}
    </div>
  );
};

export default RefundDisputeControl;
