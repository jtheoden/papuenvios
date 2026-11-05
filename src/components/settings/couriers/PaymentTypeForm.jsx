import React, { useMemo, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { setPaymentType } from '@/lib/courierService';
import {
  RULE_METHODS, RULE_APPLIES_TO, RULE_BASES, RULE_CURRENCIES, RANGE_OPERATORS, validateRuleForm, buildRuleArgs, simulateRule,
  analyzeRuleConflicts, coverageGapsFromError, centsToText
} from '@/lib/courierRules';
import { Btn, Field, Notice, errorText, inputCls, formatCup, formatUsd } from './courierUi';

export const EMPTY_RULE_FORM = {
  code: '', name: '', appliesTo: 'remittance', method: 'fixed_amount', fixedCup: '', fixedAmount: '', cupPerUsd: '', percent: '',
  base: '', currency: 'USD', courierId: '', zoneId: '', typeId: '', rangeOp: 'none', rangeX: '', rangeY: '', validFrom: '', validTo: ''
};
const EMPTY_SIM = { amountSentUsd: '', amountToDeliver: '', rate: '', commissionUsd: '', deliveryChargeUsd: '' };

/** Human text of a (from, to] range in cents, same wording as the operators of the form. */
export const describeRange = (t, from, to, currency) => {
  if (from === null && to === null) return t('couriers.types.range.any');
  if (from === null) return t('couriers.types.range.lte', { y: centsToText(to), currency });
  if (to === null) return t('couriers.types.range.gt', { x: centsToText(from), currency });
  return t('couriers.types.range.between', { x: centsToText(from), y: centsToText(to), currency });
};

const Simulator = ({ form, thresholds }) => {
  const { t } = useLanguage();
  const [sim, setSim] = useState(EMPTY_SIM);
  const valid = Object.keys(validateRuleForm(form)).length === 0;
  const result = useMemo(
    () => (valid ? simulateRule(
      {
        method: form.method, fixedCup: form.fixedCup, fixedAmount: form.fixedAmount, cupPerUsd: form.cupPerUsd, percent: form.percent,
        base: form.base, currency: form.currency, rangeOp: form.rangeOp, rangeX: form.rangeX, rangeY: form.rangeY
      },
      { ...sim, warningPct: thresholds?.warningPct, criticalPct: thresholds?.criticalPct }
    ) : null),
    [valid, form, sim, thresholds]
  );
  const set = (key) => (e) => setSim({ ...sim, [key]: e.target.value });
  const margin = result?.margin;
  return (
    <fieldset className="space-y-3 rounded-xl border border-dashed border-gray-300 p-3" data-testid="rule-simulator">
      <legend className="px-1 text-sm font-semibold">{t('couriers.simulator.title')}</legend>
      <p className="text-xs text-gray-700">{t('couriers.simulator.intro')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {[['amountSentUsd', 'sent'], ['commissionUsd', 'commission'], ['deliveryChargeUsd', 'deliveryCharge'], ['rate', 'rate'], ['amountToDeliver', 'toDeliver']].map(([key, label]) => (
          <Field key={key} label={t(`couriers.simulator.${label}`)}>
            {(p) => <input {...p} className={inputCls} inputMode="decimal" value={sim[key]} onChange={set(key)} />}
          </Field>
        ))}
      </div>
      <div aria-live="polite" data-testid="simulator-result" className="space-y-1 text-sm">
        {!valid && <p className="text-gray-700">{t('couriers.simulator.completeForm')}</p>}
        {result && (
          <>
            <p>{t('couriers.simulator.cost')}: <strong>{formatCup(result.cup) ?? t('couriers.common.unknown')}</strong> / <strong>{formatUsd(result.usd) ?? t('couriers.common.unknown')}</strong></p>
            {result.cup === null && <p className="text-amber-900">{t(`couriers.simulator.reasons.${result.reason}`)}</p>}
            <p>
              {t('couriers.simulator.margin')}:{' '}
              <strong>{margin.marginUsd === null ? t('couriers.common.unknown') : `${formatUsd(margin.marginUsd)} (${margin.marginPct}%)`}</strong>
            </p>
            <p data-testid="simulator-status">
              {t(`couriers.margin.${margin.status}`)}
              {margin.status === 'warning' && ` - ${t('couriers.simulator.belowWarning')}`}
              {margin.status === 'critical' && ` - ${t('couriers.simulator.belowCritical')}`}
            </p>
            {!thresholds || (thresholds.warningPct === null && thresholds.criticalPct === null) ? (
              <p className="text-xs text-gray-600">{t('couriers.simulator.noThresholds')}</p>
            ) : null}
          </>
        )}
      </div>
    </fieldset>
  );
};

const SelectField = ({ form, set, err, field, label, options, blank, hint }) => (
  <Field label={label} error={err(field)} hint={hint}>
    {(p) => (
      <select {...p} className={inputCls} value={form[field]} onChange={set(field)}>
        {blank !== undefined && <option value="">{blank}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    )}
  </Field>
);

const MoneyInput = ({ form, set, err, field, label, hint }) => (
  <Field label={label} error={err(field)} hint={hint}>
    {(p) => <input {...p} className={inputCls} inputMode="decimal" value={form[field]} onChange={set(field)} />}
  </Field>
);

/**
 * Create / new-version form of a payment type. Methods are the enumerated ones; every number is typed by the admin.
 * `lockedCode` (editing) keeps the code: saving creates a NEW VERSION that only applies to deliveries from its start on.
 * `rules` = the listed payment types: overlaps and gaps are checked here AND again by the RPC (which has the last word).
 */
const PaymentTypeForm = ({ initial, lockedCode = false, rules = [], couriers, zones, remittanceTypes, thresholds, onSaved, onCancel }) => {
  const { t } = useLanguage();
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [acceptGaps, setAcceptGaps] = useState(false);
  const [serverGaps, setServerGaps] = useState(null);
  const set = (key) => (e) => {
    setForm({ ...form, [key]: e.target.value });
    setServerGaps(null);
    setAcceptGaps(false); // a confirmation only covers the ranges it was given for
  };
  const err = (key) => (errors[key] ? t(`couriers.validation.${errors[key]}`) : undefined);
  const usesBase = form.method === 'per_usd_delivered' || form.method === 'percent_of_base';
  const op = form.rangeOp;
  // fixed_cup stays readable for older versions; new rules use the fixed amount with its currency
  const methods = RULE_METHODS.filter((m) => m !== 'fixed_cup' || initial.method === 'fixed_cup');

  const conflicts = useMemo(() => analyzeRuleConflicts(form, rules), [form, rules]);
  const gaps = serverGaps ?? conflicts.gaps;

  const submit = async (e) => {
    e.preventDefault();
    const found = validateRuleForm(form);
    setErrors(found);
    if (Object.keys(found).length) return;
    if (conflicts.overlap || conflicts.mixedCurrency) {
      setMessage({ tone: 'error', text: t(conflicts.overlap ? 'couriers.errors.overlap' : 'couriers.errors.mixedCurrency') });
      return;
    }
    if (gaps.length && !acceptGaps) {
      setMessage({ tone: 'warn', text: t('couriers.types.acceptGapsRequired') });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await setPaymentType(buildRuleArgs(form, { acceptGaps: gaps.length > 0 && acceptGaps }));
      await onSaved();
    } catch (error) {
      const fromServer = coverageGapsFromError(error);
      if (fromServer?.length) {
        setServerGaps(fromServer);
        setAcceptGaps(false);
      }
      setMessage({ tone: fromServer?.length ? 'warn' : 'error', text: errorText(t, error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="space-y-4 rounded-xl border border-gray-200 bg-white p-4" aria-label={t('couriers.types.formTitle')} onSubmit={submit} noValidate>
      <Notice tone="warn">{t('couriers.types.onlyNewDeliveries')}</Notice>
      <div aria-live="polite">{message && <Notice tone={message.tone}>{message.text}</Notice>}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('couriers.types.code')} error={err('code')} hint={lockedCode ? t('couriers.types.codeLocked') : t('couriers.types.codeHint')}>
          {(p) => <input {...p} className={inputCls} value={form.code} maxLength={100} readOnly={lockedCode} onChange={set('code')} />}
        </Field>
        <Field label={t('couriers.types.name')} error={err('name')}>
          {(p) => <input {...p} className={inputCls} value={form.name} maxLength={200} onChange={set('name')} />}
        </Field>
        <SelectField form={form} set={set} err={err} field="appliesTo" label={t('couriers.types.appliesTo')} options={RULE_APPLIES_TO.map((v) => ({ value: v, label: t(`couriers.types.applies.${v}`) }))} />
        <SelectField form={form} set={set} err={err} field="method" label={t('couriers.types.method')} options={methods.map((v) => ({ value: v, label: t(`couriers.types.methods.${v}`) }))} />
        <SelectField form={form} set={set} err={err} field="currency" label={t('couriers.types.currency')} hint={t('couriers.types.currencyHint')}
          options={RULE_CURRENCIES.map((v) => ({ value: v, label: v }))} />

        {form.method === 'fixed_amount' && <MoneyInput form={form} set={set} err={err} field="fixedAmount" label={t('couriers.types.fixedAmount')} />}
        {form.method === 'fixed_cup' && (
          <Field label={t('couriers.types.fixedCup')} error={err('fixedCup')}>
            {(p) => <input {...p} className={inputCls} inputMode="decimal" value={form.fixedCup} onChange={set('fixedCup')} />}
          </Field>
        )}
        {form.method === 'per_usd_delivered' && (
          <Field label={t('couriers.types.cupPerUsd')} error={err('cupPerUsd')}>
            {(p) => <input {...p} className={inputCls} inputMode="decimal" value={form.cupPerUsd} onChange={set('cupPerUsd')} />}
          </Field>
        )}
        {form.method === 'percent_of_base' && (
          <Field label={t('couriers.types.percent')} error={err('percent')}>
            {(p) => <input {...p} className={inputCls} inputMode="decimal" value={form.percent} onChange={set('percent')} />}
          </Field>
        )}
        {usesBase && (
          <SelectField form={form} set={set} err={err} field="base" label={t('couriers.types.base')} blank={t('couriers.common.choose')}
            options={RULE_BASES.map((v) => ({ value: v, label: t(`couriers.types.bases.${form.method}.${v}`) }))} />
        )}
      </div>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-semibold">{t('couriers.types.scope')}</legend>
        <SelectField form={form} set={set} err={err} field="courierId" label={t('couriers.types.courier')} blank={t('couriers.types.anyCourier')}
          options={couriers.filter((c) => c.is_active).map((c) => ({ value: c.id, label: c.name }))} />
        <SelectField form={form} set={set} err={err} field="zoneId" label={t('couriers.types.zone')} blank={t('couriers.types.anyZone')} options={zones.map((z) => ({ value: z.id, label: z.label }))} />
        <SelectField form={form} set={set} err={err} field="typeId" label={t('couriers.types.remittanceType')} blank={t('couriers.types.anyType')} options={remittanceTypes.map((r) => ({ value: r.id, label: r.label }))} />
        <SelectField form={form} set={set} err={err} field="rangeOp" label={t('couriers.types.rangeOp')}
          hint={t('couriers.types.rangeHelp', { currency: form.currency })}
          options={RANGE_OPERATORS.map((v) => ({ value: v, label: t(`couriers.types.rangeOps.${v}`) }))} />
        {(op === 'gt' || op === 'between') && <MoneyInput form={form} set={set} err={err} field="rangeX" label={t('couriers.types.rangeX')} />}
        {(op === 'lte' || op === 'between') && <MoneyInput form={form} set={set} err={err} field="rangeY" label={t('couriers.types.rangeY')} />}
        <Field label={t('couriers.types.validFrom')} error={err('validFrom')} hint={t('couriers.types.validFromHint')}>
          {(p) => <input {...p} type="datetime-local" className={inputCls} value={form.validFrom} onChange={set('validFrom')} />}
        </Field>
        <Field label={t('couriers.types.validTo')} error={err('validTo')}>
          {(p) => <input {...p} type="datetime-local" className={inputCls} value={form.validTo} onChange={set('validTo')} />}
        </Field>
      </fieldset>

      <div aria-live="polite">
        {gaps.length > 0 && (
          <div className="space-y-2" data-testid="range-gap-warning">
            <Notice tone="warn">
              <p>{t('couriers.types.gapWarning')}</p>
              <ul className="list-disc pl-5">
                {gaps.map((g) => (
                  <li key={`${g.kind}-${g.from}-${g.to}`}>{t(`couriers.common.kind.${g.kind}`)}: {describeRange(t, g.from, g.to, form.currency)}</li>
                ))}
              </ul>
            </Notice>
            <label className="flex min-h-[44px] items-center gap-2 text-sm">
              <input type="checkbox" className="h-5 w-5" checked={acceptGaps} onChange={(e) => setAcceptGaps(e.target.checked)} />
              {t('couriers.types.acceptGaps')}
            </label>
          </div>
        )}
      </div>

      <Simulator form={form} thresholds={thresholds} />

      <div className="flex flex-wrap gap-2">
        <Btn tone="primary" type="submit" disabled={busy}>{t(lockedCode ? 'couriers.types.saveVersion' : 'couriers.common.save')}</Btn>
        <Btn onClick={onCancel} disabled={busy}>{t('couriers.common.cancel')}</Btn>
      </div>
    </form>
  );
};

export default PaymentTypeForm;
