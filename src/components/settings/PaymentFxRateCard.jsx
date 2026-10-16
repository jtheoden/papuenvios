/**
 * "Tipo EUR" card (Settings > Payments > Bizum): read-only view of the USD->EUR rate Bizum quotes with.
 * The rate is the central one loaded in Financial Settings (exchange_rates); this card never writes it, so
 * there is no second place to type a rate. The freshness state and the warn / block thresholds come from
 * the server (get_payment_fx_status); nothing is computed or hardcoded here.
 */

import React from 'react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { PAYMENT_FX_STATES } from '@/lib/paymentFxService';
import { formatDateTime, formatNumber } from '@/lib/numberFormat';

const STATE_STYLES = {
  [PAYMENT_FX_STATES.NONE]: 'border-gray-400 bg-gray-50 text-gray-900',
  [PAYMENT_FX_STATES.OK]: 'border-green-600 bg-green-50 text-green-900',
  [PAYMENT_FX_STATES.WARN]: 'border-amber-500 bg-amber-50 text-amber-900',
  [PAYMENT_FX_STATES.BLOCKED]: 'border-red-600 bg-red-50 text-red-900'
};

const Metric = ({ label, children }) => (
  <div>
    <dt className="text-xs font-medium uppercase tracking-wide text-gray-700">{label}</dt>
    <dd className="text-base font-semibold">{children}</dd>
  </div>
);

const PaymentFxRateCard = ({ status, error, onRetry, onGoToFinancial }) => {
  const { t, language } = useLanguage();
  const state = status?.state;
  const hasRate = state && state !== PAYMENT_FX_STATES.NONE;

  return (
    <section aria-labelledby="fx-rate-title" className="space-y-4 rounded-xl border border-gray-300 bg-white p-4 sm:p-6">
      <div>
        <h3 id="fx-rate-title" className="text-lg font-semibold text-gray-900">
          {t('settings.fxRate.title')}
        </h3>
        <p className="mt-1 text-sm text-gray-700">{t('settings.fxRate.intro')}</p>
      </div>

      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-red-600 bg-red-50 p-4 text-sm text-red-900">
          <span>{t(error.i18nKey || 'settings.bizum.errors.unknown')}</span>
          <Button variant="outline" size="lg" onClick={onRetry}>
            {t('settings.bizum.retry')}
          </Button>
        </div>
      )}

      {status && (
        <div
          data-testid="fx-status"
          data-state={state}
          className={`space-y-3 rounded-lg border-2 p-4 ${STATE_STYLES[state] || STATE_STYLES[PAYMENT_FX_STATES.NONE]}`}
        >
          <p className="text-base font-semibold">{t(`settings.fxRate.state.${state}`)}</p>
          {!hasRate && <p className="text-sm">{t('settings.fxRate.noneHelp')}</p>}
          {state === PAYMENT_FX_STATES.WARN && (
            <p role="status" className="text-sm">
              {t('settings.fxRate.warnHelp', { hours: formatNumber(status.age_hours, language, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}
            </p>
          )}
          {state === PAYMENT_FX_STATES.BLOCKED && (
            <p role="alert" className="text-sm font-medium">
              {t('settings.fxRate.blockedHelp')}
            </p>
          )}
          {hasRate && (
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Metric label={t('settings.fxRate.labels.source')}>{t('settings.fxRate.sourceCentral')}</Metric>
              <Metric label={t('settings.fxRate.labels.mid')}>{formatNumber(status.mid_rate, language)}</Metric>
              <Metric label={t('settings.fxRate.labels.spread')}>
                {`${formatNumber(status.spread_pct, language, { maximumFractionDigits: 2 })}%`}
              </Metric>
              <Metric label={t('settings.fxRate.labels.effective')}>{formatNumber(status.effective_rate, language)}</Metric>
              <Metric label={t('settings.fxRate.labels.age')}>
                {t('settings.fxRate.age', { hours: formatNumber(status.age_hours, language, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}
                <span className="block text-xs font-normal">{formatDateTime(status.created_at, language)}</span>
              </Metric>
            </dl>
          )}
          <p className="text-xs">
            <span className="font-medium">{t('settings.fxRate.labels.thresholds')}: </span>
            {t('settings.fxRate.thresholds', { warn: status.fx_warn_hours, block: status.fx_block_hours })}
          </p>
        </div>
      )}

      <p className="text-sm text-gray-700">{t('settings.fxRate.managedCentrally')}</p>
      {onGoToFinancial && (
        <Button variant="outline" size="lg" onClick={onGoToFinancial}>
          {t('settings.fxRate.goToFinancial')}
        </Button>
      )}
    </section>
  );
};

export default PaymentFxRateCard;
