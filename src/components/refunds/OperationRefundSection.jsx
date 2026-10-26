import React, { useEffect, useId, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { getOperationRefundDetail } from '@/lib/refundService';

const K = 'refundAudit.';
const QUEUE_TONE = {
  on_hold: 'bg-gray-100 text-gray-800',
  on_time: 'bg-green-100 text-green-900',
  due_soon: 'bg-amber-100 text-amber-900',
  overdue: 'bg-red-100 text-red-900'
};

const KNOWN_EVENTS = [
  'created', 'closed_refunded', 'closed_not_applicable', 'closed_by_reopen', 'proof_attached', 'proof_expired', 'dispute_opened',
  'dispute_closed', 'self_resolution_blocked', 'commission_proposed', 'commission_accepted', 'commission_rejected', 'commission_override_set'
];

const KNOWN_STATUSES = [
  'pending', 'validated', 'rejected', 'processing', 'dispatched', 'shipped', 'delivered', 'completed', 'cancelled',
  'payment_pending', 'payment_proof_uploaded', 'payment_validated', 'payment_rejected'
];

const humanize = (value) => String(value ?? '').replace(/_/g, ' ');

/** Admin, read-only: refund episodes and event timeline of one order/remittance. Renders nothing if the backend is not there. */
const OperationRefundSection = ({ kind, operationId }) => {
  const { t, language } = useLanguage();
  const [detail, setDetail] = useState(undefined); // undefined = loading, null = unavailable
  const headingId = useId();

  useEffect(() => {
    let cancelled = false;
    setDetail(undefined);
    (async () => {
      try {
        const value = await getOperationRefundDetail(kind, operationId);
        if (!cancelled) setDetail(value);
      } catch {
        if (!cancelled) setDetail(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, operationId]);

  if (detail === null) return null;
  const when = (iso) => new Date(iso).toLocaleString(language);
  const money = (amount, currency) => {
    try {
      return new Intl.NumberFormat(language === 'es' ? 'es-US' : 'en-US', { style: 'currency', currency }).format(Number(amount));
    } catch {
      return `${Number(amount).toFixed(2)} ${currency}`;
    }
  };

  const statusLabel = (status) => (KNOWN_STATUSES.includes(status) ? t(`${K}opStatus.${status}`) : humanize(status));

  const describe = (item) => {
    if (item.source === 'status_history') {
      return t(`${K}timeline.statusChanged`, { from: statusLabel(item.summary.from), to: statusLabel(item.summary.to) });
    }
    if (item.kind === 'refund_eligible') return t(`${K}timeline.markerEligible`);
    if (item.kind === 'refund_due') return t(`${K}timeline.markerDue`);
    return t(`${K}timeline.event.${KNOWN_EVENTS.includes(item.kind) ? item.kind : 'unknown'}`);
  };

  return (
    <section aria-labelledby={headingId} className="rounded-lg border border-gray-200 p-4 space-y-4" data-testid="operation-refund-section">
      <h4 id={headingId} className="text-lg font-semibold text-gray-900">{t(`${K}section.title`)}</h4>
      {detail === undefined && <p role="status" className="text-sm text-gray-700">{t(`${K}section.loading`)}</p>}
      {detail && (
        <>
          {detail.incomplete && <p role="status" className="text-sm text-amber-900">{t(`${K}section.partial`)}</p>}
          {detail.refunds.length === 0 && <p className="text-sm text-gray-700">{t(`${K}section.none`)}</p>}
          {detail.refunds.map((refund, index) => (
            <div key={refund.id} className="rounded-md bg-gray-50 p-3 text-sm space-y-1">
              {detail.refunds.length > 1 && (
                <p className="text-xs font-medium text-gray-700">{t(`${K}section.episode`, { index: index + 1, total: detail.refunds.length })}</p>
              )}
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-gray-900">{t(`${K}status.${refund.status}`)}</span>
                {refund.queue_state && (
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${QUEUE_TONE[refund.queue_state] || QUEUE_TONE.on_time}`}>
                    {t(`${K}queue.${refund.queue_state}`)}
                  </span>
                )}
              </p>
              <p><span className="text-gray-700">{t(`${K}field.amount`)}: </span><span className="font-medium tabular-nums">{money(refund.amount, refund.currency)}</span></p>
              <p><span className="text-gray-700">{t(`${K}field.cancelledAt`)}: </span>{when(refund.cancelled_at)}</p>
              <p><span className="text-gray-700">{t(`${K}field.eligibleAt`)}: </span>{when(refund.eligible_at)}</p>
              <p><span className="text-gray-700">{t(`${K}field.dueAt`)}: </span>{when(refund.due_at)}</p>
              {refund.refunded_at && <p><span className="text-gray-700">{t(`${K}field.refundedAt`)}: </span>{when(refund.refunded_at)}</p>}
              <p>
                <span className="text-gray-700">{t(`${K}field.proof`)}: </span>{t(`${K}proof.${refund.proof_state || 'none'}`)}
                {refund.proof_state === 'available' && refund.proof_expires_at ? ` (${t(`${K}proof.expiresAt`, { date: new Date(refund.proof_expires_at).toLocaleDateString(language) })})` : ''}
              </p>
              {refund.self_resolved && <p className="text-xs font-medium text-purple-900">{t(`${K}field.selfResolved`)}</p>}
            </div>
          ))}

          <div>
            <h5 className="mb-2 text-sm font-semibold text-gray-900">{t(`${K}timeline.title`)}</h5>
            {detail.timeline.length === 0 ? (
              <p className="text-sm text-gray-700">{t(`${K}timeline.empty`)}</p>
            ) : (
              <ol aria-label={t(`${K}timeline.listLabel`)} className="space-y-2 border-l-2 border-gray-200 pl-3">
                {detail.timeline.map((item, index) => (
                  <li key={`${item.ts}-${item.kind}-${index}`} className="text-sm">
                    <time dateTime={item.ts} className="block text-xs text-gray-700">{when(item.ts)}</time>
                    <span className="text-gray-900">{describe(item)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </>
      )}
    </section>
  );
};

export default OperationRefundSection;
