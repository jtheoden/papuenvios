import React, { useEffect, useId, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { getMyOperationRefund } from '@/lib/refundService';

const K = 'myRefund.';

/** Customer view of the refund of one of their own operations. Renders nothing when there is none or the backend is not there. */
const MyOperationRefund = ({ kind, operationId }) => {
  const { t, language } = useLanguage();
  const [refunds, setRefunds] = useState([]);
  const headingId = useId();

  useEffect(() => {
    let cancelled = false;
    setRefunds([]);
    (async () => {
      try {
        const rows = await getMyOperationRefund(kind, operationId);
        if (!cancelled) setRefunds(Array.isArray(rows) ? rows : []);
      } catch {
        if (!cancelled) setRefunds([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, operationId]);

  if (refunds.length === 0) return null;
  const date = (iso) => new Date(iso).toLocaleDateString(language);
  const amountOf = (r) => {
    try {
      return new Intl.NumberFormat(language === 'es' ? 'es-US' : 'en-US', { style: 'currency', currency: r.currency }).format(Number(r.amount));
    } catch {
      return `${Number(r.amount).toFixed(2)} ${r.currency}`;
    }
  };
  const headline = (r) => {
    if (r.stage === 'on_hold') return t(`${K}stage.on_hold`, { date: date(r.eligible_at) });
    if (r.stage === 'processing') return t(`${K}stage.processing`, { date: date(r.due_at) });
    if (r.stage === 'refunded') return t(`${K}stage.refunded`, { date: date(r.refunded_at) });
    return t(`${K}stage.not_applicable`);
  };

  return (
    <section role="region" aria-labelledby={headingId} className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3">
      <h4 id={headingId} className="sr-only">{t(`${K}region`)}</h4>
      <p aria-hidden="true" className="font-semibold text-blue-900">{t(`${K}title`)}</p>
      {refunds.map((r, index) => (
        <div key={`${r.cancelled_at}-${index}`} className="text-sm text-gray-900 space-y-1">
          <p className="font-medium">{headline(r)}</p>
          <p className="text-gray-700">{t(`${K}amount`, { amount: amountOf(r) })} · {t(`${K}cancelledOn`, { date: date(r.cancelled_at) })}</p>
        </div>
      ))}
    </section>
  );
};

export default MyOperationRefund;
