import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle, Clock, FileText, Loader2, Truck, XCircle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useModal } from '@/contexts/ModalContext';
import { toast } from '@/components/ui/use-toast';
import { calcTotalToPay } from '@/lib/remittanceCalculations';
import {
  REMITTANCE_WORK_GROUPS,
  TO_PROCESS_STATUSES,
  groupRemittancesByWork,
  validatePayment,
  rejectPayment,
  startProcessing,
  confirmDelivery
} from '@/lib/remittanceService';
import ImageProofModal from '@/components/ImageProofModal';

const HOUR_MS = 60 * 60 * 1000;
const AMBER_AFTER_HOURS = 24;
const RED_AFTER_HOURS = 48;
const VIEW_ALL_PATH = '/dashboard?tab=remittances';
const GROUP_ORDER = ['needs_validation', 'needs_delivery', 'awaiting_customer'];

// Built lazily so the status constants are read at render time, not at import time.
const buildFilters = () => [
  { id: 'toProcess', statuses: TO_PROCESS_STATUSES },
  { id: 'needsValidation', statuses: REMITTANCE_WORK_GROUPS.needs_validation },
  { id: 'needsDelivery', statuses: REMITTANCE_WORK_GROUPS.needs_delivery },
  { id: 'awaitingCustomer', statuses: REMITTANCE_WORK_GROUPS.awaiting_customer },
  { id: 'all', statuses: GROUP_ORDER.flatMap((group) => REMITTANCE_WORK_GROUPS[group]) }
];

const STATUS_LABEL_KEYS = {
  payment_pending: 'paymentPending',
  payment_proof_uploaded: 'paymentProofUploaded',
  payment_validated: 'paymentValidated',
  processing: 'processing'
};

const STATUS_BADGE_CLASSES = {
  payment_pending: 'bg-gray-100 text-gray-700',
  payment_proof_uploaded: 'bg-yellow-100 text-yellow-800',
  payment_validated: 'bg-blue-100 text-blue-800',
  processing: 'bg-purple-100 text-purple-800'
};

const getAgeLevel = (createdAt) => {
  const hours = Math.max(0, (Date.now() - new Date(createdAt).getTime()) / HOUR_MS);
  if (hours > RED_AFTER_HOURS) return 'overdue';
  if (hours > AMBER_AFTER_HOURS) return 'warning';
  return 'ok';
};

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-600';

const AGE_CLASSES = {
  ok: 'text-gray-600',
  warning: 'text-amber-700',
  overdue: 'text-red-700 font-semibold'
};

const sortForInbox = (remittances) => {
  const grouped = groupRemittancesByWork(remittances);
  return GROUP_ORDER.flatMap((group) =>
    [...grouped[group]].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  );
};

const AgeLabel = ({ createdAt, t }) => {
  const elapsed = Math.max(0, Date.now() - new Date(createdAt).getTime());
  const hours = elapsed / HOUR_MS;
  let text;
  if (hours < 1) text = t('adminInbox.age.minutes', { count: Math.floor(elapsed / 60000) });
  else if (hours < AMBER_AFTER_HOURS) text = t('adminInbox.age.hours', { count: Math.floor(hours) });
  else text = t('adminInbox.age.days', { count: Math.floor(hours / 24) });

  const level = getAgeLevel(createdAt);
  return (
    <span className={`inline-flex items-center gap-1 text-sm ${AGE_CLASSES[level]}`}>
      {level === 'warning' && <Clock className="h-4 w-4" aria-hidden="true" />}
      {level === 'overdue' && <AlertTriangle className="h-4 w-4" aria-hidden="true" />}
      <time dateTime={createdAt} title={new Date(createdAt).toLocaleString()}>{text}</time>
      {level === 'overdue' && <span>{t('adminInbox.age.overdue')}</span>}
    </span>
  );
};

const InboxSkeleton = ({ label }) => (
  <div aria-busy="true" className="space-y-3" data-testid="inbox-skeleton">
    <span className="sr-only" role="status">{label}</span>
    {[0, 1, 2].map((i) => (
      <div key={i} className="h-24 rounded-xl bg-gray-100 animate-pulse" />
    ))}
  </div>
);

const AdminRemittancesInbox = ({
  remittances = [],
  loading = false,
  error = null,
  stale = false,
  onRetry,
  onChanged,
  onNavigate,
  liveMessage = ''
}) => {
  const { t } = useLanguage();
  const { showModal } = useModal();
  const [filter, setFilter] = useState('toProcess');
  const [busyId, setBusyId] = useState(null);
  const [proofUrl, setProofUrl] = useState(null);

  const filters = useMemo(buildFilters, []);
  const sorted = useMemo(() => sortForInbox(remittances), [remittances]);
  const counts = useMemo(
    () => Object.fromEntries(filters.map((f) => [f.id, sorted.filter((r) => f.statuses.includes(r.status)).length])),
    [filters, sorted]
  );
  const activeFilter = filters.find((f) => f.id === filter) || filters[0];
  const visible = useMemo(
    () => sorted.filter((r) => activeFilter.statuses.includes(r.status)),
    [sorted, activeFilter]
  );

  const runAction = async (remittance, action, successKey, failureKey) => {
    setBusyId(remittance.id);
    try {
      await action();
      toast({ title: t('common.success'), description: t(successKey) });
      if (onChanged) await onChanged();
    } catch (err) {
      toast({
        title: t('common.error'),
        description: err?.message || t(failureKey),
        variant: 'destructive'
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleValidate = async (remittance) => {
    const notes = await showModal({
      title: t('remittances.admin.validate'),
      message: t('remittances.admin.confirmValidateMessage', {
        amount: calcTotalToPay({ amountSent: remittance.amount_sent, deliveryCost: remittance.delivery_cost }),
        currency: remittance.currency_sent
      }),
      input: true,
      inputLabel: t('remittances.admin.validationNotes'),
      inputPlaceholder: t('remittances.admin.validationNotesPlaceholder'),
      confirmText: t('remittances.admin.validate'),
      cancelText: t('common.cancel'),
      type: 'success'
    });
    if (notes === false) return;
    await runAction(
      remittance,
      () => validatePayment(remittance.id, notes || ''),
      'remittances.admin.paymentValidated',
      'remittances.admin.paymentValidationFailed'
    );
  };

  const handleReject = async (remittance) => {
    const reason = await showModal({
      title: t('remittances.admin.reject'),
      message: t('remittances.admin.confirmRejectMessage', { number: remittance.remittance_number }),
      input: true,
      inputLabel: `${t('remittances.admin.rejectReason')} *`,
      inputPlaceholder: t('remittances.admin.rejectReasonPlaceholder'),
      confirmText: t('remittances.admin.reject'),
      cancelText: t('common.cancel'),
      type: 'danger',
      required: true
    });
    if (!reason) return;
    await runAction(
      remittance,
      () => rejectPayment(remittance.id, reason),
      'remittances.admin.paymentRejected',
      'remittances.admin.paymentRejectionFailed'
    );
  };

  const handleStartProcessing = async (remittance) => {
    const confirmed = await showModal({
      title: t('remittances.admin.process'),
      message: t('remittances.admin.confirmProcessMessage', { number: remittance.remittance_number }),
      confirmText: t('remittances.admin.process'),
      cancelText: t('common.cancel')
    });
    if (!confirmed) return;
    await runAction(
      remittance,
      () => startProcessing(remittance.id, ''),
      'remittances.admin.processingStarted',
      'remittances.admin.processingFailed'
    );
  };

  const handleConfirmDelivery = async (remittance) => {
    // Same rule as the full remittances tab: delivery proof must already exist.
    if (!remittance.delivery_proof_url || remittance.delivery_proof_url.trim() === '') {
      toast({
        title: t('common.error'),
        description: t('remittances.admin.deliveryProofRequired'),
        variant: 'destructive'
      });
      return;
    }
    const notes = await showModal({
      title: t('remittances.admin.confirmDelivery'),
      message: t('remittances.admin.confirmDeliveryMessage', {
        amount: remittance.amount_to_deliver,
        currency: remittance.currency_delivered,
        recipient: remittance.recipient_name
      }),
      input: true,
      inputLabel: t('remittances.admin.deliveryNotes'),
      inputPlaceholder: t('remittances.admin.deliveryNotesPlaceholder'),
      confirmText: t('remittances.admin.confirmDelivery'),
      cancelText: t('common.cancel'),
      type: 'success'
    });
    if (notes === false) return;
    await runAction(
      remittance,
      () => confirmDelivery(remittance.id, null, notes || ''),
      'remittances.admin.deliveryConfirmed',
      'remittances.admin.deliveryConfirmationFailed'
    );
  };

  const handleViewAll = (event) => {
    event.preventDefault();
    if (onNavigate) onNavigate('dashboard');
    window.history.replaceState({ path: VIEW_ALL_PATH }, '', VIEW_ALL_PATH);
  };

  const renderActions = (remittance) => {
    const disabled = busyId === remittance.id;
    const base = `inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${FOCUS_RING}`;

    if (remittance.status === 'payment_proof_uploaded') {
      return (
        <>
          <button
            type="button"
            disabled={disabled}
            onClick={() => handleValidate(remittance)}
            className={`${base} bg-green-700 hover:bg-green-800 text-white`}
          >
            <CheckCircle className="h-4 w-4" aria-hidden="true" />
            {t('adminInbox.validate')}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => handleReject(remittance)}
            className={`${base} border border-red-300 text-red-700 hover:bg-red-50 bg-white`}
          >
            <XCircle className="h-4 w-4" aria-hidden="true" />
            {t('adminInbox.reject')}
          </button>
        </>
      );
    }
    if (remittance.status === 'payment_validated') {
      return (
        <button
          type="button"
          disabled={disabled}
          onClick={() => handleStartProcessing(remittance)}
          className={`${base} bg-blue-600 hover:bg-blue-700 text-white`}
        >
          <Truck className="h-4 w-4" aria-hidden="true" />
          {t('adminInbox.startProcessing')}
        </button>
      );
    }
    if (remittance.status === 'processing') {
      const hasDeliveryProof = !!remittance.delivery_proof_url && remittance.delivery_proof_url.trim() !== '';
      return (
        <>
        <button
          type="button"
          disabled={disabled || !hasDeliveryProof}
          onClick={() => handleConfirmDelivery(remittance)}
          className={`${base} bg-green-700 hover:bg-green-800 text-white`}
        >
          <CheckCircle className="h-4 w-4" aria-hidden="true" />
          {t('adminInbox.confirmDelivery')}
        </button>
        {!hasDeliveryProof && (
          <p className="basis-full text-sm text-gray-700">
            {t('adminInbox.deliveryProofMissing')}{' '}
            <a
              href={VIEW_ALL_PATH}
              onClick={handleViewAll}
              className={`rounded font-medium text-blue-700 underline ${FOCUS_RING}`}
            >
              {t('adminInbox.openFullTab')}
            </a>
          </p>
        )}
        </>
      );
    }
    return null;
  };

  const renderBody = () => {
    if (loading) return <InboxSkeleton label={t('adminInbox.loading')} />;

    if (error) {
      return (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          <span>{t('adminInbox.error')}</span>
          <button
            type="button"
            onClick={onRetry}
            className={`min-h-[40px] px-3 rounded-lg border border-red-300 bg-white text-sm font-medium hover:bg-red-100 ${FOCUS_RING}`}
          >
            {t('adminInbox.retry')}
          </button>
        </div>
      );
    }

    if (visible.length === 0) {
      return (
        <p className="rounded-xl bg-gray-50 p-6 text-center text-gray-600">
          {filter === 'toProcess' ? t('adminInbox.emptyToProcess') : t('adminInbox.emptyFilter')}
        </p>
      );
    }

    return (
      <ul className="space-y-3">
        {visible.map((remittance) => (
          <li
            key={remittance.id}
            data-remittance-number={remittance.remittance_number}
            className="rounded-xl border border-gray-200 p-4 bg-white"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{remittance.remittance_number}</p>
                <p className="text-xs text-gray-500">{t('adminInbox.col.sender')}</p>
                <p className="text-sm">{remittance.sender_name || remittance.sender_email || t('adminInbox.unknownSender')}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {remittance.payment_method && (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                    {remittance.payment_method}
                  </span>
                )}
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASSES[remittance.status] || 'bg-gray-100 text-gray-700'}`}>
                  {t(`remittances.status.${STATUS_LABEL_KEYS[remittance.status] || 'paymentPending'}`)}
                </span>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <p className="text-xs text-gray-500">{t('adminInbox.col.recipient')}</p>
                <p className="text-sm">{remittance.recipient_name}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">{t('adminInbox.col.amount')}</p>
                <p className="text-sm font-semibold">{remittance.amount_sent} {remittance.currency_sent}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">{t('adminInbox.col.age')}</p>
                <AgeLabel createdAt={remittance.created_at} t={t} />
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {remittance.payment_proof_url && (
                <button
                  type="button"
                  aria-label={t('adminInbox.viewProofAria', { number: remittance.remittance_number })}
                  onClick={() => setProofUrl(remittance.payment_proof_url)}
                  className={`inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3 rounded-lg border border-gray-300 bg-white text-sm font-medium hover:bg-gray-50 ${FOCUS_RING}`}
                >
                  <FileText className="h-4 w-4" aria-hidden="true" />
                  {t('adminInbox.viewProof')}
                </button>
              )}
              {renderActions(remittance)}
            </div>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="space-y-4">
      <div role="group" aria-label={t('adminInbox.filterLabel')} className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={`inline-flex items-center gap-2 min-h-[40px] px-3 rounded-full border text-sm font-medium ${FOCUS_RING} ${
              filter === f.id ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            {t(`adminInbox.filter.${f.id}`)}
            <span className="rounded-full bg-white/80 px-1.5 text-xs font-semibold">{counts[f.id]}</span>
          </button>
        ))}
      </div>

      {stale && !error && (
        <p className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          {t('adminInbox.staleWarning')}
        </p>
      )}

      <div aria-live="polite" role="status" className="sr-only">
        {liveMessage}
      </div>

      {renderBody()}

      <div className="flex items-center justify-between">
        <a
          href={VIEW_ALL_PATH}
          onClick={handleViewAll}
          className={`rounded text-sm font-medium text-blue-700 underline hover:text-blue-900 ${FOCUS_RING}`}
        >
          {t('adminInbox.viewAll')}
        </a>
        {busyId && <Loader2 className="h-4 w-4 animate-spin text-gray-500" aria-hidden="true" />}
      </div>

      <ImageProofModal
        isOpen={!!proofUrl}
        onClose={() => setProofUrl(null)}
        proofUrl={proofUrl}
        title={t('remittances.user.paymentProof')}
        bucketName="remittance-proofs"
      />
    </div>
  );
};

export default AdminRemittancesInbox;
