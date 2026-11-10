import React, { useEffect, useState } from 'react';
import { AlertTriangle, AlertOctagon, HelpCircle } from 'lucide-react';
import { getMarginSummary } from '@/lib/courierService';

const ROWS = [
  { key: 'critical', Icon: AlertOctagon, cls: 'text-red-800' },
  { key: 'warning', Icon: AlertTriangle, cls: 'text-amber-800' },
  { key: 'unknown', Icon: HelpCircle, cls: 'text-gray-700' },
  { key: 'unknownAmount', Icon: HelpCircle, cls: 'text-gray-700' }
];

/**
 * Month margin-at-risk counts from the courier report. Hidden while the module is not deployed or while the owner
 * has not set any threshold (no thresholds = no alerts). Unknown margins are listed apart, never folded into "ok".
 */
const CourierMarginCard = ({ t }) => {
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    let alive = true;
    getMarginSummary().then((s) => { if (alive) setSummary(s); });
    return () => { alive = false; };
  }, []);

  if (!summary?.available || !summary.thresholdsSet || !summary.counts) return null;
  const titleId = 'courier-margin-title';
  return (
    <section className="glass-effect rounded-2xl p-5 mt-4" data-testid="courier-margin-card" role="region" aria-labelledby={titleId}>
      <h4 id={titleId} className="text-sm font-semibold mb-3">{t('dashboard.courierMargin.title')}</h4>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {ROWS.map(({ key, Icon, cls }) => (
          <li key={key} className={`flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm ${cls}`}>
            <span className="inline-flex items-center gap-2">
              <Icon className="h-4 w-4" aria-hidden="true" />
              {t(`dashboard.courierMargin.${key}`)}
            </span>
            <strong data-testid={`margin-count-${key}`}>{summary.counts[key]}</strong>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-gray-500">{t('dashboard.courierMargin.note')}</p>
    </section>
  );
};

export default CourierMarginCard;
