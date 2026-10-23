import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import LegalContact from '@/components/LegalContact';
import { REFUND_BUSINESS_DAYS } from '@/lib/legalConfig';
import { pageToPath } from '@/lib/routes';

/**
 * Body of the "cancel" confirmation when money may already have been sent. Mirrors Terms section 9
 * (refund days come from legalConfig). Rendered as the showModal message, so it must stay a plain node tree.
 */
const CancelRefundMessage = ({ question, noteKey }) => {
  const { t, language } = useLanguage();
  return (
    <>
      <span className="block">{question}</span>
      <span className="block mt-3 text-sm">{t(noteKey, { days: REFUND_BUSINESS_DAYS })}</span>
      <span className="block mt-2 text-sm">
        <a href={`${pageToPath('terms')}#refunds`} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
          {t('remittances.user.cancelTermsLink')}
        </a>
        {' · '}
        {t('remittances.user.cancelContactPrefix')} <LegalContact es={language === 'es'} />
      </span>
    </>
  );
};

export default CancelRefundMessage;
