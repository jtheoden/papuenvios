import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import EurPaymentRateBadges from '@/components/settings/EurPaymentRateBadges';
import PaymentMethodOverview from '@/components/settings/PaymentMethodOverview';

/** Read-only rollout status: IBAN is deliberately not activatable until collection is implemented. */
export default function SettingsIbanStatus() {
  const { t } = useLanguage();

  return (
    <section
      aria-labelledby="iban-rollout-title"
      className="mb-6 space-y-4"
      data-testid="iban-rollout-status"
    >
      <PaymentMethodOverview
        id="iban-rollout-title"
        title={t('settings.payments.ibanStatus.title')}
        description={t('settings.payments.ibanStatus.description')}
        rates={<EurPaymentRateBadges />}
        status={(
          <span className="rounded-full border border-theme-accent-line bg-theme-accent-soft px-3 py-1 text-xs font-semibold text-theme-on-accent">
            {t('settings.payments.ibanStatus.unavailable')}
          </span>
        )}
      />
      <p className="rounded-lg border border-theme-accent-line bg-white/70 p-4 text-sm text-gray-800">
        {t('settings.payments.ibanStatus.blocker')}
      </p>
      <section aria-labelledby="iban-accounts-title" className="space-y-2 rounded-xl border border-theme-accent-line bg-white/70 p-4 sm:p-5">
        <h4 id="iban-accounts-title" className="font-semibold text-gray-900">
          {t('settings.payments.ibanAccounts.title')}
        </h4>
        <p className="text-sm text-gray-700">
          {t('settings.payments.ibanAccounts.description')}
        </p>
        <ul className="list-inside list-disc space-y-1 text-sm text-gray-700">
          <li>{t('settings.payments.ibanAccounts.limits')}</li>
          <li>{t('settings.payments.ibanAccounts.routing')}</li>
        </ul>
        <p role="status" className="rounded-md border border-theme-accent-line bg-theme-accent-soft p-3 text-sm text-theme-on-accent">
          {t('settings.payments.ibanAccounts.unavailable')}
        </p>
      </section>
    </section>
  );
}
