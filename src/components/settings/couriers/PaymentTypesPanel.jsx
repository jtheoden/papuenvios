import React, { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAsyncResource } from '@/hooks/useAsyncResource';
import {
  listPaymentTypes, getMarginSettings, listZoneOptions, listRemittanceTypeOptions, deactivatePaymentType
} from '@/lib/courierService';
import { Btn, Notice, errorText } from './courierUi';
import PaymentTypeForm, { EMPTY_RULE_FORM } from './PaymentTypeForm';
import MarginThresholdsCard from './MarginThresholdsCard';

const ruleToForm = (r) => ({
  code: r.code, name: r.name, appliesTo: r.applies_to, method: r.method,
  fixedCup: r.fixed_cup ?? '', cupPerUsd: r.cup_per_usd ?? '', percent: r.percent ?? '', base: r.base ?? '',
  courierId: r.courier_id ?? '', zoneId: r.shipping_zone_id ?? '', typeId: r.remittance_type_id ?? '',
  amountFrom: r.amount_from ?? '', amountTo: r.amount_to ?? '', validFrom: '', validTo: ''
});

const PaymentTypesPanel = ({ couriers }) => {
  const { t } = useLanguage();
  const rules = useAsyncResource(listPaymentTypes);
  const settings = useAsyncResource(getMarginSettings);
  const [options, setOptions] = useState({ zones: [], types: [] });
  const [editor, setEditor] = useState(null); // { initial, lockedCode }
  const [showHistory, setShowHistory] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    let alive = true;
    Promise.all([listZoneOptions(), listRemittanceTypeOptions()]).then(([zones, types]) => {
      if (alive) setOptions({ zones, types });
    });
    return () => { alive = false; };
  }, []);

  const reload = useCallback(async () => { await rules.reload(); }, [rules]);
  const items = rules.data?.items ?? [];
  const now = Date.now();
  const isCurrent = (r) => r.is_active && (!r.valid_to || new Date(r.valid_to).getTime() > now);
  const visible = showHistory ? items : items.filter(isCurrent);
  const courierName = (id) => couriers.find((c) => c.id === id)?.name ?? t('couriers.types.anyCourier');
  const zoneLabel = (id) => options.zones.find((z) => z.id === id)?.label ?? t('couriers.types.anyZone');
  const typeLabel = (id) => options.types.find((x) => x.id === id)?.label ?? t('couriers.types.anyType');

  const describe = (r) => {
    const key = `couriers.types.summary.${r.method}`;
    const value = r.method === 'fixed_cup' ? r.fixed_cup : r.method === 'per_usd_delivered' ? r.cup_per_usd : r.percent;
    const base = r.base ? t(`couriers.types.bases.${r.method}.${r.base}`) : '';
    return t(key, { value: Number(value), base });
  };

  const deactivate = async (r) => {
    setMessage(null);
    try {
      await deactivatePaymentType(r.code);
      setMessage({ tone: 'ok', text: t('couriers.types.deactivated') });
      await reload();
    } catch (error) {
      setMessage({ tone: 'error', text: errorText(t, error) });
    }
  };

  if (rules.error && !rules.data) {
    return <Notice tone="error">{errorText(t, rules.error)}</Notice>;
  }

  return (
    <section className="space-y-4" aria-labelledby="types-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="types-heading" className="text-lg font-semibold">{t('couriers.types.title')}</h3>
        <Btn tone="primary" onClick={() => { setMessage(null); setEditor({ initial: { ...EMPTY_RULE_FORM }, lockedCode: false }); }}>
          {t('couriers.types.add')}
        </Btn>
      </div>
      <Notice tone="info">{t('couriers.types.intro')}</Notice>
      <Notice tone="warn">{t('couriers.types.noRuleUnknown')}</Notice>
      <div aria-live="polite">{message && <Notice tone={message.tone}>{message.text}</Notice>}</div>

      {editor && (
        <PaymentTypeForm
          key={editor.initial.code || 'new'}
          initial={editor.initial}
          lockedCode={editor.lockedCode}
          couriers={couriers}
          zones={options.zones}
          remittanceTypes={options.types}
          thresholds={settings.data?.settings?.remittance}
          onCancel={() => setEditor(null)}
          onSaved={async () => { setEditor(null); setMessage({ tone: 'ok', text: t('couriers.types.saved') }); await reload(); }}
        />
      )}

      <label className="flex min-h-[44px] items-center gap-2 text-sm">
        <input type="checkbox" className="h-5 w-5" checked={showHistory} onChange={(e) => setShowHistory(e.target.checked)} />
        {t('couriers.types.showHistory')}
      </label>

      {visible.length === 0 ? (
        <p className="text-sm text-gray-700" data-testid="types-empty">{t('couriers.types.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {visible.map((r) => (
            <li key={r.id} className="space-y-1 rounded-xl border border-gray-200 bg-white p-3" data-testid="type-row">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{r.name} <span className="text-xs font-normal text-gray-600">({r.code} v{r.version})</span></p>
                <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${isCurrent(r) ? 'border-green-500 bg-green-50 text-green-900' : 'border-gray-400 bg-gray-50 text-gray-800'}`}>
                  {isCurrent(r) ? t('couriers.common.active') : t('couriers.types.closed')}
                </span>
              </div>
              <p className="text-sm">{describe(r)}</p>
              <p className="text-xs text-gray-700">
                {t(`couriers.types.applies.${r.applies_to}`)} · {courierName(r.courier_id)} · {zoneLabel(r.shipping_zone_id)} · {typeLabel(r.remittance_type_id)}
                {(r.amount_from !== null || r.amount_to !== null) && ` · (${r.amount_from ?? '0'} - ${r.amount_to ?? '∞'}] USD`}
              </p>
              <p className="text-xs text-gray-700">
                {t('couriers.types.validFrom')}: {new Date(r.valid_from).toLocaleString()}
                {r.valid_to && ` → ${new Date(r.valid_to).toLocaleString()}`}
              </p>
              {isCurrent(r) && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <Btn onClick={() => { setMessage(null); setEditor({ initial: ruleToForm(r), lockedCode: true }); }} aria-label={`${t('couriers.types.newVersion')} ${r.name}`}>
                    {t('couriers.types.newVersion')}
                  </Btn>
                  <Btn onClick={() => deactivate(r)} aria-label={`${t('couriers.common.deactivate')} ${r.name}`}>{t('couriers.common.deactivate')}</Btn>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-gray-600">{t('couriers.types.versionNote')}</p>

      <MarginThresholdsCard settings={settings.data?.settings} onSaved={settings.reload} />
    </section>
  );
};

export default PaymentTypesPanel;
