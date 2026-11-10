import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import PaymentRateBadge from '@/components/settings/PaymentRateBadge';

/** The two direct EUR conversion rates used to evaluate EUR-funded payment methods. */
export default function EurPaymentRateBadges({ className = '' }) {
  const { language } = useLanguage();
  return (
    <div
      className={`flex flex-wrap items-center gap-2 ${className}`}
      aria-label={language === 'en' ? 'EUR conversion rates' : 'Tasas de conversión EUR'}
      data-testid="eur-payment-rate-badges"
    >
      <PaymentRateBadge sourceCurrency="EUR" targetCurrency="USD" language={language} />
      <PaymentRateBadge sourceCurrency="EUR" targetCurrency="CUP" language={language} />
    </div>
  );
}
