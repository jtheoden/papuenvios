import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { isRefundDateClamped, refundedAtFromDate, todayLocalDay } from '@/lib/refundRules';
import { REFUND_HOLD_HOURS } from '@/lib/legalConfig';

const K = 'adminRefunds.';
const MAX_REFERENCE = 200;
const MAX_REASON = 500;
const FOCUSABLE = 'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [href]';
const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-600';
const PRESETS = ['neverArrived', 'outsideApp', 'duplicate'];

/** Message for a refusal thrown by resolveRefund (context.reason) or an unexpected error. */
export const refundErrorMessage = (t, error, language = 'es') => {
  const context = error?.context || {};
  switch (context.reason) {
    case 'refund_on_hold':
      return t(`${K}errors.onHold`, {
        hours: REFUND_HOLD_HOURS,
        date: context.eligibleAt ? new Date(context.eligibleAt).toLocaleString(language) : ''
      });
    case 'already_resolved':
      return t(`${K}errors.alreadyResolved`);
    case 'not_authorized':
      return t(`${K}errors.notAuthorized`);
    case 'refund_not_found':
      return t(`${K}errors.notFound`);
    case 'invalid_argument':
      if (context.field === 'p_reference') return t(`${K}errors.invalidReference`);
      if (context.field === 'p_refunded_at') return t(`${K}errors.invalidDate`);
      if (context.field === 'p_reason') return t(`${K}errors.invalidReason`);
      return t(`${K}errors.invalidArgument`);
    default:
      return t(`${K}errors.generic`);
  }
};

/**
 * One dialog for both resolutions of an open refund request.
 *  action 'refunded'       reference (required), date (default today), and, when the payment was never verified
 *                          (payment_evidence proof_unverified), a mandatory "I confirmed it arrived" checkbox.
 *  action 'not_applicable' reason (required) with presets; allowed during the 48 h hold.
 * `onSubmit(payload)` resolves on success (the caller closes the dialog) or throws; the message is shown inline.
 */
const RefundResolveModal = ({ refund, action, summaryText, language = 'es', t, onClose, onSubmit }) => {
  const isRefund = action === 'refunded';
  const mustConfirmArrival = isRefund && refund.payment_evidence === 'proof_unverified';
  const dialogRef = useRef(null);
  const titleRef = useRef(null);
  const returnFocusRef = useRef(null);
  const mounted = useRef(true);
  const [reference, setReference] = useState('');
  const [day, setDay] = useState(todayLocalDay());
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const titleId = 'refund-resolve-title';
  const errorId = 'refund-resolve-error';
  const account = refund.zelle_account?.account_name;
  const clamped = isRefundDateClamped(day, refund.eligible_at, new Date());

  useEffect(() => {
    mounted.current = true;
    returnFocusRef.current = document.activeElement;
    titleRef.current?.focus();
    return () => {
      mounted.current = false;
      returnFocusRef.current?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !working) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, working]);

  const trapFocus = useCallback((e) => {
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const items = [...dialogRef.current.querySelectorAll(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    if (working) return;
    let payload;
    if (isRefund) {
      const ref = reference.trim();
      if (ref.length < 1 || ref.length > MAX_REFERENCE) return setError(t(`${K}errors.invalidReference`));
      if (!day) return setError(t(`${K}errors.invalidDate`));
      if (mustConfirmArrival && !confirmed) {
        return setError(t(`${K}errors.confirmArrival`));
      }
      payload = { action, reference: ref, refundedAt: refundedAtFromDate(day, refund.eligible_at, new Date()) };
    } else {
      const text = reason.trim();
      if (text.length < 1 || text.length > MAX_REASON) return setError(t(`${K}errors.invalidReason`));
      payload = { action, reason: text };
    }
    setError('');
    setWorking(true);
    try {
      await onSubmit(payload);
    } catch (err) {
      if (mounted.current) setError(refundErrorMessage(t, err, language));
    } finally {
      if (mounted.current) setWorking(false);
    }
  };

  const field = 'mt-1 w-full min-h-[44px] rounded-lg border border-gray-300 px-3 py-2 text-sm';
  const submitKey = isRefund ? `${K}modal.refunded.submit` : `${K}modal.notApplicable.submit`;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center sm:p-4 z-50"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !working) onClose();
      }}
    >
      <form
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={working}
        onKeyDown={trapFocus}
        onSubmit={submit}
        noValidate
        className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-lg shadow-xl max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 p-4">
          <h2 id={titleId} ref={titleRef} tabIndex={-1} className="text-lg font-semibold focus:outline-none">
            {t(isRefund ? `${K}modal.refunded.title` : `${K}modal.notApplicable.title`)}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={working}
            aria-label={t(`${K}modal.cancel`)}
            className={`inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg text-gray-600 hover:bg-gray-100 ${FOCUS_RING}`}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <p className="rounded-lg bg-gray-50 p-3 text-sm font-medium text-gray-800">{summaryText}</p>

          {isRefund ? (
            <>
              <div>
                <label htmlFor="refund-reference" className="block text-sm font-medium text-gray-800">
                  {t(`${K}modal.refunded.referenceLabel`)} *
                </label>
                <input
                  id="refund-reference"
                  type="text"
                  value={reference}
                  maxLength={MAX_REFERENCE}
                  onChange={(e) => setReference(e.target.value)}
                  aria-describedby="refund-reference-help"
                  className={field}
                />
                <p id="refund-reference-help" className="mt-1 text-xs text-gray-600">{t(`${K}modal.refunded.referenceHelp`)}</p>
              </div>
              <div>
                <label htmlFor="refund-date" className="block text-sm font-medium text-gray-800">
                  {t(`${K}modal.refunded.dateLabel`)}
                </label>
                <input
                  id="refund-date"
                  type="date"
                  value={day}
                  max={todayLocalDay()}
                  min={todayLocalDay(new Date(refund.eligible_at))}
                  onChange={(e) => setDay(e.target.value)}
                  aria-describedby={clamped ? 'refund-date-clamped' : undefined}
                  className={field}
                />
                {clamped && (
                  <p id="refund-date-clamped" className="mt-1 text-xs text-amber-800">
                    {t(`${K}modal.refunded.dateClamped`, { date: new Date(refund.eligible_at).toLocaleString(language) })}
                  </p>
                )}
              </div>
              {mustConfirmArrival && (
                <label className="flex items-start gap-3 rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-900">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                    className="mt-0.5 h-5 w-5 shrink-0"
                  />
                  <span>
                    {account
                      ? t(`${K}modal.refunded.confirmArrived`, { account })
                      : t(`${K}modal.refunded.confirmArrivedNoAccount`)}
                  </span>
                </label>
              )}
            </>
          ) : (
            <div>
              <label htmlFor="refund-reason" className="block text-sm font-medium text-gray-800">
                {t(`${K}modal.notApplicable.reasonLabel`)} *
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                {PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setReason(t(`${K}modal.notApplicable.presets.${preset}`))}
                    className={`min-h-[44px] rounded-full border border-gray-300 bg-white px-3 text-sm text-gray-800 hover:bg-gray-50 ${FOCUS_RING}`}
                  >
                    {t(`${K}modal.notApplicable.presets.${preset}`)}
                  </button>
                ))}
              </div>
              <textarea
                id="refund-reason"
                rows={3}
                value={reason}
                maxLength={MAX_REASON}
                onChange={(e) => setReason(e.target.value)}
                aria-describedby="refund-reason-help"
                className={field}
              />
              <p id="refund-reason-help" className="mt-1 text-xs text-gray-600">{t(`${K}modal.notApplicable.reasonHelp`)}</p>
            </div>
          )}

          {error && (
            <p id={errorId} role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {error}
            </p>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-gray-200 p-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={working}
            className={`min-h-[44px] rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50 ${FOCUS_RING}`}
          >
            {t(`${K}modal.cancel`)}
          </button>
          <button
            type="submit"
            disabled={working}
            className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 ${FOCUS_RING}`}
          >
            {working && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {working ? t(`${K}modal.working`) : t(submitKey)}
          </button>
        </div>
      </form>
    </div>
  );
};

export default RefundResolveModal;
