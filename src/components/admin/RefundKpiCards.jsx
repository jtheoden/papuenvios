import React, { useEffect, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { getRefundMetrics } from '@/lib/refundService';

const K = 'refundAudit.kpi.';
const WINDOW_DAYS = 30;

const Tile = ({ label, value }) => (
  <div className="rounded-xl border border-gray-200 bg-white p-3">
    <p className="text-xl sm:text-2xl font-semibold tabular-nums text-gray-900">{value}</p>
    <p className="text-xs text-gray-700">{label}</p>
  </div>
);

/** Dashboard KPIs of the last 30 days (RPC admin_refund_metrics). Shows nothing when the RPC is missing or fails. */
const RefundKpiCards = ({ enabled = false, now = null }) => {
  const { t } = useLanguage();
  const [metrics, setMetrics] = useState(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const to = now ? new Date(now) : new Date();
    const from = new Date(to.getTime() - WINDOW_DAYS * 24 * 3600 * 1000);
    (async () => {
      try {
        const value = await getRefundMetrics({ from, to });
        if (!cancelled) setMetrics(value || null);
      } catch {
        if (!cancelled) setMetrics(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, now]);

  if (!enabled || !metrics) return null;
  const percent = (v) => (v === null || v === undefined ? t(`${K}noData`) : t(`${K}percent`, { value: Number(v).toFixed(1).replace(/\.0$/, '') }));
  const median = metrics.time_to_refund_from_cancel_hours?.p50;
  const hours = median === null || median === undefined ? t(`${K}noData`) : t(`${K}hours`, { value: Number(median).toFixed(1) });

  return (
    <section className="mb-6 space-y-2" data-testid="refund-kpis">
      <h3 className="text-sm font-semibold text-gray-900">{t(`${K}title`)}</h3>
      <div role="group" aria-label={t(`${K}region`)} className="grid grid-cols-2 gap-2 sm:grid-cols-5 sm:gap-3">
        <Tile label={t(`${K}refunded`)} value={Number(metrics.total_refunded ?? 0)} />
        <Tile label={t(`${K}pending`)} value={Number(metrics.total_pending ?? 0)} />
        <Tile label={t(`${K}onTime`)} value={percent(metrics.pct_on_time)} />
        <Tile label={t(`${K}medianHours`)} value={hours} />
        <Tile label={t(`${K}withProof`)} value={percent(metrics.pct_with_proof)} />
      </div>
    </section>
  );
};

export default RefundKpiCards;
