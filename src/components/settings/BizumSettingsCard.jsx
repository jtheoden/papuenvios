/**
 * Bizum parameters card: one field per bizum_settings key with label, unit, allowed range and
 * recommended value visible as help. Saving sends ONLY the keys that changed (set_bizum_settings
 * merges a partial patch). "Restore recommended value" just fills the field; nothing is sent
 * until the admin saves. The database validates again and answers bizum_settings_out_of_range
 * with the offending key, which is shown on that field.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { toBizumError } from '@/lib/bizumErrors';
import {
  BIZUM_SETTING_FIELDS,
  buildBizumSettingsPatch,
  setBizumSettings,
  validateBizumSettingsForm
} from '@/lib/bizumService';

const toForm = (settings) =>
  Object.fromEntries(BIZUM_SETTING_FIELDS.map(({ key }) => [key, settings?.[key] == null ? '' : String(settings[key])]));

/** Take `next` only for fields the admin has not touched since `base`; typed edits survive. */
const rebase = (current, base, next) =>
  Object.fromEntries(Object.keys(next).map((key) => [key, current[key] === base[key] ? next[key] : current[key]]));

const BizumSettingsCard = ({ settings, error, onSaved, onRetry }) => {
  const { t } = useLanguage();
  const [form, setForm] = useState(() => toForm(settings));
  const [serverErrors, setServerErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  const settingsRef = useRef(settings);
  const savingRef = useRef(false);

  // Refreshed settings must not wipe what the admin is typing: rebase instead of replace.
  useEffect(() => {
    const base = toForm(settingsRef.current);
    const next = toForm(settings);
    setForm((current) => rebase(current, base, next));
    settingsRef.current = settings;
  }, [settings]);

  const localErrors = useMemo(() => validateBizumSettingsForm(form), [form]);
  const patch = useMemo(() => (settings ? buildBizumSettingsPatch(settings, form) : {}), [settings, form]);
  const canSave = Object.keys(patch).length > 0 && Object.keys(localErrors).length === 0 && !saving;

  const setValue = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setServerErrors((prev) => {
      if (!prev[key]) return prev;
      const { [key]: _removed, ...rest } = prev;
      return rest;
    });
  };

  const errorMessage = ({ key, min, max, decimals }) => {
    if (serverErrors[key]) return serverErrors[key];
    const code = localErrors[key];
    return code ? t(`settings.bizum.validation.${code}`, { min, max, decimals }) : null;
  };

  const handleSave = async (event) => {
    event?.preventDefault();
    if (!canSave || savingRef.current) return;
    savingRef.current = true;
    const submitted = form;
    setSaving(true);
    setFormError(null);
    try {
      const saved = await setBizumSettings(patch);
      // Fields edited while the request was in flight keep the admin's value.
      setForm((current) => rebase(current, submitted, toForm(saved)));
      setServerErrors({});
      toast({ title: t('settings.bizum.settings.saved'), description: t('settings.bizum.settings.savedDescription') });
      onSaved(saved);
    } catch (failure) {
      const bizumError = toBizumError(failure);
      if (bizumError.field && BIZUM_SETTING_FIELDS.some(({ key }) => key === bizumError.field)) {
        setServerErrors({ [bizumError.field]: t(bizumError.i18nKey) });
      } else {
        setFormError(t(bizumError.i18nKey));
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="bizum-settings-title" className="space-y-4 rounded-xl border border-gray-300 bg-white p-4 sm:p-6">
      <div>
        <h3 id="bizum-settings-title" className="text-lg font-semibold text-gray-900">
          {t('settings.bizum.settings.title')}
        </h3>
        <p className="mt-1 text-sm text-gray-700">{t('settings.bizum.settings.intro')}</p>
      </div>

      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-red-600 bg-red-50 p-4 text-sm text-red-900">
          <span>{t(error.i18nKey || 'settings.bizum.errors.unknown')}</span>
          <Button variant="outline" size="lg" onClick={onRetry}>
            {t('settings.bizum.retry')}
          </Button>
        </div>
      )}

      {settings && (
        <form onSubmit={handleSave} noValidate className="space-y-5">
          <div className="grid gap-5 md:grid-cols-2">
            {BIZUM_SETTING_FIELDS.map((field) => {
              const id = `bizum-setting-${field.key}`;
              const message = errorMessage(field);
              const label = t(`settings.bizum.fields.${field.key}.label`);
              return (
                <div key={field.key} className="space-y-1">
                  <label htmlFor={id} className="block text-sm font-medium text-gray-900">
                    {label}
                  </label>
                  <div className="flex items-start gap-2">
                    <input
                      id={id}
                      type="text"
                      inputMode="decimal"
                      value={form[field.key]}
                      onChange={(event) => setValue(field.key, event.target.value)}
                      aria-invalid={message ? 'true' : 'false'}
                      aria-describedby={`${id}-help ${id}-meta${message ? ` ${id}-error` : ''}`}
                      className={`min-h-11 w-32 rounded border px-3 py-2 text-sm text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                        message ? 'border-red-600' : 'border-gray-400'
                      }`}
                    />
                    <span className="pt-3 text-sm text-gray-700">{t(`settings.bizum.units.${field.unit}`)}</span>
                  </div>
                  <p id={`${id}-help`} className="text-sm text-gray-700">
                    {t(`settings.bizum.fields.${field.key}.help`)}
                  </p>
                  <p id={`${id}-meta`} className="text-xs text-gray-700">
                    {t('settings.bizum.range', { min: field.min, max: field.max })}
                    {' · '}
                    {t(`settings.bizum.units.${field.unit}`)}
                    {' · '}
                    {t('settings.bizum.defaultValue', { default: field.default })}
                  </p>
                  <p id={`${id}-error`} aria-live="polite" className="text-xs font-medium text-red-700">
                    {message || null}
                  </p>
                  <button
                    type="button"
                    aria-label={`${t('settings.bizum.restore')} ${label}`}
                    onClick={() => setValue(field.key, String(field.default))}
                    className="min-h-11 text-sm font-medium text-blue-800 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                  >
                    {t('settings.bizum.restore')}
                  </button>
                </div>
              );
            })}
          </div>

          {formError && (
            <p role="alert" className="rounded-lg border border-red-600 bg-red-50 p-3 text-sm text-red-900">
              {formError}
            </p>
          )}

          <Button type="submit" size="lg" disabled={!canSave}>
            {saving && <Loader className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {saving ? t('settings.bizum.settings.saving') : t('settings.bizum.settings.save')}
          </Button>
        </form>
      )}
    </section>
  );
};

export default BizumSettingsCard;
