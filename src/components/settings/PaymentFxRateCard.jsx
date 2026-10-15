/**
 * "Tipo EUR" card (Settings > Payments > Bizum): latest USD->EUR rate, its freshness state and the
 * form to load a new one. The freshness state and the warn / block thresholds come from the server
 * (get_payment_fx_status); nothing is computed or hardcoded here. A new rate that moves the effective
 * rate more than the configured maximum is answered with payment_fx_large_change: the card asks for
 * confirmation in its own dialog and retries the identical payload with confirmLargeChange = true.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Loader } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { toBizumError } from '@/lib/bizumErrors';
import {
  PAYMENT_FX_BOUNDS,
  PAYMENT_FX_STATES,
  changePercent,
  effectiveRate,
  setPaymentFxRate,
  validatePaymentFxForm
} from '@/lib/paymentFxService';
import { formatDateTime, formatNumber } from '@/lib/numberFormat';
import { parseDecimal } from '@/lib/bizumService';
import BizumDialog from '@/components/settings/BizumDialog';
import BizumField from '@/components/settings/BizumField';

const STATE_STYLES = {
  [PAYMENT_FX_STATES.NONE]: 'border-gray-400 bg-gray-50 text-gray-900',
  [PAYMENT_FX_STATES.OK]: 'border-green-600 bg-green-50 text-green-900',
  [PAYMENT_FX_STATES.WARN]: 'border-amber-500 bg-amber-50 text-amber-900',
  [PAYMENT_FX_STATES.BLOCKED]: 'border-red-600 bg-red-50 text-red-900'
};

const FORM_FIELD_IDS = { mid: 'fx-rate-mid', spread: 'fx-rate-spread', note: 'fx-rate-note' };

const Metric = ({ label, children }) => (
  <div>
    <dt className="text-xs font-medium uppercase tracking-wide text-gray-700">{label}</dt>
    <dd className="text-base font-semibold">{children}</dd>
  </div>
);

const PaymentFxRateCard = ({ status, error, defaultSpread, onSaved, onRetry }) => {
  const { t, language } = useLanguage();
  const savingRef = useRef(false);
  const [mid, setMid] = useState('');
  const [spread, setSpread] = useState(defaultSpread == null ? '' : String(defaultSpread));
  const [spreadTouched, setSpreadTouched] = useState(false);
  const [note, setNote] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pendingLargeChange, setPendingLargeChange] = useState(null);

  // The settings may arrive after the card mounted; follow them until the admin edits the spread.
  useEffect(() => {
    if (!spreadTouched) setSpread(defaultSpread == null ? '' : String(defaultSpread));
  }, [defaultSpread, spreadTouched]);

  const fieldMessage = (field, code) => {
    const params = field === 'note' ? {} : { ...PAYMENT_FX_BOUNDS[field] };
    return t(`settings.fxRate.validation.${code}`, params);
  };

  const showError = (failure) => {
    const bizumError = toBizumError(failure);
    if (bizumError.field && ['mid', 'spread', 'note'].includes(bizumError.field)) {
      setFieldErrors({ [bizumError.field]: t(bizumError.i18nKey) });
      setFormError(null);
    } else {
      setFormError(t(bizumError.i18nKey));
    }
  };

  const finishSaved = () => {
    toast({ title: t('settings.fxRate.saved') });
    setMid('');
    setNote('');
    setFieldErrors({});
    setFormError(null);
    onSaved();
  };

  const focusFirstInvalid = (fields) => {
    const first = ['mid', 'spread', 'note'].find((field) => fields.includes(field));
    if (first) document.getElementById(FORM_FIELD_IDS[first])?.focus();
  };

  const handleSubmit = async (event) => {
    event?.preventDefault();
    if (savingRef.current) return;
    const codes = validatePaymentFxForm({ mid, spread, note });
    if (Object.keys(codes).length > 0) {
      setFieldErrors(Object.fromEntries(Object.entries(codes).map(([field, code]) => [field, fieldMessage(field, code)])));
      focusFirstInvalid(Object.keys(codes));
      return;
    }
    setFieldErrors({});
    setFormError(null);
    const payload = { mid: parseDecimal(mid), spread: parseDecimal(spread), source: 'manual', note: note.trim() };
    savingRef.current = true;
    setSaving(true);
    try {
      await setPaymentFxRate({ ...payload, confirmLargeChange: false });
      finishSaved();
    } catch (failure) {
      if (toBizumError(failure).token === 'payment_fx_large_change') setPendingLargeChange(payload);
      else showError(failure);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleConfirmLargeChange = async () => {
    if (savingRef.current) return;
    const payload = pendingLargeChange;
    savingRef.current = true;
    setSaving(true);
    try {
      await setPaymentFxRate({ ...payload, confirmLargeChange: true });
      setPendingLargeChange(null);
      finishSaved();
    } catch (failure) {
      setPendingLargeChange(null);
      showError(failure);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  let largeChangeDetail = null;
  if (pendingLargeChange && status) {
    const next = effectiveRate(pendingLargeChange.mid, pendingLargeChange.spread);
    const change = changePercent(status.effective_rate, next);
    const sign = change >= 0 ? '+' : '-';
    largeChangeDetail = (
      <p className="text-sm font-medium text-gray-900">
        {t('settings.fxRate.largeChange.detail', {
          previous: formatNumber(status.effective_rate, language),
          next: formatNumber(next, language),
          change: `${sign}${formatNumber(Math.abs(change), language, { maximumFractionDigits: 2 })}`
        })}
      </p>
    );
  }

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
              {t('settings.fxRate.warnHelp')}
            </p>
          )}
          {state === PAYMENT_FX_STATES.BLOCKED && (
            <p role="alert" className="text-sm font-medium">
              {t('settings.fxRate.blockedHelp')}
            </p>
          )}
          {hasRate && (
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Metric label={t('settings.fxRate.labels.mid')}>{formatNumber(status.mid_rate, language)}</Metric>
              <Metric label={t('settings.fxRate.labels.spread')}>
                {`${formatNumber(status.spread_pct, language, { maximumFractionDigits: 2 })}%`}
              </Metric>
              <Metric label={t('settings.fxRate.labels.effective')}>{formatNumber(status.effective_rate, language)}</Metric>
              <Metric label={t('settings.fxRate.labels.author')}>
                {status.created_by_name || t('settings.fxRate.authorUnknown')}
              </Metric>
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

      {status && (
        <form onSubmit={handleSubmit} noValidate className="space-y-4" aria-labelledby="fx-rate-form-title">
          <h4 id="fx-rate-form-title" className="text-base font-semibold text-gray-900">
            {t('settings.fxRate.form.title')}
          </h4>
          <div className="grid gap-4 sm:grid-cols-2">
            <BizumField
              id="fx-rate-mid"
              label={t('settings.fxRate.form.mid')}
              help={t('settings.fxRate.form.midHelp')}
              value={mid}
              inputMode="decimal"
              error={fieldErrors.mid}
              onChange={setMid}
            />
            <BizumField
              id="fx-rate-spread"
              label={t('settings.fxRate.form.spread')}
              help={t('settings.fxRate.form.spreadHelp')}
              value={spread}
              inputMode="decimal"
              error={fieldErrors.spread}
              onChange={(value) => {
                setSpreadTouched(true);
                setSpread(value);
              }}
            />
          </div>
          <BizumField
            id="fx-rate-note"
            label={t('settings.fxRate.form.note')}
            value={note}
            multiline
            error={fieldErrors.note}
            onChange={setNote}
          />
          {formError && (
            <p role="alert" className="rounded-lg border border-red-600 bg-red-50 p-3 text-sm text-red-900">
              {formError}
            </p>
          )}
          <Button type="submit" size="lg" disabled={saving}>
            {saving && <Loader className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {saving ? t('settings.fxRate.form.submitting') : t('settings.fxRate.form.submit')}
          </Button>
        </form>
      )}

      <BizumDialog
        open={Boolean(pendingLargeChange)}
        onOpenChange={(open) => {
          if (!open && !savingRef.current) setPendingLargeChange(null);
        }}
        title={t('settings.fxRate.largeChange.title')}
        description={t('settings.fxRate.largeChange.message')}
        body={largeChangeDetail}
        footer={
          <>
            <Button variant="outline" size="lg" onClick={() => setPendingLargeChange(null)} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button size="lg" onClick={handleConfirmLargeChange} disabled={saving}>
              {t('settings.fxRate.largeChange.confirm')}
            </Button>
          </>
        }
      />
    </section>
  );
};

export default PaymentFxRateCard;
