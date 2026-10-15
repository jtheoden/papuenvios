/**
 * Stock reservation policy card (Settings -> System, super_admin only).
 * Lets a super admin tune how long unpaid / unreviewed orders keep their reserved stock and how
 * many open reservations one customer may hold. The database validates and authorizes again
 * (set_stock_policy / reset_stock_policy), this component only drives the form.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Boxes, Loader, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/components/ui/use-toast';
import {
  STOCK_POLICY_DEFAULTS,
  STOCK_POLICY_BOUNDS,
  validateStockPolicy,
  getStockPolicy,
  setStockPolicy,
  resetStockPolicy
} from '@/lib/stockPolicyService';

const FIELDS = [
  { name: 'unpaidHours', i18n: 'unpaid' },
  { name: 'proofHours', i18n: 'proof' },
  { name: 'maxOpenReservations', i18n: 'maxOpen' }
];

const toForm = (policy) => ({
  unpaidHours: String(policy.unpaidHours),
  proofHours: String(policy.proofHours),
  maxOpenReservations: String(policy.maxOpenReservations)
});

const StockPolicyCard = () => {
  const { t } = useLanguage();
  const { isSuperAdmin } = useAuth();
  const [policy, setPolicy] = useState(null);
  const [form, setForm] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const load = useCallback(async () => {
    try {
      const loaded = await getStockPolicy();
      setPolicy(loaded);
      setForm(toForm(loaded));
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    if (isSuperAdmin) load();
  }, [isSuperAdmin, load]);

  const errors = useMemo(() => (form ? validateStockPolicy(form) : {}), [form]);
  const dirty = Boolean(policy && form) && FIELDS.some(({ name }) => String(policy[name]) !== form[name]);
  const canSave = dirty && Object.keys(errors).length === 0 && !saving;

  if (!isSuperAdmin) return null;

  const applyResult = (result) => {
    setPolicy(result);
    setForm(toForm(result));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await setStockPolicy({
        unpaidHours: Number(form.unpaidHours),
        proofHours: Number(form.proofHours),
        maxOpenReservations: Number(form.maxOpenReservations)
      });
      applyResult(result);
      toast({ title: t('stockPolicy.saved'), description: t('stockPolicy.savedDescription') });
    } catch (error) {
      toast({
        title: t('common.error'),
        description: error?.code === 'FORBIDDEN' ? t('stockPolicy.forbidden') : t('stockPolicy.saveError'),
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setShowResetConfirm(false);
    setSaving(true);
    try {
      const result = await resetStockPolicy();
      applyResult(result);
      toast({ title: t('stockPolicy.resetDone') });
    } catch (error) {
      toast({
        title: t('common.error'),
        description: error?.code === 'FORBIDDEN' ? t('stockPolicy.forbidden') : t('stockPolicy.saveError'),
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };

  const bounds = (name) => policy?.bounds?.[name] || STOCK_POLICY_BOUNDS[name];
  const defaults = policy?.defaults || STOCK_POLICY_DEFAULTS;

  const errorText = (name) => {
    const code = errors[name];
    if (!code) return null;
    const { min, max } = bounds(name);
    return t(`stockPolicy.errors.${code}`).replace('{min}', String(min)).replace('{max}', String(max));
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-effect p-8 rounded-2xl space-y-6">
      <div className="flex items-center gap-2 text-gray-900">
        <Boxes className="h-6 w-6" />
        <h2 className="text-xl font-semibold">{t('stockPolicy.title')}</h2>
      </div>
      <p className="text-sm text-gray-600">{t('stockPolicy.intro')}</p>

      {loadFailed && (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          {t('stockPolicy.loadError')}
        </div>
      )}

      {!policy && !loadFailed && <Loader className="h-5 w-5 animate-spin text-gray-400" />}

      {policy && form && (
        <fieldset className="space-y-6">
          <legend className="sr-only">{t('stockPolicy.title')}</legend>

          {FIELDS.map(({ name, i18n }) => {
            const { min, max } = bounds(name);
            const message = errorText(name);
            const id = `stock-policy-${i18n}`;
            return (
              <div key={name} className="space-y-1">
                <label htmlFor={id} className="block text-sm font-medium text-gray-900">
                  {t(`stockPolicy.${i18n}.label`)}
                </label>
                <input
                  id={id}
                  type="number"
                  inputMode="numeric"
                  step="1"
                  min={min}
                  max={max}
                  value={form[name]}
                  onChange={(e) => setForm((prev) => ({ ...prev, [name]: e.target.value }))}
                  aria-invalid={message ? 'true' : 'false'}
                  aria-describedby={`${id}-help ${id}-meta${message ? ` ${id}-error` : ''}`}
                  className={`w-40 border rounded px-3 py-2 text-sm ${message ? 'border-red-500' : 'border-gray-300'}`}
                />
                <p id={`${id}-help`} className="text-sm text-gray-600">
                  {t(`stockPolicy.${i18n}.help`)}
                </p>
                <p id={`${id}-meta`} className="text-xs text-gray-500">
                  {t('stockPolicy.range')} <strong>{`${min}–${max}`}</strong>
                  {' · '}
                  {t('stockPolicy.default')} <strong>{defaults[name]}</strong>
                  {' · '}
                  {t('stockPolicy.current')} <strong>{policy[name]}</strong>
                </p>
                {message && (
                  <p id={`${id}-error`} role="alert" className="text-xs text-red-600">
                    {message}
                  </p>
                )}
              </div>
            );
          })}

          <div className="flex flex-wrap gap-3">
            <Button onClick={handleSave} disabled={!canSave}>
              {saving ? t('stockPolicy.saving') : t('stockPolicy.save')}
            </Button>
            <Button variant="outline" onClick={() => setShowResetConfirm(true)} disabled={saving}>
              {t('stockPolicy.reset')}
            </Button>
          </div>
        </fieldset>
      )}

      <div className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
        <Info className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
        <p>{t('stockPolicy.scheduleNote')}</p>
      </div>

      {showResetConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowResetConfirm(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="stock-policy-reset-title"
            className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="stock-policy-reset-title" className="text-lg font-semibold">
              {t('stockPolicy.resetConfirmTitle')}
            </h3>
            <p className="text-sm text-gray-700">{t('stockPolicy.resetConfirmMessage')}</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowResetConfirm(false)}>
                {t('common.cancel')}
              </Button>
              <Button onClick={handleReset}>{t('stockPolicy.resetConfirm')}</Button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
};

export default StockPolicyCard;
