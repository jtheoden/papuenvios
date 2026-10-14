/**
 * Inline "payments temporarily unavailable" state for checkout.
 *
 * variant="blocking"    : shown instead of letting the customer start a checkout.
 * variant="midCheckout" : the switch was flipped while the customer already filled
 *                         the form; the form stays intact and only the final submit
 *                         is blocked by the caller.
 */

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

const PaymentMethodsUnavailable = ({ flow = 'orders', variant = 'blocking', className = '' }) => {
  const { t } = useLanguage();

  const message =
    variant === 'midCheckout'
      ? t('paymentMethods.checkout.midCheckout')
      : flow === 'remittances'
        ? t('paymentMethods.checkout.unavailableRemittances')
        : t('paymentMethods.checkout.unavailableOrders');

  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900 ${className}`}
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden="true" />
      <div className="space-y-1">
        <p className="font-semibold">{t('paymentMethods.checkout.unavailableTitle')}</p>
        <p className="text-sm">{message}</p>
      </div>
    </div>
  );
};

export default PaymentMethodsUnavailable;
