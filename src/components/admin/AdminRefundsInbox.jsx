import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle, Clock, Copy, FileText, Package, Search, Send } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from '@/components/ui/use-toast';
import { resolveRefund, notifyRefundsChanged } from '@/lib/refundService';
import { PAYMENT_PROOF_BUCKET } from '@/lib/paymentProofUrl';
import { REFUND_BUSINESS_DAYS, REFUND_HOLD_HOURS } from '@/lib/legalConfig';
import {
  REFUND_FILTERS,
  buildRefundCopyText,
  countByFilter,
  filterRefunds,
  searchRefunds,
  sortRefunds,
  summarizeRefunds,
  withQueueState
} from '@/lib/refundRules';
import ImageProofModal from '@/components/ImageProofModal';
import RefundResolveModal from '@/components/admin/modals/RefundResolveModal';

const K = 'adminRefunds.';
const HOUR_MS = 3600 * 1000;
const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-600';
const BUTTON = `inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-lg text-sm font-medium transition-colors ${FOCUS_RING}`;
const TYPES = ['all', 'order', 'remittance'];

const STATE_STYLE = {
  overdue: { border: 'border-l-red-600', text: 'text-red-700 font-semibold', Icon: AlertTriangle, key: 'overdue' },
  due_soon: { border: 'border-l-amber-500', text: 'text-amber-700', Icon: Clock, key: 'dueSoon' },
  on_time: { border: 'border-l-green-600', text: 'text-gray-700', Icon: CheckCircle, key: 'onTime' },
  on_hold: { border: 'border-l-gray-400', text: 'text-gray-700', Icon: Clock, key: 'onHold' }
};

const formatMoney = (amount, currency, language) => {
  try {
    return new Intl.NumberFormat(language === 'es' ? 'es-US' : 'en-US', { style: 'currency', currency }).format(Number(amount));
  } catch {
    return `${Number(amount).toFixed(2)} ${currency}`;
  }
};

/** Duration as the biggest whole unit: "3 d", "5 h" or "20 min". */
const formatDuration = (ms, t) => {
  const abs = Math.abs(ms);
  if (abs >= 24 * HOUR_MS) return t(`${K}duration.days`, { count: Math.floor(abs / (24 * HOUR_MS)) });
  if (abs >= HOUR_MS) return t(`${K}duration.hours`, { count: Math.floor(abs / HOUR_MS) });
  return t(`${K}duration.minutes`, { count: Math.max(1, Math.floor(abs / 60000)) });
};

const copyToClipboard = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fall through to the legacy path (older browsers, blocked clipboard permission).
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return Boolean(ok);
  } catch {
    return false;
  }
};

const InboxSkeleton = ({ label }) => (
  <div aria-busy="true" className="space-y-3" data-testid="refunds-skeleton">
    <span className="sr-only" role="status">{label}</span>
    {[0, 1, 2].map((i) => (
      <div key={i} className="h-28 rounded-xl bg-gray-100 animate-pulse" />
    ))}
  </div>
);

const SummaryTile = ({ label, value }) => (
  <div className="rounded-xl border border-gray-200 bg-white p-3">
    <p className="text-xl sm:text-2xl font-semibold tabular-nums text-gray-900">{value}</p>
    <p className="text-xs text-gray-600">{label}</p>
  </div>
);

const DeadlineLabel = ({ refund, now, t, language }) => {
  const style = STATE_STYLE[refund.queueState];
  const Icon = style.Icon;
  let text;
  if (refund.queueState === 'on_hold') {
    text = t(`${K}deadline.onHold`, { date: new Date(refund.eligible_at).toLocaleString(language) });
  } else if (refund.queueState === 'overdue') {
    text = t(`${K}deadline.overdue`, { time: formatDuration(now - new Date(refund.due_at), t) });
  } else {
    const key = refund.queueState === 'due_soon' ? 'dueSoon' : 'onTime';
    text = t(`${K}deadline.${key}`, { time: formatDuration(new Date(refund.due_at) - now, t) });
  }
  return (
    <div className="space-y-0.5">
      <p className={`inline-flex items-center gap-1 text-sm ${style.text}`}>
        <Icon className="h-4 w-4" aria-hidden="true" />
        <span>{text}</span>
      </p>
      <p className="text-xs text-gray-600">
        <time dateTime={refund.due_at}>{t(`${K}deadline.dueBy`, { date: new Date(refund.due_at).toLocaleString(language) })}</time>
      </p>
    </div>
  );
};

const AdminRefundsInbox = ({
  refunds = [],
  loading = false,
  error = null,
  stale = false,
  onRetry,
  onChanged,
  liveMessage = '',
  total = null,
  now = null,
  currentUserId = null,
  isSuperAdmin = false
}) => {
  const { t, language } = useLanguage();
  const [filter, setFilter] = useState('toRefund');
  const [type, setType] = useState('all');
  const [query, setQuery] = useState('');
  const [resolveTarget, setResolveTarget] = useState(null); // { refund, action }
  const [proofTarget, setProofTarget] = useState(null);
  const [focusSummary, setFocusSummary] = useState(0);
  const summaryRef = useRef(null);

  // After a resolution the card that held the focus may be gone: move it to the summary instead of letting it fall to <body>.
  useEffect(() => {
    if (focusSummary > 0) summaryRef.current?.focus();
  }, [focusSummary]);

  const nowMs = (now || new Date()).getTime();
  const clock = useMemo(() => new Date(nowMs), [nowMs]);
  const items = useMemo(() => refunds.map((r) => withQueueState(r, clock)), [refunds, clock]);
  const summary = useMemo(() => summarizeRefunds(items), [items]);
  const counts = useMemo(() => countByFilter(items), [items]);
  const visible = useMemo(() => {
    const typed = type === 'all' ? items : items.filter((r) => r.operation_type === type);
    return sortRefunds(filterRefunds(searchRefunds(typed, query), filter));
  }, [items, type, query, filter]);

  // Separation of duties: the customer of a refund cannot resolve it (the database refuses it too). Only a super admin may, after a
  // reinforced confirmation, because he can be the sole administrator.
  const isOwn = (refund) => Boolean(currentUserId) && refund.user_id === currentUserId;
  const ownBlocked = (refund) => isOwn(refund) && !isSuperAdmin;

  const customerOf = (refund) => refund.customer_name || refund.customer_email || t(`${K}unknownCustomer`);
  const summaryText = (refund) =>
    t(`${K}modal.summary`, { amount: Number(refund.amount).toFixed(2), currency: refund.currency, customer: customerOf(refund) });

  const handleCopy = async (refund) => {
    const ok = await copyToClipboard(buildRefundCopyText(refund, { t }));
    toast(ok
      ? { title: t(`${K}actions.copied`) }
      : { title: t('common.error'), description: t(`${K}actions.copyFailed`), variant: 'destructive' });
  };

  const submitResolution = async (payload) => {
    const { refund } = resolveTarget;
    try {
      await resolveRefund({ refundId: refund.id, ...payload });
    } catch (err) {
      const reason = err?.context?.reason;
      if (reason === 'already_resolved' || reason === 'refund_not_found') {
        toast({ title: t('common.error'), description: t(`${K}states.conflict`), variant: 'destructive' });
        setResolveTarget(null);
        setFocusSummary((n) => n + 1);
        notifyRefundsChanged();
        if (onChanged) await onChanged();
        return;
      }
      throw err;
    }
    toast({
      title: t('common.success'),
      description: t(payload.action === 'refunded' ? `${K}success.refunded` : `${K}success.notApplicable`)
    });
    setResolveTarget(null);
    setFocusSummary((n) => n + 1);
    notifyRefundsChanged();
    if (onChanged) await onChanged();
  };

  const renderActions = (refund) => {
    const held = refund.queueState === 'on_hold';
    const blocked = ownBlocked(refund);
    const number = refund.operation_number;
    const holdId = `refund-hold-${refund.id}`;
    const ownId = `refund-own-${refund.id}`;
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {refund.payment_proof_url && (
          <button
            type="button"
            aria-label={t(`${K}actions.viewProofAria`, { number })}
            onClick={() => setProofTarget(refund)}
            className={`${BUTTON} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`}
          >
            <FileText className="h-4 w-4" aria-hidden="true" />
            {t(`${K}actions.viewProof`)}
          </button>
        )}
        <button
          type="button"
          aria-label={t(`${K}actions.copyAria`, { number })}
          onClick={() => handleCopy(refund)}
          className={`${BUTTON} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`}
        >
          <Copy className="h-4 w-4" aria-hidden="true" />
          {t(`${K}actions.copy`)}
        </button>
        <button
          type="button"
          aria-label={t(`${K}actions.notApplicableAria`, { number })}
          aria-disabled={blocked ? 'true' : undefined}
          aria-describedby={blocked ? ownId : undefined}
          onClick={() => {
            if (!blocked) setResolveTarget({ refund, action: 'not_applicable' });
          }}
          className={`${BUTTON} border border-gray-400 ${blocked ? 'cursor-not-allowed bg-gray-100 text-gray-600' : 'bg-white text-gray-800 hover:bg-gray-50'}`}
        >
          {t(`${K}actions.notApplicable`)}
        </button>
        <button
          type="button"
          aria-label={t(`${K}actions.markRefundedAria`, { number })}
          aria-disabled={held || blocked ? 'true' : undefined}
          aria-describedby={blocked ? ownId : held ? holdId : undefined}
          onClick={() => {
            if (!held && !blocked) setResolveTarget({ refund, action: 'refunded' });
          }}
          className={`${BUTTON} ${held || blocked ? 'cursor-not-allowed bg-gray-200 text-gray-600' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
        >
          {t(`${K}actions.markRefunded`)}
        </button>
        {blocked && (
          <p id={ownId} className="basis-full text-xs text-gray-700">{t(`${K}actions.ownBlocked`)}</p>
        )}
        {held && (
          <p id={holdId} className="basis-full text-xs text-gray-700">
            {t(`${K}actions.onHoldBlocked`, {
              date: new Date(refund.eligible_at).toLocaleString(language),
              hours: REFUND_HOLD_HOURS
            })}
          </p>
        )}
      </div>
    );
  };

  const renderResolvedLine = (refund) => {
    if (refund.status === 'refunded') {
      return t(`${K}refundedLine`, {
        date: new Date(refund.refunded_at || refund.resolved_at).toLocaleDateString(language),
        reference: refund.refund_reference
      });
    }
    if (refund.resolution_reason === 'reopened') return t(`${K}reopenedLine`);
    return t(`${K}notApplicableLine`, { reason: refund.resolution_reason });
  };

  const renderCard = (refund) => {
    const open = refund.status === 'pending';
    const OperationIcon = refund.operation_type === 'order' ? Package : Send;
    const border = open ? STATE_STYLE[refund.queueState].border : 'border-l-gray-300';
    return (
      <li
        key={refund.id}
        data-operation-number={refund.operation_number}
        className={`rounded-xl border border-gray-200 border-l-4 ${border} bg-white p-4`}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1">
            <p className="inline-flex items-center gap-1.5 text-xs font-medium uppercase text-gray-600">
              <OperationIcon className="h-4 w-4" aria-hidden="true" />
              {t(`${K}operation.${refund.operation_type}`)}
            </p>
            <p className="font-mono font-semibold text-gray-900">{refund.operation_number}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isOwn(refund) && (
              <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-900">{t(`${K}ownOperation`)}</span>
            )}
            {open && (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  refund.payment_evidence === 'proof_unverified' ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-100 text-blue-800'
                }`}
              >
                {t(`${K}level.${refund.payment_evidence}`)}
              </span>
            )}
          </div>
        </div>

        <p className="mt-2 text-2xl font-semibold tabular-nums text-gray-900">{formatMoney(refund.amount, refund.currency, language)}</p>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="text-sm">
            <p className="text-xs text-gray-600">{t(`${K}customer`)}</p>
            <p className="font-medium text-gray-900">{customerOf(refund)}</p>
            {refund.customer_email && <p className="break-all text-gray-700">{refund.customer_email}</p>}
            {refund.payer_phone && (
              <p className="text-gray-700"><span className="sr-only">{t(`${K}payerPhone`)}: </span>{refund.payer_phone}</p>
            )}
          </div>
          <div className="text-sm">
            <p className="text-xs text-gray-600">{t(`${K}zelleAccount`)}</p>
            <p className="text-gray-900">
              {refund.zelle_account ? `${refund.zelle_account.account_name || ''} ${refund.zelle_account.email || ''}`.trim() : '-'}
            </p>
            <p className="text-xs text-gray-600">{t(`${K}paymentReference`)}</p>
            <p className="break-all text-gray-900">{refund.payment_reference || '-'}</p>
          </div>
        </div>

        <p className="mt-3 text-sm text-gray-700">
          {t(`${K}cancelledOn`, {
            date: new Date(refund.cancelled_at).toLocaleString(language),
            by: t(`${K}cancelledBy.${refund.cancelled_by_role || 'system'}`)
          })}
          {refund.cancellation_reason ? ` · ${t(`${K}cancellationReason`, { reason: refund.cancellation_reason })}` : ''}
        </p>

        <div className="mt-3">
          {open ? <DeadlineLabel refund={refund} now={clock} t={t} language={language} /> : (
            <p className="text-sm font-medium text-gray-800">{renderResolvedLine(refund)}</p>
          )}
        </div>

        {open && renderActions(refund)}
      </li>
    );
  };

  const renderBody = () => {
    if (loading) return <InboxSkeleton label={t(`${K}states.loading`)} />;
    if (error) {
      return (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          <span>{t(`${K}states.error`)}</span>
          <button type="button" onClick={onRetry} className={`${BUTTON} border border-red-300 bg-white hover:bg-red-100`}>
            {t(`${K}states.retry`)}
          </button>
        </div>
      );
    }
    if (visible.length === 0) {
      let message = t(`${K}states.emptyFilter`);
      if (filter === 'toRefund' && !query && type === 'all') {
        message = summary.onHold > 0
          ? t(`${K}states.emptyOnHold`, { count: summary.onHold, hours: REFUND_HOLD_HOURS })
          : t(`${K}states.emptyPending`);
      }
      return (
        <p className="flex items-center justify-center gap-2 rounded-xl bg-gray-50 p-6 text-center text-gray-700">
          <CheckCircle className="h-5 w-5 text-green-700" aria-hidden="true" />
          {message}
        </p>
      );
    }
    return <ul className="space-y-3">{visible.map(renderCard)}</ul>;
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-700">{t(`${K}intro`, { hours: REFUND_HOLD_HOURS, days: REFUND_BUSINESS_DAYS })}</p>

      <div
        ref={summaryRef}
        tabIndex={-1}
        data-testid="refunds-summary"
        role="group"
        aria-label={t(`${K}heading`)}
        className={`grid grid-cols-3 gap-2 sm:gap-3 rounded-xl ${FOCUS_RING}`}
      >
        <SummaryTile label={t(`${K}summary.pending`)} value={summary.pending} />
        <SummaryTile label={t(`${K}summary.amountUsd`)} value={formatMoney(summary.pendingAmountUsd, 'USD', language)} />
        <SummaryTile label={t(`${K}summary.attention`)} value={`${summary.dueSoon} / ${summary.overdue}`} />
      </div>

      <div className="-mx-1 overflow-x-auto px-1">
        <div role="group" aria-label={t(`${K}filterLabel`)} className="flex w-max gap-2 pb-1">
          {REFUND_FILTERS.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
              className={`inline-flex items-center gap-2 min-h-[44px] px-3 rounded-full border text-sm font-medium whitespace-nowrap ${FOCUS_RING} ${
                filter === id ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              {t(`${K}filter.${id}`, { hours: REFUND_HOLD_HOURS })}
              <span data-count className="rounded-full bg-white/80 px-1.5 text-xs font-semibold">{counts[id]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div role="group" aria-label={t(`${K}typeLabel`)} className="inline-flex overflow-hidden rounded-lg border border-gray-300">
          {TYPES.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={type === id}
              onClick={() => setType(id)}
              className={`min-h-[44px] px-3 text-sm font-medium ${FOCUS_RING} ${type === id ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
            >
              {t(`${K}type.${id}`)}
            </button>
          ))}
        </div>
        <div className="min-w-[12rem] flex-1">
          <label htmlFor="refund-search" className="sr-only sm:not-sr-only sm:block text-xs text-gray-600">
            {t(`${K}searchLabel`)}
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" aria-hidden="true" />
            <input
              id="refund-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t(`${K}searchPlaceholder`)}
              className={`min-h-[44px] w-full rounded-lg border border-gray-300 pl-9 pr-3 text-sm ${FOCUS_RING}`}
            />
          </div>
        </div>
      </div>

      {stale && !error && (
        <p className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          {t(`${K}states.stale`)}
        </p>
      )}

      <div aria-live="polite" role="status" className="sr-only">{liveMessage}</div>

      {total !== null && total > refunds.length && (
        <p className="text-sm text-gray-700">{t(`${K}states.showing`, { shown: refunds.length, total })}</p>
      )}

      {renderBody()}

      {resolveTarget && (
        <RefundResolveModal
          refund={resolveTarget.refund}
          action={resolveTarget.action}
          summaryText={summaryText(resolveTarget.refund)}
          isOwn={isOwn(resolveTarget.refund)}
          language={language}
          t={t}
          onClose={() => setResolveTarget(null)}
          onSubmit={submitResolution}
        />
      )}

      <ImageProofModal
        isOpen={!!proofTarget}
        onClose={() => setProofTarget(null)}
        proofUrl={proofTarget?.payment_proof_url || null}
        title={t(`${K}actions.viewProof`)}
        bucketName={proofTarget?.operation_type === 'order' ? PAYMENT_PROOF_BUCKET : 'remittance-proofs'}
      />
    </div>
  );
};

export default AdminRefundsInbox;
