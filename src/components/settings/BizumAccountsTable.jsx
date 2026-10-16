/**
 * Bizum receiving accounts (R-02): list, create / edit in a dialog and activate / deactivate with
 * a confirmation dialog. There is no delete (the database forbids it: accounts are retired with
 * is_active so historical phones stay resolvable). Phones are PII: every listing shows the masked
 * number; the full number only appears inside the edit form of an admin.
 */

import React, { useRef, useState } from 'react';
import { Pencil, Plus, Loader } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import ResponsiveTableWrapper from '@/components/tables/ResponsiveTableWrapper';
import BizumDialog from '@/components/settings/BizumDialog';
import BizumField from '@/components/settings/BizumField';
import { toBizumError } from '@/lib/bizumErrors';
import {
  createBizumAccount,
  maskPhone,
  setBizumAccountActive,
  updateBizumAccount,
  validateBizumAccountForm
} from '@/lib/bizumService';

const TEXT_FIELDS = ['account_name', 'holder_name', 'phone', 'bank_name'];
// Visual order of the form, used to focus the first invalid field.
const FIELD_ORDER = [...TEXT_FIELDS, 'priority_order', 'per_operation_limit', 'notes'];
const FORM_ID = 'bizum-account-form';

const emptyForm = (defaultLimit) => ({
  account_name: '',
  holder_name: '',
  phone: '',
  bank_name: '',
  is_active: true,
  for_products: true,
  for_remittances: true,
  priority_order: '0',
  per_operation_limit: defaultLimit == null ? '' : String(defaultLimit),
  notes: ''
});

const formFromAccount = (account) => ({
  account_name: account.account_name ?? '',
  holder_name: account.holder_name ?? '',
  phone: account.phone ?? '',
  bank_name: account.bank_name ?? '',
  is_active: Boolean(account.is_active),
  for_products: Boolean(account.for_products),
  for_remittances: Boolean(account.for_remittances),
  priority_order: String(account.priority_order ?? 0),
  per_operation_limit: String(account.per_operation_limit ?? 0),
  notes: account.notes ?? ''
});

const CheckboxField = ({ id, label, checked, onChange }) => (
  <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-gray-900">
    <input
      id={id}
      type="checkbox"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
      className="h-5 w-5 rounded border-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
    />
    {label}
  </label>
);

const BizumAccountsTable = ({ accounts, error, defaultLimit, onChanged, onRetry }) => {
  const { t } = useLanguage();
  const [formState, setFormState] = useState(null); // { mode: 'create' | 'edit', account? }
  const [form, setForm] = useState(() => emptyForm(defaultLimit));
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [confirmState, setConfirmState] = useState(null); // { account, activate }
  const [confirmError, setConfirmError] = useState(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const openCreate = () => {
    setForm(emptyForm(defaultLimit));
    setFieldErrors({});
    setFormError(null);
    setFormState({ mode: 'create' });
  };

  const openEdit = (account) => {
    setForm(formFromAccount(account));
    setFieldErrors({});
    setFormError(null);
    setFormState({ mode: 'edit', account });
  };

  const closeForm = () => {
    if (!busyRef.current) setFormState(null);
  };

  // fromEdit keeps the edit dialog (and its draft) open underneath; `dirty` adds a discard warning.
  const openConfirm = (account, { fromEdit = false, dirty = false } = {}) => {
    setConfirmError(null);
    setConfirmState({ account, activate: !account.is_active, fromEdit, dirty });
  };

  const focusField = (name) => document.getElementById(fieldId(name))?.focus();

  const setField = (name, value) => {
    setForm((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const handleSave = async (event) => {
    event?.preventDefault();
    if (busyRef.current) return;
    const codes = validateBizumAccountForm(form);
    if (Object.keys(codes).length > 0) {
      setFieldErrors(
        Object.fromEntries(Object.entries(codes).map(([name, code]) => [name, t(`settings.bizum.accounts.validation.${code}`)]))
      );
      focusField(FIELD_ORDER.find((name) => codes[name]));
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setFormError(null);
    try {
      if (formState.mode === 'create') await createBizumAccount(form);
      else await updateBizumAccount(formState.account.id, form, formState.account);
      toast({ title: t('settings.bizum.accounts.saved') });
      setFormState(null);
      onChanged();
    } catch (failure) {
      const bizumError = toBizumError(failure);
      if (bizumError.field && bizumError.field in form) {
        setFieldErrors({ [bizumError.field]: t(bizumError.i18nKey) });
        focusField(bizumError.field);
      } else {
        setFormError(t(bizumError.i18nKey));
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const handleConfirm = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setConfirmError(null);
    try {
      await setBizumAccountActive(confirmState.account.id, confirmState.activate);
      toast({ title: t('settings.bizum.accounts.statusChanged') });
      if (confirmState.fromEdit) setFormState(null);
      setConfirmState(null);
      onChanged();
    } catch (failure) {
      setConfirmError(t(toBizumError(failure).i18nKey));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const columns = [
      {
        key: 'account_name',
        label: t('settings.bizum.accounts.fields.account_name'),
        // A real button: the wrapper's clickable rows (mobile / tablet cards) are not keyboard operable.
        render: (value, account) => (
          <button
            type="button"
            aria-label={`${t('settings.bizum.accounts.edit')}: ${value}`}
            onClick={(event) => {
              event.stopPropagation();
              openEdit(account);
            }}
            className="min-h-11 text-left font-medium text-blue-900 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            {value}
          </button>
        )
      },
      {
        key: 'phone',
        label: t('settings.bizum.accounts.fields.phone'),
        render: (value) => <span className="font-mono text-sm">{maskPhone(value)}</span>
      },
      { key: 'bank_name', label: t('settings.bizum.accounts.fields.bank_name'), render: (value) => value || '-' },
      {
        key: 'is_active',
        label: t('common.status'),
        render: (value) => (
          <span
            className={`inline-block rounded-full px-2 py-1 text-xs font-medium ${
              value ? 'bg-green-100 text-green-900' : 'bg-gray-200 text-gray-900'
            }`}
          >
            {value ? t('settings.bizum.accounts.active') : t('settings.bizum.accounts.inactive')}
          </span>
        )
      },
      {
        key: 'per_operation_limit',
        label: t('settings.bizum.accounts.fields.per_operation_limit'),
        render: (value) => (Number(value) === 0 ? t('settings.bizum.accounts.fields.noCap') : value)
      },
      { key: 'priority_order', label: t('settings.bizum.accounts.fields.priority_order'), render: (value) => value },
      {
        key: 'actions',
        label: t('common.actions'),
        render: (_, account) => (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="h-11 w-11 p-0"
              aria-label={t('settings.bizum.accounts.edit')}
              title={`${t('settings.bizum.accounts.edit')}: ${account.account_name}`}
              onClick={() => openEdit(account)}
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              variant="outline"
              size="lg"
              aria-label={t(account.is_active ? 'settings.bizum.accounts.deactivate' : 'settings.bizum.accounts.activate')}
              title={`${t(account.is_active ? 'settings.bizum.accounts.deactivate' : 'settings.bizum.accounts.activate')}: ${account.account_name}`}
              onClick={() => openConfirm(account)}
            >
              {t(account.is_active ? 'settings.bizum.accounts.deactivate' : 'settings.bizum.accounts.activate')}
            </Button>
          </div>
        )
      }
  ];

  const fieldId = (name) => `bizum-account-${name}`;
  const isEdit = formState?.mode === 'edit';

  return (
    <section aria-labelledby="bizum-accounts-title" className="space-y-4 rounded-xl border border-gray-300 bg-white p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 id="bizum-accounts-title" className="text-lg font-semibold text-gray-900">
            {t('settings.bizum.accounts.title')}
          </h3>
          <p className="mt-1 text-sm text-gray-700">{t('settings.bizum.accounts.intro')}</p>
        </div>
        {!error && (
          <Button size="lg" onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('settings.bizum.accounts.create')}
          </Button>
        )}
      </div>

      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-red-600 bg-red-50 p-4 text-sm text-red-900">
          <span>{t(error.i18nKey || 'settings.bizum.errors.unknown')}</span>
          <Button variant="outline" size="lg" onClick={onRetry}>
            {t('settings.bizum.retry')}
          </Button>
        </div>
      )}

      {!error && accounts.length === 0 && (
        <p className="rounded-lg border border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-800">
          {t('settings.bizum.accounts.empty')}
        </p>
      )}

      {!error && accounts.length > 0 && (
        <ResponsiveTableWrapper columns={columns} data={accounts} onRowClick={openEdit} />
      )}

      <BizumDialog
        open={Boolean(formState)}
        onOpenChange={(open) => {
          if (!open) closeForm();
        }}
        title={t(isEdit ? 'settings.bizum.accounts.editTitle' : 'settings.bizum.accounts.createTitle')}
        description={t('settings.bizum.accounts.formDescription')}
        footer={
          <>
            {isEdit && (
              <Button
                variant="outline"
                size="lg"
                onClick={() =>
                  openConfirm(formState.account, {
                    fromEdit: true,
                    dirty: JSON.stringify(form) !== JSON.stringify(formFromAccount(formState.account))
                  })
                }
                disabled={busy}
              >
                {t(formState.account.is_active ? 'settings.bizum.accounts.deactivate' : 'settings.bizum.accounts.activate')}
              </Button>
            )}
            <Button variant="outline" size="lg" onClick={closeForm} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form={FORM_ID} size="lg" disabled={busy}>
              {busy && <Loader className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {busy ? t('settings.bizum.accounts.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        <form id={FORM_ID} onSubmit={handleSave} noValidate className="space-y-4">
          {TEXT_FIELDS.map((name) => (
            <BizumField
              key={name}
              id={fieldId(name)}
              label={t(`settings.bizum.accounts.fields.${name}`)}
              help={name === 'phone' ? t('settings.bizum.accounts.phoneHelp') : undefined}
              value={form[name]}
              inputMode={name === 'phone' ? 'tel' : undefined}
              error={fieldErrors[name]}
              onChange={(value) => setField(name, value)}
            />
          ))}
          <div className="grid gap-4 sm:grid-cols-2">
            <BizumField
              id={fieldId('priority_order')}
              label={t('settings.bizum.accounts.fields.priority_order')}
              value={form.priority_order}
              inputMode="numeric"
              error={fieldErrors.priority_order}
              onChange={(value) => setField('priority_order', value)}
            />
            <BizumField
              id={fieldId('per_operation_limit')}
              label={t('settings.bizum.accounts.fields.per_operation_limit')}
              help={t('settings.bizum.accounts.limitHelp')}
              value={form.per_operation_limit}
              inputMode="decimal"
              error={fieldErrors.per_operation_limit}
              onChange={(value) => setField('per_operation_limit', value)}
            />
          </div>
          <BizumField
            id={fieldId('notes')}
            label={t('settings.bizum.accounts.fields.notes')}
            value={form.notes}
            multiline
            error={fieldErrors.notes}
            onChange={(value) => setField('notes', value)}
          />
          <fieldset className="space-y-1">
            <CheckboxField
              id={fieldId('for_products')}
              label={t('settings.bizum.accounts.forProducts')}
              checked={form.for_products}
              onChange={(value) => setField('for_products', value)}
            />
            <CheckboxField
              id={fieldId('for_remittances')}
              label={t('settings.bizum.accounts.forRemittances')}
              checked={form.for_remittances}
              onChange={(value) => setField('for_remittances', value)}
            />
            {!isEdit && (
              <CheckboxField
                id={fieldId('is_active')}
                label={t('settings.bizum.accounts.fields.is_active')}
                checked={form.is_active}
                onChange={(value) => setField('is_active', value)}
              />
            )}
          </fieldset>
          {formError && (
            <p role="alert" className="rounded-lg border border-red-600 bg-red-50 p-3 text-sm text-red-900">
              {formError}
            </p>
          )}
        </form>
      </BizumDialog>

      <BizumDialog
        open={Boolean(confirmState)}
        onOpenChange={(open) => {
          if (!open && !busyRef.current) setConfirmState(null);
        }}
        title={t(confirmState?.activate ? 'settings.bizum.accounts.activateConfirm.title' : 'settings.bizum.accounts.deactivateConfirm.title')}
        description={t(confirmState?.activate ? 'settings.bizum.accounts.activateConfirm.message' : 'settings.bizum.accounts.deactivateConfirm.message')}
        footer={
          <>
            <Button variant="outline" size="lg" onClick={() => setConfirmState(null)} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button size="lg" onClick={handleConfirm} disabled={busy}>
              {t(confirmState?.activate ? 'settings.bizum.accounts.activateConfirm.confirm' : 'settings.bizum.accounts.deactivateConfirm.confirm')}
            </Button>
          </>
        }
      >
        {confirmState?.dirty && (
          <p className="rounded-lg border border-amber-500 bg-amber-50 p-3 text-sm text-amber-900">
            {t('settings.bizum.accounts.discardDraftWarning')}
          </p>
        )}
        {confirmError && (
          <p role="alert" className="rounded-lg border border-red-600 bg-red-50 p-3 text-sm text-red-900">
            {confirmError}
          </p>
        )}
      </BizumDialog>
    </section>
  );
};

export default BizumAccountsTable;
