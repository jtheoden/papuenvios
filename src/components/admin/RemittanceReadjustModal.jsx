import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from '@/components/ui/use-toast';
import { readjustRemittance } from '@/lib/remittanceService';
import { REASON_MAX_LENGTH, remittanceStatusLabelKey } from '@/lib/commissionOverrideRules';
import { REMITTANCE_STATUSES, validateReadjust, calcReadjustedDeliver } from '@/lib/remittanceReadjustRules';

const KEY = 'remittances.admin.readjust';

/**
 * Super admin modal to readjust a remittance already made: status, amount sent, rate, commission (the profit) and the
 * amount to deliver. Only the fields that differ from the stored values are sent. The server
 * (RPC superadmin_readjust_remittance) re-validates, refuses the admin's own remittances and records who and why.
 */
const RemittanceReadjustModal = ({ remittance, onClose, onSaved }) => {
  const { t } = useLanguage();
  const initial = {
    status: String(remittance.status),
    amountSent: String(remittance.amount_sent),
    exchangeRate: String(remittance.exchange_rate),
    commissionTotal: String(remittance.commission_total),
    amountToDeliver: String(remittance.amount_to_deliver)
  };
  const [form, setForm] = useState(initial);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const set = (name) => (event) => setForm((current) => ({ ...current, [name]: event.target.value }));
  const changed = (name) => form[name] !== initial[name];

  const values = {};
  if (changed('status')) values.status = form.status;
  if (changed('amountSent')) values.amountSent = Number(form.amountSent);
  if (changed('exchangeRate')) values.exchangeRate = Number(form.exchangeRate);
  if (changed('commissionTotal')) values.commissionTotal = Number(form.commissionTotal);
  if (changed('amountToDeliver')) values.amountToDeliver = Number(form.amountToDeliver);

  const errors = validateReadjust({
    reason,
    status: values.status,
    exchangeRate: values.exchangeRate,
    commission: values.commissionTotal,
    amountToDeliver: values.amountToDeliver,
    amountSent: values.amountSent
  });
  const valid = Object.keys(errors).length === 0;

  // Without an explicit amount to deliver the server recalculates it from sent, commission and rate.
  const recalculates = changed('amountSent') || changed('exchangeRate') || changed('commissionTotal');
  const previewAmount = changed('amountToDeliver')
    ? Number(form.amountToDeliver)
    : recalculates
      ? calcReadjustedDeliver({
          amountSent: Number(form.amountSent),
          commission: Number(form.commissionTotal),
          exchangeRate: Number(form.exchangeRate)
        })
      : Number(remittance.amount_to_deliver);
  const previewOk = Number.isFinite(previewAmount) && previewAmount > 0;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    try {
      const updated = await readjustRemittance(remittance.id, values, reason);
      toast({ title: t('common.success'), description: t(`${KEY}.saved`), duration: 8000 });
      onSaved(updated);
    } catch (error) {
      const message = error?.message || '';
      const description = /own_operation_not_allowed/.test(message)
        ? t(`${KEY}.errorOwnOperation`)
        : message || t(`${KEY}.saveError`);
      toast({ title: t('common.error'), description, variant: 'destructive' });
      setSaving(false);
    }
  };

  const inputClass = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-theme-focus';
  const numberField = (name, step) => (
    <div>
      <label htmlFor={`readjust-${name}`} className="block text-sm font-medium mb-1">
        {t(`${KEY}.${name}`)}
      </label>
      <input
        id={`readjust-${name}`}
        type="number"
        inputMode="decimal"
        step={step}
        value={form[name]}
        onChange={set(name)}
        aria-invalid={Boolean(errors[name === 'commissionTotal' ? 'commission' : name])}
        className={inputClass}
      />
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="remittance-readjust-title"
        className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-4 sm:p-6"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      >
        <h2 id="remittance-readjust-title" className="text-lg sm:text-xl font-bold">
          {t(`${KEY}.modalTitle`)}
        </h2>
        <p className="text-sm font-medium text-gray-500 mb-2">{remittance.remittance_number}</p>
        <p className="text-sm text-gray-600 mb-3">{t(`${KEY}.modalIntro`)}</p>

        <div role="note" className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 mb-4">
          <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <p>{t(`${KEY}.limits`)}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="readjust-status" className="block text-sm font-medium mb-1">
              {t(`${KEY}.status`)}
            </label>
            <select id="readjust-status" value={form.status} onChange={set('status')} className={inputClass}>
              {REMITTANCE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(remittanceStatusLabelKey(status))}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {numberField('amountSent', '0.01')}
            {numberField('exchangeRate', '0.0001')}
            {numberField('commissionTotal', '0.01')}
            {numberField('amountToDeliver', '0.01')}
          </div>

          <p data-testid="readjust-preview" className="text-sm font-semibold">
            {previewOk
              ? t(`${KEY}.preview`, { amount: previewAmount.toFixed(2), currency: remittance.currency_delivered })
              : t(`${KEY}.previewInvalid`)}
          </p>

          <div>
            <label htmlFor="readjust-reason" className="block text-sm font-medium mb-1">
              {t(`${KEY}.reason`)}
            </label>
            <textarea
              id="readjust-reason"
              rows={3}
              maxLength={REASON_MAX_LENGTH}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-invalid={Boolean(errors.reason)}
              className={inputClass}
            />
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-300 text-sm">
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={!valid || saving}
              className="px-4 py-2 rounded-lg bg-theme-accent text-theme-on-accent text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t(`${KEY}.confirm`)}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default RemittanceReadjustModal;
