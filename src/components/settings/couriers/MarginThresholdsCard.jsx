import React, { useEffect, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { setMarginThresholds } from '@/lib/courierService';
import { Btn, Field, Notice, errorText, inputCls } from './courierUi';

const KINDS = ['remittance', 'order'];
const toForm = (th) => ({ targetPct: th?.targetPct ?? '', warningPct: th?.warningPct ?? '', criticalPct: th?.criticalPct ?? '' });

/** Margin thresholds the owner sets (target / warning / critical, % of the base). Empty = no alerts. */
const MarginThresholdsCard = ({ settings, onSaved }) => {
  const { t } = useLanguage();
  const [forms, setForms] = useState({ remittance: toForm(), order: toForm() });
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    if (settings) setForms({ remittance: toForm(settings.remittance), order: toForm(settings.order) });
  }, [settings]);

  const submit = async (kind) => {
    setBusy(kind);
    setMessage(null);
    try {
      await setMarginThresholds(kind, forms[kind]);
      setMessage({ tone: 'ok', text: t('couriers.thresholds.saved') });
      await onSaved?.();
    } catch (error) {
      setMessage({ tone: 'error', text: errorText(t, error) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4" aria-labelledby="thresholds-heading">
      <h4 id="thresholds-heading" className="font-semibold">{t('couriers.thresholds.title')}</h4>
      <Notice tone="info">{t('couriers.thresholds.intro')}</Notice>
      <div aria-live="polite">{message && <Notice tone={message.tone}>{message.text}</Notice>}</div>
      <div className="grid gap-4 md:grid-cols-2">
        {KINDS.map((kind) => (
          <form
            key={kind}
            aria-label={t(`couriers.thresholds.${kind}`)}
            className="space-y-2"
            onSubmit={(e) => { e.preventDefault(); submit(kind); }}
          >
            <p className="text-sm font-medium">{t(`couriers.thresholds.${kind}`)}</p>
            {['targetPct', 'warningPct', 'criticalPct'].map((field) => (
              <Field key={field} label={`${t(`couriers.thresholds.${field}`)} (%)`}>
                {(p) => (
                  <input
                    {...p} className={inputCls} inputMode="decimal" value={forms[kind][field]}
                    onChange={(e) => setForms({ ...forms, [kind]: { ...forms[kind], [field]: e.target.value } })}
                  />
                )}
              </Field>
            ))}
            <Btn tone="primary" type="submit" disabled={busy === kind}>{t('couriers.common.save')}</Btn>
          </form>
        ))}
      </div>
    </section>
  );
};

export default MarginThresholdsCard;
