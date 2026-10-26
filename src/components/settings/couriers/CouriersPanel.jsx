import React, { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { upsertCourier } from '@/lib/courierService';
import { Btn, Field, Notice, errorText, inputCls } from './courierUi';

const EMPTY = { id: null, name: '', phone: '', notes: '', isActive: true };

const CouriersPanel = ({ couriers, onChanged }) => {
  const { t } = useLanguage();
  const [form, setForm] = useState(null); // null = closed
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null); // { tone, text }
  const [fieldError, setFieldError] = useState(null);

  const open = (courier) => {
    setMessage(null);
    setFieldError(null);
    setForm(courier ? { id: courier.id, name: courier.name, phone: courier.phone || '', notes: courier.notes || '', isActive: courier.is_active } : { ...EMPTY });
  };

  const save = async (next) => {
    if (!next.name.trim()) {
      setFieldError(t('couriers.errors.required'));
      return;
    }
    setBusy(true);
    setFieldError(null);
    try {
      await upsertCourier(next);
      setMessage({ tone: 'ok', text: t('couriers.couriers.saved') });
      setForm(null);
      await onChanged();
    } catch (error) {
      setMessage({ tone: 'error', text: errorText(t, error) });
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = (courier) =>
    save({ id: courier.id, name: courier.name, phone: courier.phone || '', notes: courier.notes || '', isActive: !courier.is_active });

  return (
    <section className="space-y-4" aria-labelledby="couriers-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="couriers-heading" className="text-lg font-semibold">{t('couriers.couriers.title')}</h3>
        <Btn tone="primary" onClick={() => open(null)}>{t('couriers.couriers.add')}</Btn>
      </div>
      <Notice tone="info">{t('couriers.couriers.intro')}</Notice>
      <div aria-live="polite">{message && <Notice tone={message.tone}>{message.text}</Notice>}</div>

      {form && (
        <form
          className="space-y-3 rounded-xl border border-gray-200 bg-white p-4"
          aria-label={t(form.id ? 'couriers.couriers.editTitle' : 'couriers.couriers.addTitle')}
          onSubmit={(e) => { e.preventDefault(); save(form); }}
        >
          <Field label={t('couriers.couriers.name')} error={fieldError}>
            {(p) => <input {...p} className={inputCls} value={form.name} maxLength={200} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
          </Field>
          <Field label={t('couriers.couriers.phone')} hint={t('couriers.couriers.phoneHint')}>
            {(p) => <input {...p} className={inputCls} value={form.phone} maxLength={50} onChange={(e) => setForm({ ...form, phone: e.target.value })} />}
          </Field>
          <Field label={t('couriers.couriers.notes')}>
            {(p) => <textarea {...p} className={`${inputCls} py-2`} rows={2} maxLength={1000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />}
          </Field>
          <div className="flex flex-wrap gap-2">
            <Btn tone="primary" type="submit" disabled={busy}>{t('couriers.common.save')}</Btn>
            <Btn onClick={() => setForm(null)} disabled={busy}>{t('couriers.common.cancel')}</Btn>
          </div>
        </form>
      )}

      {couriers.length === 0 ? (
        <p className="text-sm text-gray-700" data-testid="couriers-empty">{t('couriers.couriers.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {couriers.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white p-3">
              <div>
                <p className="font-medium">{c.name}</p>
                <p className="text-xs text-gray-600">{c.is_active ? t('couriers.common.active') : t('couriers.common.inactive')}</p>
              </div>
              <div className="flex gap-2">
                <Btn onClick={() => open(c)} aria-label={`${t('couriers.common.edit')} ${c.name}`}>{t('couriers.common.edit')}</Btn>
                <Btn onClick={() => toggleActive(c)} disabled={busy} aria-label={`${t(c.is_active ? 'couriers.common.deactivate' : 'couriers.common.activate')} ${c.name}`}>
                  {t(c.is_active ? 'couriers.common.deactivate' : 'couriers.common.activate')}
                </Btn>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default CouriersPanel;
