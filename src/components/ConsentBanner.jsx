import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import LegalLink from '@/components/LegalLink';
import {
  getConsent,
  initConsent,
  setAnalyticsConsent,
  subscribeConsent,
  subscribeConsentPreferencesRequests,
} from '@/lib/consent';

const CHOICE_BUTTON_CLASS =
  'flex-1 sm:flex-none min-h-[44px] rounded-md border border-gray-900 bg-white px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2';

/**
 * Opt-in analytics consent bar. Shown to visitors who have not decided (except on `suppressed`
 * pages such as checkout/admin, where analytics simply stays off) and whenever the user asks to
 * reopen it from the footer. The two choices are visually identical and are the only way to
 * dismiss it. Focus is moved into it only when the user reopened it, and it never traps focus.
 */
const ConsentBanner = ({ suppressed = false, onNavigate }) => {
  const { t } = useLanguage();
  const [consent, setConsent] = useState(getConsent);
  const [reopened, setReopened] = useState(false);
  const regionRef = useRef(null);
  const previousFocusRef = useRef(null);

  useEffect(() => {
    initConsent();
    setConsent(getConsent());
    const unsubscribeConsent = subscribeConsent(setConsent);
    const unsubscribeRequests = subscribeConsentPreferencesRequests(() => setReopened(true));
    return () => {
      unsubscribeConsent();
      unsubscribeRequests();
    };
  }, []);

  useEffect(() => {
    if (!reopened) return;
    const active = document.activeElement;
    previousFocusRef.current = active && active !== document.body ? active : null;
    regionRef.current?.focus();
  }, [reopened]);

  const open = reopened || (!consent.decided && !suppressed);

  // Reserve space below the page content so the fixed bar never covers it.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const apply = () => {
      document.body.style.paddingBottom = `${regionRef.current?.offsetHeight ?? 0}px`;
    };
    apply();
    window.addEventListener('resize', apply);
    return () => {
      window.removeEventListener('resize', apply);
      document.body.style.paddingBottom = '';
    };
  }, [open]);

  if (!open) return null;

  const choose = (granted) => {
    const previous = previousFocusRef.current;
    previousFocusRef.current = null;
    setAnalyticsConsent(granted);
    setReopened(false);
    if (previous && previous.isConnected) previous.focus();
  };

  return (
    <div
      ref={regionRef}
      role="region"
      aria-labelledby="cookie-consent-title"
      tabIndex={-1}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-300 bg-white shadow-[0_-4px_16px_rgba(0,0,0,0.12)] focus:outline-none"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="container mx-auto flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-gray-800">
          <h2 id="cookie-consent-title" className="font-semibold">
            {t('cookieConsent.title')}
          </h2>
          <p className="mt-1">
            {t('cookieConsent.description')}{' '}
            <LegalLink page="privacy" onNavigate={onNavigate} className="underline text-blue-700">
              {t('cookieConsent.privacyLink')}
            </LegalLink>
          </p>
          {consent.gpc && <p className="mt-1 font-medium">{t('cookieConsent.gpcNote')}</p>}
          {reopened && consent.decided && (
            <p className="mt-1" aria-live="polite">
              {consent.analytics ? t('cookieConsent.statusOn') : t('cookieConsent.statusOff')}
            </p>
          )}
        </div>
        <div className="flex gap-3 sm:shrink-0">
          <button type="button" className={CHOICE_BUTTON_CLASS} onClick={() => choose(true)}>
            {t('cookieConsent.accept')}
          </button>
          <button type="button" className={CHOICE_BUTTON_CLASS} onClick={() => choose(false)}>
            {t('cookieConsent.reject')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConsentBanner;
