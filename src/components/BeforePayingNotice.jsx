import React, { useId } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import LegalLink from '@/components/LegalLink';
import { BUSINESS_TIME_ZONE } from '@/lib/dashboardMetrics';

/** Wall-clock time of `date` in the business zone (America/New_York, same as the Zelle limits). */
export const formatEasternTime = (date, language) =>
  new Intl.DateTimeFormat(language === 'es' ? 'es-ES' : 'en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);

/**
 * "Before you pay" summary shown next to the pay button. Purely presentational: every amount arrives
 * already computed and formatted by the page (no formula lives here). Rows that are not passed are omitted.
 */
const BeforePayingNotice = ({ onNavigate, rate, rateCheckedAt, fee, deliveryCost, total, recipientReceives, className = '' }) => {
  const { t, language } = useLanguage();
  const titleId = useId();

  const rateValue = rate && rateCheckedAt
    ? `${rate} (${t('beforePaying.rateCheckedAt', { time: formatEasternTime(rateCheckedAt, language) })}, ${t('beforePaying.easternTime')})`
    : rate;

  const rows = [
    ['rate', rateValue],
    ['fee', fee],
    ['deliveryCost', deliveryCost],
    ['total', total],
    ['recipientReceives', recipientReceives],
  ].filter(([, value]) => value != null && value !== '');

  return (
    <section aria-labelledby={titleId} className={`rounded-lg border-2 border-amber-300 bg-amber-50 p-4 text-sm text-gray-800 ${className}`}>
      <h2 id={titleId} className="mb-2 flex items-center gap-2 text-base font-semibold text-gray-900">
        <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-700" aria-hidden="true" />
        {t('beforePaying.title')}
      </h2>
      <p className="mb-3 font-medium">{t('beforePaying.irreversible')}</p>
      <dl className="space-y-1">
        {rows.map(([key, value]) => (
          <div key={key} className={`flex flex-wrap justify-between gap-x-3 ${key === 'total' ? 'font-bold' : ''}`}>
            <dt>{t(`beforePaying.${key}`)}</dt>
            <dd className="text-right">{value}</dd>
          </div>
        ))}
      </dl>
      {/* createRemittance re-reads the rate on confirm: say so instead of presenting it as locked */}
      {rate && <p className="mt-2 text-xs text-gray-700">{t('beforePaying.rateNote')}</p>}
      <p className="mt-3">{t('beforePaying.estimate')}</p>
      <p className="mt-2">
        {t('beforePaying.seeAlso')}{' '}
        <LegalLink page="terms" onNavigate={onNavigate} className="font-medium text-theme-link-strong underline">
          {t('legal.links.terms')}
        </LegalLink>
        {' · '}
        <LegalLink page="terms" hash="refunds" onNavigate={onNavigate} className="font-medium text-theme-link-strong underline">
          {t('legal.links.refunds')}
        </LegalLink>
      </p>
    </section>
  );
};

export default BeforePayingNotice;
