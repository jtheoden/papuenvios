/**
 * Compact freshness badge of the Bizum USD->EUR rate (ok / warn / blocked / none). It only renders the
 * `state` the server derived in get_payment_fx_status; the status is read once by the Bizum section and
 * passed down, so the badge adds no request. The state is always spelled out as text (never colour only).
 */

import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { PAYMENT_FX_STATES } from '@/lib/paymentFxService';

const BADGE_STYLES = {
  [PAYMENT_FX_STATES.OK]: 'border-green-600 bg-green-50 text-green-900',
  [PAYMENT_FX_STATES.WARN]: 'border-amber-500 bg-amber-50 text-amber-900',
  [PAYMENT_FX_STATES.BLOCKED]: 'border-red-600 bg-red-50 text-red-900',
  [PAYMENT_FX_STATES.NONE]: 'border-gray-400 bg-gray-50 text-gray-900'
};

const PaymentFxBadge = ({ status }) => {
  const { t } = useLanguage();
  const state = status?.state;
  if (!BADGE_STYLES[state]) return null;

  return (
    <span
      data-testid="fx-badge"
      data-state={state}
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${BADGE_STYLES[state]}`}
    >
      {t(`settings.fxRate.badge.${state}`)}
    </span>
  );
};

export default PaymentFxBadge;
