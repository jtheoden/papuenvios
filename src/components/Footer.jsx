import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useBusiness } from '@/contexts/BusinessContext';

const Footer = () => {
  const { t, language } = useLanguage();
  const { visualSettings } = useBusiness();
  const currentDate = new Date().toLocaleDateString(language === 'es' ? 'es-ES' : 'en-US');

  // Use footer-specific colors from visual settings with backward-compatible fallbacks
  const footerStyle = {
    backgroundColor: visualSettings?.footerBgColor || visualSettings?.cardBgColor || '#ffffff',
    borderTop: `1px solid ${visualSettings?.primaryColor || '#e5e7eb'}20`
  };

  const textStyle = {
    color: visualSettings?.footerTextColor || visualSettings?.headingColor || '#374151'
  };

  const linkStyle = {
    color: visualSettings?.footerLinkColor || visualSettings?.primaryColor || '#2563eb'
  };

  const linkHoverStyle = {
    color: visualSettings?.footerLinkHoverColor || visualSettings?.accentColor || '#9333ea'
  };

  const companyNameStyle = {
    color: visualSettings?.primaryColor || '#2563eb',
    fontWeight: '600'
  };

  const currentYear = new Date().getFullYear();

  return (
    <footer className="mt-8 md:mt-12" style={footerStyle}>
      <div className="container mx-auto px-3 py-4 md:px-4 md:py-6">
        {/* Main footer content */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-2 md:gap-3 text-xs md:text-sm">
          {/* Date */}
          <span style={textStyle} className="opacity-80 text-center md:text-left">
            {t('footer.date', { date: currentDate })}
          </span>

          {/* Developer signature */}
          <a
            href="https://www.linkedin.com/in/juan-a-centelles-geides/"
            style={linkStyle}
            className="font-semibold transition-colors duration-200 text-center md:text-left break-words max-w-full"
            onMouseEnter={(e) => e.currentTarget.style.color = linkHoverStyle.color}
            onMouseLeave={(e) => e.currentTarget.style.color = linkStyle.color}
          >
            {t('footer.developedBy', { name: 'Juan A. Centelles', email: 'jtheoden@gmail.com' })}
          </a>

          {/* Company name */}
          <span className="text-center md:text-right">
            <span style={textStyle} className="opacity-80">{t('footer.to')}</span>{' '}
            <span style={companyNameStyle}>{visualSettings?.companyName || 'PapuEnvíos'}</span>
          </span>
        </div>

        {/* Copyright */}
        <div className="text-center mt-3 pt-3 md:mt-4 md:pt-4" style={{ borderTop: `1px solid ${visualSettings?.primaryColor || '#e5e7eb'}10` }}>
          <p className="text-xs opacity-70">
            <span style={textStyle}>© {currentYear}</span>{' '}
            <span style={companyNameStyle}>{visualSettings?.companyName || 'PapuEnvíos'}</span>
            <span style={textStyle}>. {t('footer.copyright')}</span>
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
