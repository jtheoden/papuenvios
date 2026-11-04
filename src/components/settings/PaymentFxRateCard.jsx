/**
 * Read-only rate card shared by every payment-method tab.
 *
 * Default (no `pair`): the Bizum "Tipo EUR" card. The status comes from get_payment_fx_status, so the
 * freshness state and the warn / block thresholds are the server's; nothing is computed here.
 *
 * With `pair={{ from, to }}`: the same card for any other pair (e.g. USD -> CUP for Zelle). The status comes
 * from buildRateStatus(getActiveRate(...)); thresholds, spread and effective rate are optional blocks that
 * only render when present, and without thresholds the age is informative only: it never blocks anything.
 *
 * Either way the rate is the central one loaded in Financial Settings (exchange_rates); the card never writes
 * it, so there is no second place to type a rate.
 */

import React from 'react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { PAYMENT_FX_STATES } from '@/lib/paymentFxService';
import { formatDateOnly, formatDateTime, formatNumber, formatRate } from '@/lib/numberFormat';
import FxStateIcon from './FxStateIcon';

const STATE_STYLES = {
  [PAYMENT_FX_STATES.NONE]: 'border-gray-400 bg-gray-50 text-gray-900',
  [PAYMENT_FX_STATES.OK]: 'border-green-600 bg-green-50 text-green-900',
  [PAYMENT_FX_STATES.WARN]: 'border-amber-500 bg-amber-50 text-amber-900',
  [PAYMENT_FX_STATES.BLOCKED]: 'border-red-600 bg-red-50 text-red-900'
};

const BASE = 'settings.fxRate';
const ONE_DECIMAL = { minimumFractionDigits: 1, maximumFractionDigits: 1 };
const has = (value) => value !== null && value !== undefined;

const Metric = ({ label, children }) => (
  <div>
    <dt className="text-xs font-medium uppercase tracking-wide text-gray-700">{label}</dt>
    <dd className="text-base font-semibold">{children}</dd>
  </div>
);

const PaymentFxRateCard = ({ status, error, onRetry, onGoToFinancial, pair }) => {
  const { t, language } = useLanguage();
  const state = status?.state;
  const hasRate = state && state !== PAYMENT_FX_STATES.NONE;
  const generic = Boolean(pair);
  const ns = generic ? `${BASE}.generic` : BASE;
  const params = generic ? { from: pair.from, to: pair.to } : {};
  const titleId = generic ? `fx-rate-title-${pair.from}-${pair.to}` : 'fx-rate-title';
  const ageHours = formatNumber(status?.age_hours, language, ONE_DECIMAL); // '' when unknown
  const since = status?.effective_date ? formatDateOnly(status.effective_date, language) : formatDateTime(status?.created_at, language);

  return (
    <section aria-labelledby={titleId} className="space-y-4 rounded-xl border border-gray-300 bg-white p-4 sm:p-6">
      <div>
        <h3 id={titleId} className="text-lg font-semibold text-gray-900">
          {t(`${ns}.title`, params)}
        </h3>
        <p className="mt-1 text-sm text-gray-700">{t(`${ns}.intro`, params)}</p>
      </div>

      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-red-600 bg-red-50 p-4 text-sm text-red-900">
          <span>{generic ? t(`${ns}.loadError`, params) : t(error.i18nKey || 'settings.bizum.errors.unknown')}</span>
          <Button variant="outline" size="lg" onClick={onRetry}>
            {generic ? t(`${ns}.retry`) : t('settings.bizum.retry')}
          </Button>
        </div>
      )}

      {status && (
        <div
          data-testid="fx-status"
          data-state={state}
          className={`space-y-3 rounded-lg border-2 p-4 ${STATE_STYLES[state] || STATE_STYLES[PAYMENT_FX_STATES.NONE]}`}
        >
          <p className="text-base font-semibold">
            <FxStateIcon state={state} className="mr-2 align-text-bottom" />
            {t(`${ns}.state.${state}`)}
          </p>
          {!hasRate && <p className="text-sm">{t(`${ns}.noneHelp`, params)}</p>}
          {state === PAYMENT_FX_STATES.WARN && (
            <p role="status" className="text-sm">
              {t(`${ns}.warnHelp`, { ...params, hours: ageHours })}
            </p>
          )}
          {state === PAYMENT_FX_STATES.BLOCKED && (
            <p role="alert" className="text-sm font-medium">
              {t(`${ns}.blockedHelp`, params)}
            </p>
          )}
          {generic && state === PAYMENT_FX_STATES.OK && ageHours !== '' && (
            <p className="text-sm">{t(`${ns}.ageNote`, { hours: ageHours })}</p>
          )}
          {hasRate && (
            <dl className={generic ? 'grid grid-cols-1 gap-4 sm:grid-cols-3' : 'grid grid-cols-2 gap-4 sm:grid-cols-3'}>
              <Metric label={t('settings.fxRate.labels.source')}>{t('settings.fxRate.sourceCentral')}</Metric>
              <Metric label={t(generic ? `${ns}.labels.rate` : 'settings.fxRate.labels.mid')}>{formatRate(status.mid_rate, language)}</Metric>
              {has(status.spread_pct) && (
                <Metric label={t('settings.fxRate.labels.spread')}>
                  {`${formatNumber(status.spread_pct, language, { maximumFractionDigits: 2 })}%`}
                </Metric>
              )}
              {has(status.effective_rate) && (
                <Metric label={t('settings.fxRate.labels.effective')}>{formatRate(status.effective_rate, language)}</Metric>
              )}
              <Metric label={t('settings.fxRate.labels.age')}>
                {t('settings.fxRate.age', { hours: ageHours })}
                <span className="block text-xs font-normal">{since}</span>
              </Metric>
            </dl>
          )}
          {has(status.fx_warn_hours) && (
            <p className="text-xs">
              <span className="font-medium">{t('settings.fxRate.labels.thresholds')}: </span>
              {t('settings.fxRate.thresholds', { warn: status.fx_warn_hours, block: status.fx_block_hours })}
            </p>
          )}
        </div>
      )}

      <p className="text-sm text-gray-700">{t(`${ns}.managedCentrally`, params)}</p>
      {onGoToFinancial && (
        <Button variant="outline" size="lg" onClick={onGoToFinancial}>
          {t('settings.fxRate.goToFinancial')}
        </Button>
      )}
    </section>
  );
};

export default PaymentFxRateCard;
