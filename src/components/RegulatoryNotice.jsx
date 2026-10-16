import React from 'react';
import { Info } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import LegalLink from '@/components/LegalLink';

const NOTICE_KEYS = ['notBank', 'zelleIrreversible', 'deliveryEstimates', 'ofac'];

/**
 * Short regulatory / expectations notice. Makes no license or registration claims.
 * variant 'card' is the boxed list used at checkout; 'strip' is a full-width neutral band
 * with fixed colours (independent of the admin theme) used on Home and in the footer.
 */
const RegulatoryNotice = ({ onNavigate, className = '', variant = 'card' }) => {
  const { t } = useLanguage();

  if (variant === 'strip') {
    return (
      <aside
        role="note"
        aria-label={t('legal.notice.title')}
        className={`w-full border-y border-slate-200 bg-slate-50 ${className}`}
      >
        <div className="container mx-auto px-4 py-4 md:py-5">
          <p className="mx-auto max-w-3xl text-left text-sm leading-relaxed text-slate-700 md:text-center md:text-base">
            {NOTICE_KEYS.map((key) => (
              <React.Fragment key={key}>
                <span>{t(`legal.notice.${key}`)}</span>{' '}
              </React.Fragment>
            ))}
            <LegalLink
              page="terms"
              onNavigate={onNavigate}
              className="inline-block py-2 font-medium text-blue-700 underline underline-offset-2 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2"
            >
              {t('legal.notice.seeTerms')}
            </LegalLink>
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside
      role="note"
      aria-label={t('legal.notice.title')}
      className={`rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-gray-700 ${className}`}
    >
      <p className="mb-1 flex items-center gap-1 font-semibold text-gray-800">
        <Info className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
        {t('legal.notice.title')}
      </p>
      <ul className="list-disc space-y-0.5 pl-5">
        {NOTICE_KEYS.map((key) => (
          <li key={key}>{t(`legal.notice.${key}`)}</li>
        ))}
      </ul>
      <p className="mt-1">
        <LegalLink
          page="terms"
          onNavigate={onNavigate}
          className="underline text-blue-700 hover:text-blue-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-sm"
        >
          {t('legal.notice.seeTerms')}
        </LegalLink>
      </p>
    </aside>
  );
};

export default RegulatoryNotice;
