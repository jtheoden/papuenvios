/**
 * Bizum section of the payments tab (Settings). Rendered next to, never inside, the Zelle tab so a
 * Bizum failure cannot affect Zelle (R-01):
 *   - catalog without the `bizum` row (or still loading / not deployed) -> nothing is rendered;
 *   - catalog or Bizum data failing for any other reason -> an error state of its own;
 *   - Bizum objects missing in the database (migrations not applied) -> the section is hidden, which
 *     is today's behaviour. The row is gated on its presence, never on `available`: admins must be
 *     able to configure Bizum before it is switched on.
 */

import React from 'react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { usePaymentMethods } from '@/hooks/usePaymentMethods';
import { useAsyncResource } from '@/hooks/useAsyncResource';
import { PAYMENT_METHOD_CODES } from '@/lib/paymentMethodsService';
import { getBizumSettings, listBizumAccounts } from '@/lib/bizumService';
import { getPaymentFxStatus } from '@/lib/paymentFxService';
import { isBizumSchemaMissing } from '@/lib/bizumErrors';
import BizumErrorBoundary from '@/components/settings/BizumErrorBoundary';
import PaymentFxRateCard from '@/components/settings/PaymentFxRateCard';
import PaymentFxBadge from '@/components/settings/PaymentFxBadge';
import BizumSettingsCard from '@/components/settings/BizumSettingsCard';
import BizumAccountsTable from '@/components/settings/BizumAccountsTable';

const SectionShell = ({ badge = null, children }) => {
  const { t } = useLanguage();
  return (
    <section aria-labelledby="bizum-section-title" className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 id="bizum-section-title" className="text-xl font-semibold text-gray-900 sm:text-2xl">
            {t('settings.bizum.title')}
          </h2>
          {badge}
        </div>
        <p className="mt-1 text-sm text-gray-700">{t('settings.bizum.intro')}</p>
      </div>
      {children}
    </section>
  );
};

const isInitialLoad = (resource) => resource.loading && resource.data === null && !resource.error;
// Hide only what is certainly not deployed AND was never loaded: a later reload error is shown, not hidden.
const isMissing = (resource) => resource.data === null && Boolean(resource.error?.schemaMissing);

const BizumPanel = ({ onGoToFinancial }) => {
  // Sequential probe: with the schema absent (production today) a single call is made.
  const settings = useAsyncResource(getBizumSettings);
  const probed = !isInitialLoad(settings);
  const enabled = probed && !isMissing(settings);
  const fx = useAsyncResource(getPaymentFxStatus, { enabled });
  const accounts = useAsyncResource(listBizumAccounts, { enabled });

  if (!enabled || isInitialLoad(fx) || isInitialLoad(accounts)) return null;

  return (
    <SectionShell badge={isMissing(fx) ? null : <PaymentFxBadge status={fx.data} />}>
      {!isMissing(fx) && (
        <PaymentFxRateCard status={fx.data} error={fx.error} onRetry={fx.reload} onGoToFinancial={onGoToFinancial} />
      )}
      <BizumSettingsCard
        settings={settings.data}
        error={settings.error}
        onSaved={(saved) => {
          settings.setData(saved);
          // fx_warn_hours / fx_block_hours may have changed: re-read the state the server derives.
          if (!isMissing(fx)) fx.reload();
        }}
        onRetry={settings.reload}
      />
      {!isMissing(accounts) && (
        <BizumAccountsTable
          accounts={accounts.data ?? []}
          error={accounts.error}
          defaultLimit={settings.data?.default_per_operation_limit}
          onChanged={accounts.reload}
          onRetry={accounts.reload}
        />
      )}
    </SectionShell>
  );
};

const SettingsBizumSectionContent = ({ onGoToFinancial }) => {
  const { t } = useLanguage();
  const { methods, error, refresh } = usePaymentMethods({ admin: true });

  if (!methods) {
    if (!error) return null;
    if (error?.context?.schemaMissing || isBizumSchemaMissing(error)) return null;
    return (
      <SectionShell>
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-red-600 bg-red-50 p-4 text-sm text-red-900">
          <span>{t('settings.bizum.loadError')}</span>
          <Button variant="outline" size="lg" onClick={refresh}>
            {t('settings.bizum.retry')}
          </Button>
        </div>
      </SectionShell>
    );
  }

  if (!methods.some((method) => method.code === PAYMENT_METHOD_CODES.BIZUM)) return null;
  return <BizumPanel onGoToFinancial={onGoToFinancial} />;
};

const SettingsBizumSection = ({ onGoToFinancial }) => (
  <BizumErrorBoundary>
    <SettingsBizumSectionContent onGoToFinancial={onGoToFinancial} />
  </BizumErrorBoundary>
);

export default SettingsBizumSection;
