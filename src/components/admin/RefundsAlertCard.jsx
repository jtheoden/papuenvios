import React from 'react';
import { AlertTriangle, Clock } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useRefundCounts } from '@/hooks/useRefundCounts';
import { REFUND_HOLD_HOURS } from '@/lib/legalConfig';

const TARGET_PATH = '/user-panel?tab=refunds';
const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-600';

/**
 * Dashboard > Summary alert for pending refunds (above the KPIs: what needs action before what is read).
 * Amber while everything is within its deadline, red with overdue ones. role="alert" ONLY with overdue refunds, so a
 * routine visit does not interrupt a screen reader. Hidden when there is nothing pending or the counts cannot be read.
 * The amount only adds USD rows and says so: it is not the total owed when other currencies exist.
 */
const RefundsAlertCard = ({ enabled = false, onNavigate }) => {
  const { t, language } = useLanguage();
  const counts = useRefundCounts({ enabled });
  if (!counts || counts.actionable + counts.onHold === 0) return null;

  const hasOverdue = counts.overdue > 0;
  const Icon = hasOverdue ? AlertTriangle : Clock;
  const tone = hasOverdue
    ? 'border-red-300 bg-red-50 text-red-900'
    : 'border-amber-300 bg-amber-50 text-amber-900';
  const amount = new Intl.NumberFormat(language === 'es' ? 'es-US' : 'en-US', { style: 'currency', currency: 'USD' }).format(
    counts.pendingAmountUsd
  );
  const goToRefunds = () => {
    if (onNavigate) onNavigate('user-panel');
    window.history.replaceState({ path: TARGET_PATH }, '', TARGET_PATH);
  };

  return (
    <div
      data-testid="refunds-alert-card"
      role={hasOverdue ? 'alert' : 'status'}
      className={`mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border-l-4 border p-4 ${tone}`}
    >
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-6 w-6 shrink-0" aria-hidden="true" />
        <div className="space-y-0.5">
          <p className="font-bold">
            {counts.actionable > 0
              ? t('adminRefunds.dashboard.title', { count: counts.actionable })
              : t('adminRefunds.dashboard.titleOnHold', { count: counts.onHold, hours: REFUND_HOLD_HOURS })}
          </p>
          <p className="text-sm">{t('adminRefunds.dashboard.amount', { amount })}</p>
          {hasOverdue && <p className="text-sm font-semibold">{t('adminRefunds.dashboard.overdue', { count: counts.overdue })}</p>}
          {counts.actionable > 0 && counts.onHold > 0 && (
            <p className="text-sm">{t('adminRefunds.dashboard.onHold', { count: counts.onHold, hours: REFUND_HOLD_HOURS })}</p>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={goToRefunds}
        className={`inline-flex min-h-[44px] items-center justify-center rounded-lg bg-white px-4 text-sm font-medium text-gray-900 border border-current hover:bg-gray-50 ${FOCUS_RING}`}
      >
        {t('adminRefunds.dashboard.cta')}
      </button>
    </div>
  );
};

export default RefundsAlertCard;
