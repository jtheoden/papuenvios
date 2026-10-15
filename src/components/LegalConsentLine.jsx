import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import LegalLink from '@/components/LegalLink';

/**
 * Informational consent line with real links to Terms and Privacy.
 * variant "continue" (sign-in) or "confirm" (checkout / remittance confirmation).
 */
const LegalConsentLine = ({ variant = 'confirm', onNavigate, className = 'text-center text-xs text-gray-500' }) => {
  const { t } = useLanguage();
  const linkClass = 'underline hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-sm';

  return (
    <p className={className}>
      {t(`legal.consent.${variant === 'continue' ? 'continue' : 'confirm'}`)}{' '}
      <LegalLink page="terms" onNavigate={onNavigate} className={linkClass}>
        {t('legal.links.terms')}
      </LegalLink>{' '}
      {t('legal.consent.and')}{' '}
      <LegalLink page="privacy" onNavigate={onNavigate} className={linkClass}>
        {t('legal.links.privacy')}
      </LegalLink>
      .
    </p>
  );
};

export default LegalConsentLine;
