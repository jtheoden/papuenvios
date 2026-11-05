import React, { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { subscribeCourier, unsubscribeCourier } from '@/lib/courierService';
import { Btn, Field, Notice, errorText, inputCls } from './courierUi';
import { describeRange } from './PaymentTypeForm';

const isCurrent = (r, now) => r.is_active && (!r.valid_to || new Date(r.valid_to).getTime() > now);

/**
 * "Subscribed payment types" of one courier. A subscribed general type ranks as a rule of this courier; it keeps applying
 * as a general rule to everybody else. The RPC validates overlaps / currency / gaps on the courier's effective set; a gap
 * refusal is shown here and confirmed explicitly (resent with acceptGaps).
 * `types` = the listed payment types (all versions); `subscriptions` = the active subscriptions of this courier.
 */
const CourierSubscriptions = ({ courier, subscriptions, types, onChanged }) => {
  const { t } = useLanguage();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [gaps, setGaps] = useState(null); // gaps of the last refusal, for `code`
  const [acceptGaps, setAcceptGaps] = useState(false);

  const now = Date.now();
  const current = types.filter((r) => isCurrent(r, now) && (r.courier_id === null || r.courier_id === courier.id));
  const byCode = new Map(current.map((r) => [r.code, r]));
  const subscribed = new Set(subscriptions.map((s) => s.payment_type_code));
  const offered = [...byCode.values()].filter((r) => !subscribed.has(r.code)).sort((a, b) => a.code.localeCompare(b.code));
  // a subscription whose type has no current version applies nothing: shown as inert, never under the old name
  const nameOf = (c) => byCode.get(c)?.name ?? c;
  const currencyOf = (c) => byCode.get(c)?.currency ?? 'USD';

  const choose = (e) => {
    setCode(e.target.value);
    setGaps(null);
    setAcceptGaps(false); // a confirmation only covers the gaps it was given for
  };

  const run = async (action, okKey) => {
    setBusy(true);
    try {
      await action();
      setMessage({ tone: 'ok', text: t(okKey) });
      setGaps(null);
      setAcceptGaps(false);
      setCode('');
      await onChanged();
    } catch (error) {
      if (error?.gaps?.length) {
        setGaps(error.gaps);
        setAcceptGaps(false);
      }
      setMessage({ tone: error?.gaps?.length ? 'warn' : 'error', text: errorText(t, error) });
    } finally {
      setBusy(false);
    }
  };

  const add = (e) => {
    e.preventDefault();
    if (!code) return;
    if (gaps?.length && !acceptGaps) {
      setMessage({ tone: 'warn', text: t('couriers.types.acceptGapsRequired') });
      return;
    }
    run(() => subscribeCourier(courier.id, code, { acceptGaps: Boolean(gaps?.length) && acceptGaps }), 'couriers.subscriptions.added');
  };

  return (
    <section className="w-full space-y-2 border-t border-gray-200 pt-2" aria-label={`${t('couriers.subscriptions.title')} ${courier.name}`}>
      <h4 className="text-sm font-semibold">{t('couriers.subscriptions.title')}</h4>
      <p className="text-xs text-gray-600">{t('couriers.subscriptions.intro')}</p>
      <div aria-live="polite">{message && <Notice tone={message.tone}>{message.text}</Notice>}</div>

      {subscriptions.length === 0 ? (
        <p className="text-sm text-gray-700">{t('couriers.subscriptions.empty')}</p>
      ) : (
        <ul className="space-y-1">
          {subscriptions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2" data-testid="subscription-row">
              {byCode.has(s.payment_type_code) ? (
                <span className="text-sm">{nameOf(s.payment_type_code)} <span className="text-xs text-gray-600">({s.payment_type_code})</span></span>
              ) : (
                <span className="text-sm text-gray-700">{t('couriers.subscriptions.inert')} <span className="text-xs">({s.payment_type_code})</span></span>
              )}
              <Btn
                onClick={() => run(() => unsubscribeCourier(courier.id, s.payment_type_code), 'couriers.subscriptions.removed')}
                disabled={busy}
                aria-label={`${t('couriers.subscriptions.remove')} ${nameOf(s.payment_type_code)}`}
              >
                {t('couriers.subscriptions.remove')}
              </Btn>
            </li>
          ))}
        </ul>
      )}

      {courier.is_active && (
        <form className="space-y-2" onSubmit={add} noValidate>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[12rem] flex-1">
              <Field label={t('couriers.subscriptions.type')} hint={offered.length === 0 ? t('couriers.subscriptions.noneAvailable') : undefined}>
                {(p) => (
                  <select {...p} className={inputCls} value={code} onChange={choose}>
                    <option value="">{t('couriers.common.choose')}</option>
                    {offered.map((r) => <option key={r.code} value={r.code}>{`${r.name} (${r.code})`}</option>)}
                  </select>
                )}
              </Field>
            </div>
            <Btn tone="primary" type="submit" disabled={busy || !code}>{t('couriers.subscriptions.add')}</Btn>
          </div>
          <div aria-live="polite">
            {gaps?.length > 0 && (
              <div className="space-y-2" data-testid="subscription-gap-warning">
                <Notice tone="warn">
                  <p>{t('couriers.subscriptions.gapWarning')}</p>
                  <ul className="list-disc pl-5">
                    {gaps.map((g) => (
                      <li key={`${g.kind}-${g.from}-${g.to}`}>{t(`couriers.common.kind.${g.kind}`)}: {describeRange(t, g.from, g.to, currencyOf(code))}</li>
                    ))}
                  </ul>
                </Notice>
                <label className="flex min-h-[44px] items-center gap-2 text-sm">
                  <input type="checkbox" className="h-5 w-5" checked={acceptGaps} onChange={(e) => setAcceptGaps(e.target.checked)} />
                  {t('couriers.subscriptions.acceptGaps')}
                </label>
              </div>
            )}
          </div>
        </form>
      )}
    </section>
  );
};

export default CourierSubscriptions;
