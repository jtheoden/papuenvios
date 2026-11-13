import React, { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from '@/components/ui/use-toast';
import { addFinancialEntry, voidFinancialEntry } from '@/lib/financialEntriesService';
import { validateFinancialEntry, ENTRY_KINDS, businessToday } from '@/lib/financialEntryRules';

const KEY = 'financialEntries';
const todayIso = () => businessToday();
const emptyForm = () => ({ kind: 'expense', amount: '', entryDate: todayIso(), category: '', reason: '' });
const inputClass = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-theme-focus';

/**
 * Super admin panel: record incomes/expenses that add to or subtract from the dashboard net income, and void a wrong
 * one with a counter-entry. `entries` come from the dashboard (it also needs them for the net); `onChanged` reloads them.
 */
const FinancialEntriesPanel = ({ entries, onChanged }) => {
  const { t } = useLanguage();
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [voiding, setVoiding] = useState(null); // { id, reason }

  const set = (name) => (event) => setForm((current) => ({ ...current, [name]: event.target.value }));
  const valid = Object.keys(validateFinancialEntry(form, todayIso())).length === 0;

  const voidedIds = new Set(entries.filter((entry) => entry.voids_entry_id).map((entry) => entry.voids_entry_id));
  const canVoid = (entry) => !entry.voids_entry_id && !voidedIds.has(entry.id);

  const fail = (error) =>
    toast({ title: t('common.error'), description: error?.message || t(`${KEY}.saveError`), variant: 'destructive' });

  const handleAdd = async (event) => {
    event.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    try {
      await addFinancialEntry(form);
      toast({ title: t('common.success'), description: t(`${KEY}.saved`) });
      setForm(emptyForm());
      onChanged();
    } catch (error) {
      fail(error);
    } finally {
      setSaving(false);
    }
  };

  const handleVoid = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await voidFinancialEntry(voiding.id, voiding.reason);
      toast({ title: t('common.success'), description: t(`${KEY}.voided`) });
      setVoiding(null);
      onChanged();
    } catch (error) {
      fail(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="glass-effect rounded-2xl p-4 sm:p-6 mb-6" aria-labelledby="financial-entries-title">
      <h3 id="financial-entries-title" className="text-lg font-semibold">{t(`${KEY}.title`)}</h3>
      <p className="text-sm text-gray-600 mb-4">{t(`${KEY}.intro`)}</p>

      <form onSubmit={handleAdd} className="grid grid-cols-1 sm:grid-cols-2 gap-4" noValidate>
        <div>
          <label htmlFor="fe-kind" className="block text-sm font-medium mb-1">{t(`${KEY}.kind`)}</label>
          <select id="fe-kind" value={form.kind} onChange={set('kind')} className={inputClass}>
            {ENTRY_KINDS.map((kind) => (
              <option key={kind} value={kind}>{t(`${KEY}.kinds.${kind}`)}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="fe-amount" className="block text-sm font-medium mb-1">{t(`${KEY}.amount`)}</label>
          <input id="fe-amount" type="number" inputMode="decimal" step="0.01" min="0" value={form.amount} onChange={set('amount')} className={inputClass} />
        </div>
        <div>
          <label htmlFor="fe-date" className="block text-sm font-medium mb-1">{t(`${KEY}.date`)}</label>
          <input id="fe-date" type="date" max={todayIso()} value={form.entryDate} onChange={set('entryDate')} className={inputClass} />
        </div>
        <div>
          <label htmlFor="fe-category" className="block text-sm font-medium mb-1">{t(`${KEY}.category`)}</label>
          <input id="fe-category" type="text" maxLength={60} value={form.category} onChange={set('category')} className={inputClass} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="fe-reason" className="block text-sm font-medium mb-1">{t(`${KEY}.reason`)}</label>
          <textarea id="fe-reason" rows={2} maxLength={500} value={form.reason} onChange={set('reason')} className={inputClass} />
        </div>
        <div className="sm:col-span-2 flex justify-end">
          <button
            type="submit"
            disabled={!valid || saving}
            className="px-4 py-2 min-h-[44px] rounded-lg bg-theme-accent text-theme-on-accent text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t(`${KEY}.add`)}
          </button>
        </div>
      </form>

      {voiding && (
        <div role="group" aria-label={t(`${KEY}.void`)} className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2">
          <label htmlFor="fe-void-reason" className="block text-sm font-medium">{t(`${KEY}.voidReason`)}</label>
          <textarea
            id="fe-void-reason"
            rows={2}
            maxLength={500}
            value={voiding.reason}
            onChange={(event) => setVoiding({ ...voiding, reason: event.target.value })}
            className={inputClass}
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setVoiding(null)} className="px-4 py-2 min-h-[44px] rounded-lg border border-gray-300 text-sm">
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={handleVoid}
              disabled={saving || voiding.reason.trim().length < 10}
              className="px-4 py-2 min-h-[44px] rounded-lg bg-theme-accent text-theme-on-accent text-sm font-medium disabled:opacity-50"
            >
              {t(`${KEY}.voidConfirm`)}
            </button>
          </div>
        </div>
      )}

      {entries.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500">
                <th scope="col" className="py-1.5 pr-3">{t(`${KEY}.date`)}</th>
                <th scope="col" className="py-1.5 pr-3">{t(`${KEY}.kind`)}</th>
                <th scope="col" className="py-1.5 pr-3 text-right">{t(`${KEY}.amount`)}</th>
                <th scope="col" className="py-1.5 pr-3">{t(`${KEY}.category`)}</th>
                <th scope="col" className="py-1.5 pr-3">{t(`${KEY}.reason`)}</th>
                <th scope="col" className="py-1.5"><span className="sr-only">{t(`${KEY}.void`)}</span></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-t border-gray-200">
                  <td className="py-1.5 pr-3 whitespace-nowrap">{entry.entry_date}</td>
                  <td className="py-1.5 pr-3">{t(`${KEY}.kinds.${entry.kind}`)}</td>
                  <td className={`py-1.5 pr-3 text-right font-medium ${entry.kind === 'income' ? 'text-emerald-700' : 'text-red-700'}`}>
                    {entry.kind === 'income' ? '+' : '-'}{Number(entry.amount).toFixed(2)}
                  </td>
                  <td className="py-1.5 pr-3">{entry.category}</td>
                  <td className="py-1.5 pr-3">{entry.reason}</td>
                  <td className="py-1.5">
                    {canVoid(entry) && (
                      <button
                        type="button"
                        onClick={() => setVoiding({ id: entry.id, reason: '' })}
                        className="px-3 py-1 min-h-[44px] rounded-lg border border-gray-300 text-xs"
                      >
                        {t(`${KEY}.void`)}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

export default FinancialEntriesPanel;
