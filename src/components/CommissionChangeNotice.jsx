import React from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { calcCommissionChange } from '@/lib/commissionProposalRules';

const KEY = 'remittances.commissionChange';
const BUTTON =
  'min-h-[44px] w-full sm:w-auto px-4 py-2 rounded-lg text-sm font-medium transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-600 ' +
  'disabled:opacity-60 disabled:cursor-not-allowed';

const money = (value, currency) => `${Number(value).toFixed(2)} ${currency}`;

/**
 * Customer-facing notice of an admin commission change on a remittance that is not paid yet.
 *  - pending raise: polite live region (one per card, so not role=alert) with before -> now, Accept / Cancel remittance (the admin's reason is never shown).
 *  - informed decrease: polite status, dismissible.
 * Presentational: the page owns the accept / cancel / dismiss behavior.
 */
const CommissionChangeNotice = ({ remittance, proposal, busy = false, error = null, onAccept, onDecline, onDismiss }) => {
  const { t } = useLanguage();
  const change = calcCommissionChange(remittance, proposal);
  const sent = remittance.currency_sent;
  const delivered = remittance.currency_delivered;
  const titleId = `commission-notice-${proposal.id}`;

  if (proposal.status === 'informed') {
    return (
      <section role="status" aria-labelledby={titleId} className="mb-4 p-3 sm:p-4 rounded-lg border border-green-300 bg-green-50 text-green-900">
        <div className="flex items-start gap-2">
          <Info className="h-5 w-5 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h3 id={titleId} className="text-sm font-semibold">
              {t(`${KEY}.informedTitle`, { number: remittance.remittance_number })}
            </h3>
            <p className="text-sm mt-1">
              {t(`${KEY}.informedBody`, { amount: Number(change.newReceives).toFixed(2), currency: delivered })}
            </p>
          </div>
        </div>
        <div className="mt-3 flex sm:justify-end">
          <button type="button" onClick={onDismiss} className={`${BUTTON} border border-green-700 text-green-900 hover:bg-green-100`}>
            {t(`${KEY}.dismiss`)}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      role="status"
      aria-labelledby={titleId}
      aria-live="polite"
      aria-busy={busy ? 'true' : 'false'}
      className="mb-4 p-3 sm:p-4 rounded-lg border-2 border-amber-500 bg-amber-50 text-amber-950"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="text-sm sm:text-base font-semibold">
            {t(`${KEY}.title`, { number: remittance.remittance_number })}
          </h3>
          <p className="text-sm mt-1">
            {t(`${KEY}.intro`, {
              oldCommission: Number(change.oldCommission).toFixed(2),
              newCommission: Number(change.newCommission).toFixed(2),
              currency: sent,
            })}
          </p>
          <dl aria-label={t(`${KEY}.listLabel`)} className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="font-medium">{t(`${KEY}.commission`)}</dt>
              <dd>
                <span className="block">{t(`${KEY}.before`)}: {money(change.oldCommission, sent)}</span>
                <span className="block font-semibold">{t(`${KEY}.after`)}: {money(change.newCommission, sent)}</span>
              </dd>
            </div>
            <div>
              <dt className="font-medium">{t(`${KEY}.recipientReceives`)}</dt>
              <dd>
                <span className="block">{t(`${KEY}.before`)}: {money(change.oldReceives, delivered)}</span>
                <span className="block font-semibold">{t(`${KEY}.after`)}: {money(change.newReceives, delivered)}</span>
              </dd>
            </div>
            <div>
              <dt className="font-medium">{t(`${KEY}.youPay`)}</dt>
              <dd>{t(`${KEY}.unchanged`)}</dd>
            </div>
          </dl>
          <p className="text-sm mt-3">{t(`${KEY}.acceptHint`)}</p>
          {error && <p className="text-sm mt-2 font-medium text-red-800">{error}</p>}
        </div>
      </div>
      <div className="mt-3 flex flex-col sm:flex-row sm:justify-end gap-2">
        <button type="button" onClick={onDecline} disabled={busy} className={`${BUTTON} border border-red-700 text-red-800 hover:bg-red-50`}>
          {t(`${KEY}.decline`)}
        </button>
        <button type="button" onClick={onAccept} disabled={busy} className={`${BUTTON} bg-blue-700 text-white hover:bg-blue-800`}>
          {busy ? t(`${KEY}.accepting`) : t(`${KEY}.accept`)}
        </button>
      </div>
    </section>
  );
};

export default CommissionChangeNotice;
