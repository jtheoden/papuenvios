/**
 * Compact freshness badge of a rate (ok / warn / blocked / none). It only renders the `state` it is given
 * (Bizum USD->EUR: derived by the server in get_payment_fx_status; other pairs: buildRateStatus) and the
 * status is read once by the parent and passed down, so the badge adds no request. The state is always
 * spelled out as text next to an icon (never colour only). `pair` switches the wording from the Bizum
 * "EUR rate" to "<from> -> <to> rate".
 */

import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { PAYMENT_FX_STATES } from '@/lib/paymentFxService';
import FxStateIcon from './FxStateIcon';

const BADGE_STYLES = {
  [PAYMENT_FX_STATES.OK]: 'border-green-600 bg-green-50 text-green-900',
  [PAYMENT_FX_STATES.WARN]: 'border-amber-500 bg-amber-50 text-amber-900',
  [PAYMENT_FX_STATES.BLOCKED]: 'border-red-600 bg-red-50 text-red-900',
  [PAYMENT_FX_STATES.NONE]: 'border-gray-400 bg-gray-50 text-gray-900'
};

const PaymentFxBadge = ({ status, pair }) => {
  const { t } = useLanguage();
  const state = status?.state;
  if (!BADGE_STYLES[state]) return null;

  return (
    <span
      data-testid="fx-badge"
      data-state={state}
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${BADGE_STYLES[state]}`}
    >
      <FxStateIcon state={state} className="mr-1" />
      {pair
        ? t(`settings.fxRate.generic.badge.${state}`, { from: pair.from, to: pair.to })
        : t(`settings.fxRate.badge.${state}`)}
    </span>
  );
};

export default PaymentFxBadge;
