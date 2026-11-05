import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';
import LegalLink from '@/components/LegalLink';
import RegulatoryNotice from '@/components/RegulatoryNotice';
import { openConsentPreferences } from '@/lib/consent';
import { buildFooterTheme } from '@/lib/footerTheme';
import { LEGAL_LINK, SIGNATURE, MUTED, BRAND, FOOTER_ROOT, FOOTER_DIVIDER } from '@/lib/footerStyles';

const Footer = ({ onNavigate, showNotice = true }) => {
  const { t, language } = useLanguage();
  const { visualSettings } = useBusiness();
  const currentDate = new Date().toLocaleDateString(language === 'es' ? 'es-ES' : 'en-US');
  const companyName = visualSettings?.companyName || 'PapuEnvíos';
  const currentYear = new Date().getFullYear();

  return (
    <footer className={`mt-8 md:mt-12 ${FOOTER_ROOT}`} style={buildFooterTheme(visualSettings || {})}>
      {showNotice && <RegulatoryNotice variant="strip" onNavigate={onNavigate} />}
      <div className="container mx-auto px-3 py-4 md:px-4 md:py-6">
        {/* Main footer content */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-2 md:gap-3 text-xs md:text-sm">
          {/* Date */}
          <span className={`${MUTED} text-center md:text-left`}>
            {t('footer.date', { date: currentDate })}
          </span>

          {/* Developer signature */}
          <a
            href="https://www.linkedin.com/in/juan-a-centelles-geides/"
            className={`${SIGNATURE} text-center md:text-left break-words max-w-full`}
          >
            {t('footer.developedBy', { name: 'Juan A. Centelles', email: 'jtheoden@gmail.com' })}
          </a>

          {/* Company name */}
          <span className="text-center md:text-right">
            <span className={MUTED}>{t('footer.to')}</span>{' '}
            <span className={BRAND}>{companyName}</span>
          </span>
        </div>

        {/* Legal links */}
        <nav
          aria-label={t('legal.nav.label')}
          className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs md:text-sm"
        >
          <LegalLink page="terms" onNavigate={onNavigate} className={LEGAL_LINK}>{t('legal.links.terms')}</LegalLink>
          <LegalLink page="privacy" onNavigate={onNavigate} className={LEGAL_LINK}>{t('legal.links.privacy')}</LegalLink>
          <LegalLink page="terms" hash="refunds" onNavigate={onNavigate} className={LEGAL_LINK}>{t('legal.links.refunds')}</LegalLink>
          <button type="button" className={LEGAL_LINK} onClick={openConsentPreferences}>
            {t('cookieConsent.preferencesLink')}
          </button>
        </nav>

        {/* Copyright */}
        <div className={`text-center mt-3 pt-3 md:mt-4 md:pt-4 ${FOOTER_DIVIDER}`}>
          <p className={`text-xs ${MUTED}`}>
            <span>© {currentYear}</span>{' '}
            <span className={BRAND}>{companyName}</span>
            <span>. {t('footer.copyright')}</span>
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
