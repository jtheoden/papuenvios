import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';

const Footer = () => {
  const { t, language } = useLanguage();
  const currentDate = new Date().toLocaleDateString(language === 'es' ? 'es-ES' : 'en-US');

  return (
    <footer className="bg-slate-900 text-white mt-12">
      <div className="container mx-auto px-4 py-6 flex flex-col md:flex-row items-center justify-between gap-3 text-sm">
        <span className="text-slate-200">{t('footer.date', { date: currentDate })}</span>
        <a
          href="mailto:contacto@papuenvios.com"
          className="text-indigo-200 hover:text-white font-semibold"
        >
          {t('footer.developedBy', { name: 'PapuEnvíos Dev' })}
        </a>
      </div>
    </footer>
  );
};

export default Footer;
