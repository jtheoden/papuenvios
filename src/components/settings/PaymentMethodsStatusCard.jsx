/**
 * Payment methods status card (Settings > Zelle tab, top of the tab).
 *
 * One switch per method and flow (orders / remittances). Every change goes
 * through a confirmation dialog that names the consequence and the number of
 * pending operations that will keep being validated; disabling the LAST enabled
 * method of a flow additionally requires an explicit acknowledgement
 * (p_confirm_last on the RPC). Bizum is shown as "coming soon" and cannot be
 * toggled until the backend marks it available.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { usePaymentMethods } from '@/hooks/usePaymentMethods';
import { getPendingOrdersCount } from '@/lib/orderService';
import { getPendingRemittancesCount } from '@/lib/remittanceService';
import {
  PAYMENT_FLOWS,
  PAYMENT_METHOD_ERROR,
  classifyPaymentMethodError
} from '@/lib/paymentMethodsService';

const FLOW_LIST = [PAYMENT_FLOWS.ORDERS, PAYMENT_FLOWS.REMITTANCES];

const ERROR_KEY_BY_KIND = {
  [PAYMENT_METHOD_ERROR.FORBIDDEN]: 'forbidden',
  [PAYMENT_METHOD_ERROR.LAST_ENABLED]: 'lastEnabled',
  [PAYMENT_METHOD_ERROR.UNAVAILABLE]: 'unavailable',
  [PAYMENT_METHOD_ERROR.NOT_FOUND]: 'notFound',
  [PAYMENT_METHOD_ERROR.REASON_TOO_LONG]: 'reasonTooLong'
};

const isFlowEnabled = (row, flow) =>
  flow === PAYMENT_FLOWS.ORDERS ? Boolean(row.enabled_for_orders) : Boolean(row.enabled_for_remittances);

/** DD/MM HH:MM in the viewer's local time. */
const formatStamp = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const PendingCount = ({ count, t }) => {
  if (count === undefined) {
    return <Loader className="h-4 w-4 animate-spin" aria-hidden="true" />;
  }
  return (
    <span>
      {count === null
        ? t('paymentMethods.confirm.pendingUnknown')
        : t('paymentMethods.confirm.pendingBody', { count })}
    </span>
  );
};

const PaymentMethodsStatusCard = () => {
  const { t } = useLanguage();
  const { methods, loading, error, refresh, toggle } = usePaymentMethods({ admin: true });

  const [pending, setPending] = useState(null); // { code, flow, enable, isLast }
  const [pendingCount, setPendingCount] = useState(undefined); // undefined = loading, null = unknown
  const [reason, setReason] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const dialogRef = useRef(null);
  const cancelRef = useRef(null);
  const triggerRef = useRef(null);

  const methodName = (code) => t(`paymentMethods.methods.${code}`);
  const flowName = (flow) => t(`paymentMethods.flows.${flow}`);
  const flowNoun = (flow) => t(`paymentMethods.flowsNoun.${flow}`);

  const closeDialog = useCallback(() => {
    setPending(null);
    setReason('');
    setAcknowledged(false);
    setPendingCount(undefined);
    const trigger = triggerRef.current;
    if (trigger && typeof trigger.focus === 'function') trigger.focus();
  }, []);

  const openDialog = (event, row, flow) => {
    triggerRef.current = event.currentTarget;
    const enable = !isFlowEnabled(row, flow);
    const isLast =
      !enable &&
      !(methods || []).some((m) => m.code !== row.code && m.available && isFlowEnabled(m, flow));
    setReason('');
    setAcknowledged(false);
    setPendingCount(undefined);
    setPending({ code: row.code, flow, enable, isLast });
  };

  // Count of operations that keep being validated, only needed when disabling.
  useEffect(() => {
    if (!pending || pending.enable) return undefined;
    let cancelled = false;
    const loadCount =
      pending.flow === PAYMENT_FLOWS.ORDERS ? getPendingOrdersCount : getPendingRemittancesCount;
    Promise.resolve()
      .then(loadCount)
      .then((count) => {
        if (!cancelled) setPendingCount(Number.isFinite(count) ? count : null);
      })
      .catch(() => {
        if (!cancelled) setPendingCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pending]);

  // Move focus into the dialog when it opens.
  useEffect(() => {
    if (pending && cancelRef.current) cancelRef.current.focus();
  }, [pending]);

  const handleDialogKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (!submitting) closeDialog();
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable = dialogRef.current.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled])'
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleConfirm = async () => {
    if (!pending || submitting) return;
    const { code, flow, enable, isLast } = pending;
    setSubmitting(true);
    try {
      await toggle({
        code,
        flow,
        enabled: enable,
        reason: !enable && reason.trim() ? reason.trim() : null,
        confirmLast: !enable && isLast
      });
      const params = { method: methodName(code), flow: flowName(flow) };
      setAnnouncement(
        t(enable ? 'paymentMethods.liveEnabled' : 'paymentMethods.liveDisabled', params)
      );
      toast({
        title: t(enable ? 'paymentMethods.toast.enabled' : 'paymentMethods.toast.disabled', {
          method: methodName(code),
          flow: flowNoun(flow)
        })
      });
      closeDialog();
    } catch (failure) {
      const key = ERROR_KEY_BY_KIND[classifyPaymentMethodError(failure)] || 'generic';
      toast({
        title: t('paymentMethods.toast.errorTitle'),
        description: t(`paymentMethods.toast.errors.${key}`),
        variant: 'destructive'
      });
      closeDialog();
    } finally {
      setSubmitting(false);
    }
  };

  const renderStatusLine = (row) => {
    const anyDisabled = FLOW_LIST.some((flow) => !isFlowEnabled(row, flow));
    if (!row.available || !anyDisabled) return null;
    const stamp = formatStamp(row.updated_at);
    if (!stamp) return null;
    return (
      <p className="text-xs text-gray-600 mt-1">
        {row.updated_by_name
          ? t('paymentMethods.disabledBy', { name: row.updated_by_name, date: stamp })
          : t('paymentMethods.disabledOn', { date: stamp })}
        {row.disabled_reason ? (
          <>
            {' · '}
            <span>{t('paymentMethods.reason', { reason: row.disabled_reason })}</span>
          </>
        ) : null}
      </p>
    );
  };

  const renderSwitch = (row, flow) => {
    const checked = isFlowEnabled(row, flow);
    const unavailable = !row.available;
    const label = t('paymentMethods.switchLabel', { method: methodName(row.code), flow: flowName(flow) });
    return (
      <div key={flow} className="flex items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={label}
          title={unavailable ? t('paymentMethods.switchUnavailable', { method: methodName(row.code) }) : undefined}
          disabled={unavailable || submitting}
          onClick={(event) => openDialog(event, row, flow)}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
            checked ? 'bg-green-600' : 'bg-gray-400'
          }`}
        >
          <span
            aria-hidden="true"
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              checked ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
        <span className="text-sm text-gray-800" aria-hidden="true">
          {flowName(flow)}
          <span className="ml-1 text-xs text-gray-600">
            ({checked ? t('paymentMethods.enabled') : t('paymentMethods.disabled')})
          </span>
        </span>
      </div>
    );
  };

  let body;
  if (loading && !methods) {
    body = (
      <p className="flex items-center gap-2 text-sm text-gray-600">
        <Loader className="h-4 w-4 animate-spin" aria-hidden="true" />
        {t('paymentMethods.loading')}
      </p>
    );
  } else if (error && !methods) {
    body = (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
        <AlertTriangle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
        <span>{t('paymentMethods.loadError')}</span>
        <Button type="button" variant="outline" size="sm" onClick={() => refresh()}>
          {t('paymentMethods.retry')}
        </Button>
      </div>
    );
  } else {
    body = (
      <ul className="divide-y divide-gray-200">
        {(methods || []).map((row) => (
          <li key={row.code} className="py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-gray-900">{methodName(row.code)}</span>
                {!row.available && (
                  <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700">
                    {t('paymentMethods.comingSoon')}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                {FLOW_LIST.map((flow) => renderSwitch(row, flow))}
              </div>
            </div>
            {renderStatusLine(row)}
          </li>
        ))}
      </ul>
    );
  }

  const dialogTitleId = 'payment-methods-dialog-title';
  const dialogBodyId = 'payment-methods-dialog-body';

  return (
    <section aria-labelledby="payment-methods-title" className="mb-8 rounded-xl border border-gray-200 bg-white/70 p-4 sm:p-6">
      <h3 id="payment-methods-title" className="text-lg font-bold text-gray-900">
        {t('paymentMethods.title')}
      </h3>
      <p className="mb-3 mt-1 text-sm text-gray-600">{t('paymentMethods.description')}</p>

      {body}

      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {pending && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div
            ref={dialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            aria-describedby={dialogBodyId}
            onKeyDown={handleDialogKeyDown}
            className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-2xl"
          >
            <h4 id={dialogTitleId} className="text-lg font-bold text-gray-900">
              {t(pending.enable ? 'paymentMethods.confirm.enableTitle' : 'paymentMethods.confirm.disableTitle', {
                method: methodName(pending.code),
                flow: flowName(pending.flow)
              })}
            </h4>

            <div id={dialogBodyId} className="space-y-2 text-sm text-gray-700">
              <p>
                {t(pending.enable ? 'paymentMethods.confirm.enableBody' : 'paymentMethods.confirm.disableBody', {
                  method: methodName(pending.code),
                  flow: flowNoun(pending.flow)
                })}
              </p>
              {!pending.enable && (
                <p>
                  <PendingCount count={pendingCount} t={t} />
                </p>
              )}
            </div>

            {!pending.enable && pending.isLast && (
              <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="flex items-start gap-2 font-semibold">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
                  {t('paymentMethods.confirm.lastTitle')}
                </p>
                <p>{t('paymentMethods.confirm.lastBody', { flow: flowNoun(pending.flow) })}</p>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                    className="mt-1 h-4 w-4"
                  />
                  <span>{t('paymentMethods.confirm.lastCheckbox', { flow: flowNoun(pending.flow) })}</span>
                </label>
              </div>
            )}

            {!pending.enable && (
              <div className="space-y-1">
                <label htmlFor="payment-methods-reason" className="block text-sm font-medium text-gray-800">
                  {t('paymentMethods.confirm.reasonLabel')}
                </label>
                <input
                  id="payment-methods-reason"
                  type="text"
                  maxLength={200}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder={t('paymentMethods.confirm.reasonPlaceholder')}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button ref={cancelRef} type="button" variant="outline" onClick={closeDialog} disabled={submitting}>
                {t('paymentMethods.confirm.cancel')}
              </Button>
              <Button
                type="button"
                variant={pending.enable ? 'default' : 'destructive'}
                onClick={handleConfirm}
                disabled={submitting || (!pending.enable && pending.isLast && !acknowledged)}
              >
                {t(pending.enable ? 'paymentMethods.confirm.confirmEnable' : 'paymentMethods.confirm.confirmDisable')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default PaymentMethodsStatusCard;
