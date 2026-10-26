import React, { useCallback, useMemo, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { useAsyncResource } from '@/hooks/useAsyncResource';
import {
  listAccruals, registerPayment, voidAccrual, adjustAccrual, recalculateAccrual, listDeliveriesWithoutAccrual, backfillMissingAccruals
} from '@/lib/courierService';
import { shortId } from '@/lib/courierRules';
import { Btn, Field, Notice, errorText, inputCls, formatCup } from './courierUi';

const pad = (n) => String(n).padStart(2, '0');
const nowLocalInput = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const PayablePanel = ({ couriers }) => {
  const { t } = useLanguage();
  const { isSuperAdmin } = useAuth();
  const pending = useAsyncResource(useCallback(() => listAccruals({ status: 'calculated' }), []));
  const paid = useAsyncResource(useCallback(() => listAccruals({ status: 'paid', limit: 50 }), []));
  const [selected, setSelected] = useState(() => new Set());
  const [pay, setPay] = useState(null); // { courierId, ids, method, reference, paidAt, notes }
  const [action, setAction] = useState(null); // { kind: 'void'|'adjust', id, reason, amount }
  const [gaps, setGaps] = useState(null); // { from, items }
  const [gapFrom, setGapFrom] = useState('');
  const [confirmBackfill, setConfirmBackfill] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const courierName = (id) => couriers.find((c) => c.id === id)?.name ?? t('couriers.common.unassigned');
  const items = pending.data?.items ?? [];
  const groups = useMemo(() => {
    const map = new Map();
    items.forEach((a) => {
      const key = a.courier_id ?? 'none';
      if (!map.has(key)) map.set(key, { courierId: a.courier_id, rows: [] });
      map.get(key).rows.push(a);
    });
    return [...map.values()];
  }, [items]);

  const run = async (fn, okKey) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      setMessage({ tone: 'ok', text: t(okKey) });
      await Promise.all([pending.reload(), paid.reload()]);
      return true;
    } catch (error) {
      setMessage({ tone: 'error', text: errorText(t, error) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const openPay = (group) => {
    const ids = group.rows.filter((a) => selected.has(a.id)).map((a) => a.id);
    if (ids.length === 0) return;
    setPay({ courierId: group.courierId, ids, method: '', reference: '', paidAt: nowLocalInput(), notes: '' });
  };

  const submitPay = async (e) => {
    e.preventDefault();
    const ok = await run(() => registerPayment({
      courierId: pay.courierId, accrualIds: pay.ids, method: pay.method, reference: pay.reference,
      paidAt: pay.paidAt ? new Date(pay.paidAt).toISOString() : null, notes: pay.notes
    }), 'couriers.payable.paidOk');
    if (ok) { setPay(null); setSelected(new Set()); }
  };

  const submitAction = async (e) => {
    e.preventDefault();
    const ok = await run(
      () => (action.kind === 'void' ? voidAccrual(action.id, action.reason) : adjustAccrual(action.id, action.amount, action.reason)),
      action.kind === 'void' ? 'couriers.payable.voidedOk' : 'couriers.payable.adjustedOk'
    );
    if (ok) setAction(null);
  };

  const reviewGaps = async () => {
    setMessage(null);
    setConfirmBackfill(false);
    try {
      const from = gapFrom ? new Date(gapFrom).toISOString() : null;
      const res = await listDeliveriesWithoutAccrual({ from });
      setGaps({ from, available: res.available, items: res.items });
    } catch (error) {
      setMessage({ tone: 'error', text: errorText(t, error) });
    }
  };

  const doBackfill = async () => {
    const ok = await run(() => backfillMissingAccruals(gaps.from), 'couriers.payable.backfillOk');
    if (ok) { setGaps(null); setConfirmBackfill(false); }
  };

  const superOnlyReason = t('couriers.payable.superAdminOnlyReason');

  if (pending.error && !pending.data) return <Notice tone="error">{errorText(t, pending.error)}</Notice>;

  return (
    <section className="space-y-5" aria-labelledby="payable-heading">
      <h3 id="payable-heading" className="text-lg font-semibold">{t('couriers.payable.title')}</h3>
      <div aria-live="polite">{message && <Notice tone={message.tone}>{message.text}</Notice>}</div>

      {groups.length === 0 && <p className="text-sm text-gray-700" data-testid="payable-empty">{t('couriers.payable.empty')}</p>}

      {groups.map((group) => {
        const known = group.rows.filter((a) => a.amount_cup !== null);
        const unknown = group.rows.filter((a) => a.amount_cup === null);
        const chosen = known.filter((a) => selected.has(a.id));
        const total = chosen.reduce((sum, a) => sum + Number(a.amount_cup), 0);
        return (
          <div key={group.courierId ?? 'none'} className="space-y-2 rounded-xl border border-gray-200 bg-white p-3" data-testid="payable-group">
            <h4 className="font-semibold">{courierName(group.courierId)}</h4>
            <ul className="space-y-1">
              {known.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 text-sm">
                  <label className="flex min-h-[44px] items-center gap-2">
                    <input type="checkbox" className="h-5 w-5" checked={selected.has(a.id)} onChange={() => toggle(a.id)} />
                    <span>{new Date(a.delivered_at).toLocaleDateString()} · {t(`couriers.common.kind.${a.source_kind}`)} {a.component === 'adjustment' ? `(${t('couriers.payable.adjustment')})` : ''} · <strong>{formatCup(a.amount_cup)}</strong></span>
                  </label>
                  <Btn onClick={() => setAction({ kind: 'void', id: a.id, reason: '', amount: '' })} aria-label={`${t('couriers.payable.void')} ${shortId(a.id)}`}>{t('couriers.payable.void')}</Btn>
                </li>
              ))}
            </ul>
            {unknown.length > 0 && (
              <div className="space-y-1" data-testid="payable-unknown">
                <Notice tone="warn">{t('couriers.payable.unknownAmounts', { count: unknown.length })}</Notice>
                <ul className="space-y-1">
                  {unknown.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center gap-3 text-sm">
                      <span>{new Date(a.delivered_at).toLocaleDateString()} · {t(`couriers.common.kind.${a.source_kind}`)} · {t('couriers.common.unknown')}</span>
                      <Btn disabled={busy} onClick={() => run(() => recalculateAccrual(a.id), 'couriers.payable.recalculatedOk')} aria-label={`${t('couriers.payable.recalculate')} ${shortId(a.id)}`}>
                        {t('couriers.payable.recalculate')}
                      </Btn>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-gray-600">{t('couriers.payable.recalcWarning')}</p>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm" aria-live="polite">{t('couriers.payable.selectedTotal')}: <strong>{formatCup(total)}</strong></p>
              <Btn tone="primary" disabled={chosen.length === 0 || busy} onClick={() => openPay(group)}>{t('couriers.payable.markPaid')}</Btn>
            </div>
          </div>
        );
      })}

      {pay && (
        <form className="space-y-3 rounded-xl border-2 border-blue-300 bg-white p-4" aria-label={t('couriers.payable.markPaid')} onSubmit={submitPay}>
          <p className="text-sm">{t('couriers.payable.payIntro', { count: pay.ids.length })}</p>
          <Field label={t('couriers.payable.method')}>
            {(p) => <input {...p} className={inputCls} required maxLength={50} value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })} />}
          </Field>
          <Field label={t('couriers.payable.reference')}>
            {(p) => <input {...p} className={inputCls} maxLength={200} value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} />}
          </Field>
          <Field label={t('couriers.payable.paidAt')}>
            {(p) => <input {...p} type="datetime-local" className={inputCls} value={pay.paidAt} onChange={(e) => setPay({ ...pay, paidAt: e.target.value })} />}
          </Field>
          <div className="flex gap-2">
            <Btn tone="primary" type="submit" disabled={busy || !pay.method.trim()}>{t('couriers.payable.confirmPay')}</Btn>
            <Btn onClick={() => setPay(null)} disabled={busy}>{t('couriers.common.cancel')}</Btn>
          </div>
        </form>
      )}

      {action && (
        <form className="space-y-3 rounded-xl border-2 border-amber-300 bg-white p-4" aria-label={t(`couriers.payable.${action.kind}`)} onSubmit={submitAction}>
          {action.kind === 'adjust' && (
            <Field label={t('couriers.payable.adjustAmount')} hint={t('couriers.payable.adjustHint')}>
              {(p) => <input {...p} className={inputCls} inputMode="decimal" value={action.amount} onChange={(e) => setAction({ ...action, amount: e.target.value })} />}
            </Field>
          )}
          <Field label={t('couriers.payable.reason')} hint={t('couriers.payable.reasonHint')}>
            {(p) => <textarea {...p} className={`${inputCls} py-2`} rows={2} minLength={10} maxLength={500} value={action.reason} onChange={(e) => setAction({ ...action, reason: e.target.value })} />}
          </Field>
          <div className="flex gap-2">
            <Btn tone="danger" type="submit" disabled={busy || action.reason.trim().length < 10}>{t(`couriers.payable.${action.kind}`)}</Btn>
            <Btn onClick={() => setAction(null)} disabled={busy}>{t('couriers.common.cancel')}</Btn>
          </div>
        </form>
      )}

      <div className="space-y-2 rounded-xl border border-gray-200 bg-white p-3">
        <h4 className="font-semibold">{t('couriers.payable.paidTitle')}</h4>
        {!isSuperAdmin && <Notice tone="info">{superOnlyReason}</Notice>}
        {(paid.data?.items ?? []).length === 0 ? (
          <p className="text-sm text-gray-700">{t('couriers.payable.paidEmpty')}</p>
        ) : (
          <ul className="space-y-1">
            {paid.data.items.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 text-sm">
                <span>{new Date(a.delivered_at).toLocaleDateString()} · {courierName(a.courier_id)} · <strong>{formatCup(a.amount_cup)}</strong></span>
                {a.component === 'delivery' && (
                  <>
                    <Btn disabled={!isSuperAdmin || busy} title={isSuperAdmin ? undefined : superOnlyReason} onClick={() => setAction({ kind: 'adjust', id: a.id, reason: '', amount: '' })} aria-label={`${t('couriers.payable.adjust')} ${shortId(a.id)}`}>{t('couriers.payable.adjust')}</Btn>
                    <Btn disabled={!isSuperAdmin || busy} title={isSuperAdmin ? undefined : superOnlyReason} onClick={() => setAction({ kind: 'void', id: a.id, reason: '', amount: '' })} aria-label={`${t('couriers.payable.void')} ${shortId(a.id)}`}>{t('couriers.payable.void')}</Btn>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2 rounded-xl border border-gray-200 bg-white p-3">
        <h4 className="font-semibold">{t('couriers.payable.gapsTitle')}</h4>
        <p className="text-sm text-gray-700">{t('couriers.payable.gapsIntro')}</p>
        <Field label={t('couriers.payable.gapsFrom')} hint={t('couriers.payable.gapsFromHint')}>
          {(p) => <input {...p} type="date" className={inputCls} value={gapFrom} onChange={(e) => setGapFrom(e.target.value)} />}
        </Field>
        <Btn onClick={reviewGaps} disabled={!gapFrom || busy}>{t('couriers.payable.gapsReview')}</Btn>
        {gaps && (
          <div className="space-y-2" aria-live="polite" data-testid="gaps-result">
            {!gaps.available ? (
              <p className="text-sm">{t('couriers.unavailable')}</p>
            ) : gaps.items.length === 0 ? (
              <p className="text-sm">{t('couriers.payable.gapsNone')}</p>
            ) : (
              <>
                <p className="text-sm">{t('couriers.payable.gapsCount', { count: gaps.items.length })}</p>
                {!confirmBackfill ? (
                  <>
                    <Btn disabled={!isSuperAdmin} onClick={() => setConfirmBackfill(true)}>{t('couriers.payable.backfill')}</Btn>
                    {!isSuperAdmin && <p className="text-xs text-gray-700">{t('couriers.payable.backfillSuperOnly')}</p>}
                  </>
                ) : (
                  <div role="alertdialog" aria-label={t('couriers.payable.backfill')} className="space-y-2 rounded-lg border-2 border-amber-400 bg-amber-50 p-3">
                    <p className="text-sm font-medium">{t('couriers.payable.backfillConfirm', { count: gaps.items.length })}</p>
                    <p className="text-sm">{t('couriers.payable.recalcWarning')}</p>
                    <div className="flex gap-2">
                      <Btn tone="primary" onClick={doBackfill} disabled={busy}>{t('couriers.payable.backfillYes')}</Btn>
                      <Btn onClick={() => setConfirmBackfill(false)} disabled={busy}>{t('couriers.common.cancel')}</Btn>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
};

export default PayablePanel;
