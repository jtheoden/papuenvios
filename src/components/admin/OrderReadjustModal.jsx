import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from '@/components/ui/use-toast';
import { readjustOrder } from '@/lib/orderService';
import { REASON_MAX_LENGTH } from '@/lib/commissionOverrideRules';
import { ORDER_STATUSES, PAYMENT_STATUSES, validateOrderReadjust, calcReadjustedOrder } from '@/lib/orderReadjustRules';

const KEY = 'adminOrders.readjust';
const money = (value) => Number(value).toFixed(2);

/**
 * Super admin modal to readjust an order already made: line prices, discount, shipping, status and payment status.
 * Only the fields that differ from the stored values are sent. The server (RPC superadmin_readjust_order)
 * re-validates, refuses the admin's own orders, discounts the stock of a paid active order and records who and why.
 */
const OrderReadjustModal = ({ order, onClose, onSaved }) => {
  const { t, language } = useLanguage();
  const lines = order.order_items || [];
  const initial = {
    status: String(order.status),
    paymentStatus: String(order.payment_status),
    discountAmount: String(order.discount_amount ?? 0),
    shippingCost: String(order.shipping_cost ?? 0),
    prices: Object.fromEntries(lines.map((line) => [line.id, String(line.unit_price)]))
  };
  const [form, setForm] = useState(initial);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const set = (name) => (event) => setForm((current) => ({ ...current, [name]: event.target.value }));
  const setPrice = (id) => (event) =>
    setForm((current) => ({ ...current, prices: { ...current.prices, [id]: event.target.value } }));

  const changedLines = lines.filter((line) => form.prices[line.id] !== initial.prices[line.id]);
  const values = {};
  if (changedLines.length) values.items = changedLines.map((line) => ({ id: line.id, unitPrice: Number(form.prices[line.id]) }));
  if (form.discountAmount !== initial.discountAmount) values.discountAmount = Number(form.discountAmount);
  if (form.shippingCost !== initial.shippingCost) values.shippingCost = Number(form.shippingCost);
  if (form.status !== initial.status) values.status = form.status;
  if (form.paymentStatus !== initial.paymentStatus) values.paymentStatus = form.paymentStatus;

  const errors = validateOrderReadjust({ reason, ...values });
  const valid = Object.keys(errors).length === 0;

  const preview = calcReadjustedOrder({
    items: lines.map((line) => ({ quantity: line.quantity, unitPrice: Number(form.prices[line.id]) })),
    discountAmount: Number(form.discountAmount),
    shippingCost: Number(form.shippingCost),
    taxAmount: Number(order.tax_amount ?? 0)
  });
  const previewOk = Number.isFinite(preview.total) && preview.total > 0;
  const difference = previewOk ? preview.total - Number(order.total_amount) : 0;
  const reopening = order.status === 'cancelled' && form.status !== 'cancelled';

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    try {
      const updated = await readjustOrder(order.id, values, reason);
      toast({ title: t('common.success'), description: t(`${KEY}.saved`), duration: 8000 });
      onSaved(updated);
    } catch (error) {
      const message = error?.message || '';
      const description = /own_operation_not_allowed/.test(message)
        ? t(`${KEY}.errorOwnOperation`)
        : /stock_refused/.test(message)
          ? t(`${KEY}.errorStock`)
          : message || t(`${KEY}.saveError`);
      toast({ title: t('common.error'), description, variant: 'destructive' });
      setSaving(false);
    }
  };

  const inputClass = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-theme-focus';
  const selectField = (name, statuses) => (
    <div>
      <label htmlFor={`order-readjust-${name}`} className="block text-sm font-medium mb-1">
        {t(`${KEY}.${name}`)}
      </label>
      <select id={`order-readjust-${name}`} value={form[name]} onChange={set(name)} className={inputClass}>
        {statuses.map((status) => (
          <option key={status} value={status}>
            {t(`${KEY}.${name === 'status' ? 'statuses' : 'paymentStatuses'}.${status}`)}
          </option>
        ))}
      </select>
    </div>
  );
  const numberField = (name, label, value, onChange) => (
    <div>
      <label htmlFor={`order-readjust-${name}`} className="block text-sm font-medium mb-1">
        {label}
      </label>
      <input id={`order-readjust-${name}`} type="number" inputMode="decimal" step="0.01" min="0" value={value} onChange={onChange} className={inputClass} />
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-readjust-title"
        className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-4 sm:p-6"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      >
        <h2 id="order-readjust-title" className="text-lg sm:text-xl font-bold">{t(`${KEY}.modalTitle`)}</h2>
        <p className="text-sm font-medium text-gray-500 mb-2">{order.order_number}</p>
        <p className="text-sm text-gray-600 mb-3">{t(`${KEY}.modalIntro`)}</p>

        <div role="note" className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 mb-4">
          <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <p>{t(`${KEY}.limits`)}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {selectField('status', ORDER_STATUSES)}
            {selectField('paymentStatus', PAYMENT_STATUSES)}
          </div>

          {reopening && (
            <p data-testid="order-readjust-reopen" className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-900">
              {t(`${KEY}.reopenNote`)}
            </p>
          )}

          {lines.map((line) => {
            const name = language === 'en' ? line.item_name_en || line.item_name_es : line.item_name_es || line.item_name_en;
            return (
              <div key={line.id}>
                {numberField(`line-${line.id}`, t(`${KEY}.linePrice`, { name }), form.prices[line.id], setPrice(line.id))}
                <p className="text-xs text-gray-500 mt-1">{t(`${KEY}.lineQuantity`, { quantity: line.quantity })}</p>
              </div>
            );
          })}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {numberField('discountAmount', t(`${KEY}.discountAmount`), form.discountAmount, set('discountAmount'))}
            {numberField('shippingCost', t(`${KEY}.shippingCost`), form.shippingCost, set('shippingCost'))}
          </div>

          <p data-testid="order-readjust-preview" className="text-sm font-semibold">
            {previewOk
              ? t(`${KEY}.preview`, { total: money(preview.total), difference: `${difference > 0 ? '+' : ''}${money(difference)}` })
              : t(`${KEY}.previewInvalid`)}
          </p>

          <div>
            <label htmlFor="order-readjust-reason" className="block text-sm font-medium mb-1">{t(`${KEY}.reason`)}</label>
            <textarea
              id="order-readjust-reason"
              rows={3}
              maxLength={REASON_MAX_LENGTH}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-invalid={Boolean(errors.reason)}
              className={inputClass}
            />
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 min-h-[44px] rounded-lg border border-gray-300 text-sm">
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={!valid || saving}
              className="px-4 py-2 min-h-[44px] rounded-lg bg-theme-accent text-theme-on-accent text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t(`${KEY}.confirm`)}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default OrderReadjustModal;
