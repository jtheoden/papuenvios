import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { pageToPath } from '@/lib/routes';
import { recordLegalAcceptance } from '@/lib/legalAcceptanceService';

const ERROR_KEYS = {
  under_age: 'legal.gate.errors.underAge',
  invalid: 'legal.gate.errors.invalid',
  future: 'legal.gate.errors.invalid',
  birth_date_conflict: 'legal.gate.errors.conflict',
  not_authenticated: 'legal.gate.errors.notAuthenticated',
  profile_not_found: 'legal.gate.errors.profileNotFound',
  invalid_version: 'legal.gate.errors.versionOutdated',
};

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled])';

const todayIso = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const linkClass =
  'underline text-blue-700 hover:text-blue-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-sm';

/**
 * Modal that collects the explicit acceptance of Terms + Privacy and the date of birth (18+).
 * Legal pages open in a new tab so in-progress checkout/remittance state is never lost.
 */
const LegalAcceptanceGate = ({ open, source, onAccepted, onCancel }) => {
  const { t } = useLanguage();
  const titleId = useId();
  const errorId = useId();
  const dialogRef = useRef(null);
  const dateRef = useRef(null);
  const [accepted, setAccepted] = useState(false);
  const [birthDate, setBirthDate] = useState('');
  const [errorKey, setErrorKey] = useState(null);
  const [saving, setSaving] = useState(false);

  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  const submittingRef = useRef(false);

  useEffect(() => {
    if (!open) return undefined;
    setAccepted(false);
    setBirthDate('');
    setErrorKey(null);
    setSaving(false);
    submittingRef.current = false;

    const previouslyFocused = document.activeElement;
    dateRef.current?.focus();

    // Keep the page behind the dialog out of reach of keyboard and assistive tech.
    const appRoot = document.getElementById('root');
    const hadAriaHidden = appRoot?.getAttribute('aria-hidden');
    appRoot?.setAttribute('inert', '');
    appRoot?.setAttribute('aria-hidden', 'true');

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        if (submittingRef.current) return;
        event.stopPropagation();
        onCancelRef.current?.();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const items = Array.from(dialogRef.current.querySelectorAll(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!dialogRef.current.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (appRoot) {
        appRoot.removeAttribute('inert');
        if (hadAriaHidden === null || hadAriaHidden === undefined) appRoot.removeAttribute('aria-hidden');
        else appRoot.setAttribute('aria-hidden', hadAriaHidden);
      }
      if (previouslyFocused && typeof previouslyFocused.focus === 'function' && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [open]);

  if (!open) return null;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submittingRef.current) return;
    if (!accepted) {
      setErrorKey('legal.gate.errors.acceptRequired');
      return;
    }
    if (!birthDate) {
      setErrorKey('legal.gate.errors.birthDateRequired');
      return;
    }
    setErrorKey(null);
    submittingRef.current = true;
    setSaving(true);
    const result = await recordLegalAcceptance({ birthDate, source });
    if (result.ok) {
      onAccepted?.();
      return;
    }
    submittingRef.current = false;
    setSaving(false);
    setErrorKey(ERROR_KEYS[result.code] || 'legal.gate.errors.unknown');
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
      >
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <h2 id={titleId} className="text-lg font-semibold text-gray-900">
            {t('legal.gate.title')}
          </h2>
          <p className="text-sm text-gray-600">{t('legal.gate.intro')}</p>

          <div>
            <label htmlFor={`${titleId}-dob`} className="block text-sm font-medium text-gray-700">
              {t('legal.gate.birthDateLabel')}
            </label>
            <input
              id={`${titleId}-dob`}
              ref={dateRef}
              type="date"
              value={birthDate}
              max={todayIso()}
              onChange={(e) => setBirthDate(e.target.value)}
              aria-describedby={errorKey ? errorId : undefined}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">{t('legal.gate.birthDateHint')}</p>
          </div>

          <div className="flex items-start gap-2">
            <input
              id={`${titleId}-accept`}
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              className="mt-1 h-4 w-4"
            />
            <label htmlFor={`${titleId}-accept`} className="text-sm text-gray-700">
              {t('legal.gate.acceptLabel')}{' '}
              <a href={pageToPath('terms')} target="_blank" rel="noopener noreferrer" className={linkClass}>
                {t('legal.links.terms')}
              </a>{' '}
              {t('legal.gate.acceptAnd')}{' '}
              <a href={pageToPath('privacy')} target="_blank" rel="noopener noreferrer" className={linkClass}>
                {t('legal.links.privacy')}
              </a>{' '}
              {t('legal.gate.acceptSuffix')}
            </label>
          </div>

          {errorKey && (
            <p id={errorId} role="alert" className="text-sm text-red-700">
              {t(errorKey)}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={saving} onClick={() => onCancel?.()}>
              {t('legal.gate.cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? t('legal.gate.saving') : t('legal.gate.accept')}
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};

export default LegalAcceptanceGate;
