import React, { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { getCourierReport } from '@/lib/courierService';
import { buildReportCsv } from '@/lib/courierRules';
import { Btn, Field, Notice, errorText, inputCls, formatCup, formatUsd } from './courierUi';

const COLS = [
  ['remittance_deliveries', 'plain'], ['order_deliveries', 'plain'], ['remittance_amount_sent_usd', 'usd'], ['accrued_cup', 'cup'],
  ['accrued_usd', 'usd'], ['paid_cup', 'cup'], ['pending_cup', 'cup'], ['voided_cup', 'cup'], ['voided_after_payment_cup', 'cup'],
  ['unknown_amount_count', 'plain'], ['margin_warning_count', 'plain'], ['margin_critical_count', 'plain'], ['margin_unknown_count', 'plain']
];
const fmt = { plain: (v) => String(v ?? 0), cup: formatCup, usd: formatUsd };

const downloadCsv = (text) => {
  const url = URL.createObjectURL(new Blob([`﻿${text}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'courier-report.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); // revoking right after click can cancel the download in some browsers
};

const ReportsPanel = ({ couriers }) => {
  const { t } = useLanguage();
  const [filters, setFilters] = useState({ from: '', to: '', courierId: '' });
  const [state, setState] = useState({ status: 'idle', rows: [], available: true });

  const run = async (e) => {
    e.preventDefault();
    setState({ status: 'loading', rows: [], available: true });
    try {
      const res = await getCourierReport({
        from: filters.from ? new Date(`${filters.from}T00:00:00`).toISOString() : null,
        // the upper bound is exclusive: the whole selected day is included
        to: filters.to ? new Date(new Date(`${filters.to}T00:00:00`).getTime() + 86_400_000).toISOString() : null,
        courierId: filters.courierId || null
      });
      setState({ status: 'ok', rows: res.rows, available: res.available });
    } catch (error) {
      setState({ status: 'error', rows: [], available: true, error });
    }
  };

  const labels = { courier: t('couriers.reports.courier'), unassigned: t('couriers.common.unassigned') };
  COLS.forEach(([key]) => { labels[key] = t(`couriers.reports.cols.${key}`); });

  return (
    <section className="space-y-4" aria-labelledby="reports-heading">
      <h3 id="reports-heading" className="text-lg font-semibold">{t('couriers.reports.title')}</h3>
      <form className="grid gap-3 sm:grid-cols-4" onSubmit={run} aria-label={t('couriers.reports.title')}>
        <Field label={t('couriers.reports.from')}>
          {(p) => <input {...p} type="date" className={inputCls} value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />}
        </Field>
        <Field label={t('couriers.reports.to')}>
          {(p) => <input {...p} type="date" className={inputCls} value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />}
        </Field>
        <Field label={t('couriers.reports.courier')}>
          {(p) => (
            <select {...p} className={inputCls} value={filters.courierId} onChange={(e) => setFilters({ ...filters, courierId: e.target.value })}>
              <option value="">{t('couriers.reports.allCouriers')}</option>
              {couriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </Field>
        <div className="flex items-end">
          <Btn tone="primary" type="submit" className="w-full">{t('couriers.reports.run')}</Btn>
        </div>
      </form>
      <Notice tone="info">{t('couriers.reports.note')}</Notice>

      <div aria-live="polite">
        {state.status === 'loading' && <p className="text-sm">{t('couriers.loading')}</p>}
        {state.status === 'error' && <Notice tone="error">{errorText(t, state.error)}</Notice>}
        {state.status === 'ok' && !state.available && <Notice tone="info">{t('couriers.unavailable')}</Notice>}
        {state.status === 'ok' && state.available && state.rows.length === 0 && <p className="text-sm" data-testid="report-empty">{t('couriers.reports.empty')}</p>}
      </div>

      {state.status === 'ok' && state.rows.length > 0 && (
        <>
          <Btn onClick={() => downloadCsv(buildReportCsv(state.rows, labels))}>{t('couriers.reports.exportCsv')}</Btn>
          <ul className="space-y-3">
            {state.rows.map((row) => (
              <li key={row.courier_id ?? 'none'} className="rounded-xl border border-gray-200 bg-white p-3" data-testid="report-row">
                <h4 className="font-semibold">{row.courier_name ?? t('couriers.common.unassigned')}</h4>
                <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
                  {COLS.map(([key, kind]) => (
                    <div key={key} className="flex justify-between gap-2 border-b border-gray-100 py-1">
                      <dt className="text-gray-700">{t(`couriers.reports.cols.${key}`)}</dt>
                      <dd className="font-medium">{fmt[kind](row[key])}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
};

export default ReportsPanel;
