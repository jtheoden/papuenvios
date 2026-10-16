/**
 * External USD->EUR reference shown in Settings > Financial. Purely informational: it states where the
 * number comes from and how old it is, and "Use as rate" only hands the value to the parent so it can
 * preload the rate form. Nothing here is persisted or saved.
 */

import React, { useId } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useFxReference } from '@/hooks/useFxReference';
import {
  FX_REFERENCE_STALE_HOURS,
  evaluateReferenceFreshness,
  referenceAgeHours,
  referenceProviderMoment
} from '@/lib/fxReference';
import { formatDateTime, formatDateTimeUtc, formatNumber } from '@/lib/numberFormat';

const ERROR_CODES = ['network', 'timeout', 'invalid_payload', 'out_of_band'];

const FxReferenceCard = ({ onUse, disabledReason = null, autoLoad = true }) => {
  const { t, language } = useLanguage();
  const headingId = useId();
  const { reference, loading, errorCode, check } = useFxReference({ autoLoad });

  const errorKey = ERROR_CODES.includes(errorCode) ? errorCode : 'network';
  const now = new Date();
  const freshness = reference ? evaluateReferenceFreshness(reference, now) : null;
  const stale = freshness === 'stale';
  const ageHours = reference ? referenceAgeHours(reference, now) : null;
  const providerMoment = reference ? referenceProviderMoment(reference) : null;
  const canUse = Boolean(reference) && !stale && !errorCode && !loading && !disabledReason;

  const renderProviderLine = () => {
    if (reference.providerUpdatedAt) {
      return t('settings.fxReference.providerUpdated', {
        local: formatDateTime(reference.providerUpdatedAt, language),
        utc: formatDateTimeUtc(reference.providerUpdatedAt, language)
      });
    }
    if (reference.providerDate) {
      return t('settings.fxReference.providerDate', { date: reference.providerDate });
    }
    return t('settings.fxReference.providerUnknown');
  };

  return (
    <section aria-labelledby={headingId} className="mb-4 rounded-lg border border-gray-300 bg-gray-50 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 id={headingId} className="font-semibold text-gray-900">
          {t('settings.fxReference.title')}
        </h4>
        {(reference || errorCode === null) && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-[44px] px-3"
            onClick={check}
            disabled={loading}
          >
            {reference ? t('settings.fxReference.refresh') : t('settings.fxReference.check')}
          </Button>
        )}
      </div>

      {loading && !reference && (
        <p role="status" className="text-sm text-gray-800">
          {t('settings.fxReference.loading')}
        </p>
      )}

      {!loading && !reference && !errorCode && (
        <p className="text-sm text-gray-800">{t('settings.fxReference.idle')}</p>
      )}

      {errorCode && !reference && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-red-600 bg-red-50 p-3 text-sm text-red-900">
          <span>{t(`settings.fxReference.error.${errorKey}`)}</span>
          <Button type="button" variant="outline" size="sm" className="min-h-[44px] px-3" onClick={check} disabled={loading}>
            {t('settings.fxReference.retry')}
          </Button>
        </div>
      )}

      {reference && (
        <div className="space-y-2">
          <p className="text-base font-semibold text-gray-900">
            {t('settings.fxReference.value', { rate: formatNumber(reference.rate, language, { maximumFractionDigits: 8 }) })}
          </p>
          <div className="space-y-1 text-sm text-gray-800">
            <p>
              {t('settings.fxReference.source', { name: reference.providerName, domain: reference.providerDomain })}
            </p>
            <p>{renderProviderLine()}</p>
            <p>{t('settings.fxReference.fetchedAt', { time: formatDateTime(reference.fetchedAt, language) })}</p>
            {ageHours !== null && <p>{t('settings.fxReference.age', { hours: ageHours })}</p>}
          </div>

          {stale && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-500 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>
                <strong>{t('settings.fxReference.staleTitle')}</strong>{' '}
                <span>
                  {providerMoment
                    ? t('settings.fxReference.stale', { hours: ageHours, limit: FX_REFERENCE_STALE_HOURS })
                    : t('settings.fxReference.staleUnknown')}
                </span>
              </p>
            </div>
          )}

          {errorCode && (
            <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-red-600 bg-red-50 p-3 text-sm text-red-900">
              <span>{t('settings.fxReference.refreshFailed')}</span>
              <Button type="button" variant="outline" size="sm" className="min-h-[44px] px-3" onClick={check} disabled={loading}>
                {t('settings.fxReference.retry')}
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button
              type="button"
              size="sm"
              className="min-h-[44px] px-3"
              disabled={!canUse}
              onClick={() => onUse({ rate: reference.rate })}
            >
              {t('settings.fxReference.use')}
            </Button>
            <span className="text-xs text-gray-700">
              {disabledReason || t('settings.fxReference.useHint')}
            </span>
          </div>
        </div>
      )}
    </section>
  );
};

export default FxReferenceCard;
