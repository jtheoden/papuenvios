import React, { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from '@/components/ui/use-toast';
import { setRemittanceCommission } from '@/lib/remittanceService';
import { getOpenProposals } from '@/lib/commissionProposalService';
import {
  REASON_MIN_LENGTH,
  REASON_MAX_LENGTH,
  validateCommissionOverride,
  calcCommissionOverride,
} from '@/lib/commissionOverrideRules';

const KEY = 'remittances.admin.commissionOverride';

/**
 * Message after saving, from what the backend really did: only claim "the customer was notified / must accept" when a
 * proposal exists (an older backend creates none). Any failure to read it falls back to the neutral message.
 */
const savedMessageKey = async (remittanceId, commission) => {
  try {
    const rows = await getOpenProposals([remittanceId]);
    if (rows.some((p) => p.status === 'pending')) return `${KEY}.savedAwaitingCustomer`;
    if (rows.some((p) => p.status === 'informed' && Number(p.new_commission) === commission)) return `${KEY}.savedCustomerInformed`;
  } catch {
    /* neutral message below */
  }
  return `${KEY}.saved`;
};

/**
 * Admin modal to set a different final commission on a remittance awaiting payment.
 * Shows the standard commission and what the recipient would get before anything is saved.
 * The server (RPC admin_set_remittance_commission) re-validates and audits the change.
 */
const CommissionOverrideModal = ({ remittance, override = null, loading = false, onClose, onSaved }) => {
  const { t } = useLanguage();
  const amountSent = Number(remittance.amount_sent);
  const currentCommission = Number(remittance.commission_total);
  // `override` is the latest row of remittance_commission_overrides (admin-only). With one, the standard is the value
  // stored when it was set; otherwise the current commission is the standard.
  const standard = override ? Number(override.standard_commission) : currentCommission;

  const [commission, setCommission] = useState(String(currentCommission));
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const errors = validateCommissionOverride({ commission, reason, amountSent });
  const valid = Object.keys(errors).length === 0;
  const preview = errors.commission
    ? null
    : calcCommissionOverride({
        amountSent,
        exchangeRate: remittance.exchange_rate,
        commission: Number(commission),
        standardCommission: standard,
      });

  const money = (value, currency) => `${Number(value).toFixed(2)} ${currency}`;
  const sent = remittance.currency_sent;
  const delivered = remittance.currency_delivered;

  const differenceText = () => {
    if (!preview || preview.difference === 0) return t(`${KEY}.differenceNone`);
    const params = { amount: Math.abs(preview.difference).toFixed(2), currency: sent };
    return preview.difference > 0 ? t(`${KEY}.differenceHigher`, params) : t(`${KEY}.differenceLower`, params);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    try {
      const updated = await setRemittanceCommission(remittance.id, Number(commission), reason);
      toast({ title: t('common.success'), description: t(await savedMessageKey(remittance.id, Number(commission))), duration: 8000 });
      onSaved(updated);
    } catch (error) {
      const description = /invalid_status/.test(error?.message || '')
        ? t(`${KEY}.errorInvalidStatus`)
        : error?.message || t(`${KEY}.saveError`);
      toast({ title: t('common.error'), description, variant: 'destructive' });
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="commission-override-title"
        className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-4 sm:p-6"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      >
        <h2 id="commission-override-title" className="text-lg sm:text-xl font-bold">
          {t(`${KEY}.modalTitle`)}
        </h2>
        <p className="text-sm font-medium text-gray-500 mb-2">{remittance.remittance_number}</p>
        <p className="text-sm text-gray-600 mb-4">{t(`${KEY}.modalIntro`)}</p>

        <dl className="grid grid-cols-2 gap-3 text-sm mb-4">
          <div>
            <dt className="text-gray-500">{t(`${KEY}.standardCommission`)}</dt>
            <dd className="font-semibold">{money(standard, sent)}</dd>
          </div>
          <div>
            <dt className="text-gray-500">{t(`${KEY}.currentCommission`)}</dt>
            <dd className="font-semibold">{money(currentCommission, sent)}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-gray-500">{t(`${KEY}.deliverNow`)}</dt>
            <dd className="font-semibold">{money(remittance.amount_to_deliver, delivered)}</dd>
          </div>
        </dl>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="commission-override-value" className="block text-sm font-medium mb-1">
              {t(`${KEY}.newCommission`)}
            </label>
            <input
              id="commission-override-value"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              autoFocus
              value={commission}
              onChange={(e) => setCommission(e.target.value)}
              aria-invalid={Boolean(errors.commission)}
              aria-describedby={errors.commission ? 'commission-override-value-error' : undefined}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
            {errors.commission && (
              <p id="commission-override-value-error" role="alert" className="text-xs text-red-600 mt-1">
                {t(`${KEY}.errorCommissionRange`)}
              </p>
            )}
          </div>

          <div data-testid="commission-override-preview" aria-live="polite" className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
            {preview && (
              <>
                <p>
                  <span className="text-gray-500">{t(`${KEY}.deliverAfter`)}: </span>
                  <span className="font-semibold">{money(preview.amountToDeliver, delivered)}</span>
                </p>
                <p className="text-gray-700">{differenceText()}</p>
              </>
            )}
          </div>
          {preview && preview.difference > 0 && (
            <p role="status" className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
              {t(`${KEY}.higherWarning`)}
            </p>
          )}

          <div>
            <label htmlFor="commission-override-reason" className="block text-sm font-medium mb-1">
              {t(`${KEY}.reason`)}
            </label>
            <textarea
              id="commission-override-reason"
              rows={3}
              maxLength={REASON_MAX_LENGTH + 100}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-invalid={reason.length > 0 && Boolean(errors.reason)}
              aria-describedby="commission-override-reason-help"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
            <p
              id="commission-override-reason-help"
              className={`text-xs mt-1 ${reason.length > 0 && errors.reason ? 'text-red-600' : 'text-gray-500'}`}
            >
              {reason.length > 0 && errors.reason
                ? t(`${KEY}.errorReasonLength`, { min: REASON_MIN_LENGTH, max: REASON_MAX_LENGTH })
                : t(`${KEY}.reasonHelp`, { min: REASON_MIN_LENGTH, max: REASON_MAX_LENGTH })}
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm"
            >
              {t(`${KEY}.cancel`)}
            </button>
            <button
              type="submit"
              disabled={!valid || saving || loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? t(`${KEY}.saving`) : t(`${KEY}.confirm`)}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CommissionOverrideModal;
