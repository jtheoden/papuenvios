/**
 * Settings > Payments. The status card (one switch per method and flow) applies to every method, so it
 * sits above the inner tabs; Zelle and Bizum each live in their own tab. Bizum stays a sibling of Zelle,
 * never inside it, and mounts only once opened, so a Bizum failure cannot affect Zelle (R-01).
 *
 * The Bizum tab follows the same rules that used to hide the section: no tab while the catalog is
 * loading, has no `bizum` row or reports the schema as not deployed; and, once the catalog has the row,
 * none while the first Bizum probe (get_bizum_settings) is in flight or says the Bizum objects are not
 * deployed (migrations not applied). Any other failure keeps the tab so the section's own error and
 * retry stay reachable. The probe is a read whose failure is caught by useAsyncResource, so it cannot
 * affect Zelle; the heavier reads (FX status, accounts) still wait until the tab is opened.
 */

import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { usePaymentMethods } from '@/hooks/usePaymentMethods';
import { useAsyncResource } from '@/hooks/useAsyncResource';
import { PAYMENT_METHOD_CODES } from '@/lib/paymentMethodsService';
import { getBizumSettings } from '@/lib/bizumService';
import { isBizumSchemaMissing } from '@/lib/bizumErrors';
import PaymentMethodsStatusCard from '@/components/settings/PaymentMethodsStatusCard';
import PaymentsTabs from '@/components/settings/PaymentsTabs';
import SettingsZelleTab from '@/components/settings/SettingsZelleTab';
import SettingsBizumSection from '@/components/settings/SettingsBizumSection';

const isFirstLoad = (resource) => resource.loading && resource.data === null && !resource.error;

const catalogState = ({ methods, error }) => {
  if (methods) return methods.some((method) => method.code === PAYMENT_METHOD_CODES.BIZUM) ? 'present' : 'absent';
  if (!error) return 'absent';
  return error?.context?.schemaMissing || isBizumSchemaMissing(error) ? 'absent' : 'failed';
};

const SettingsPaymentsTab = () => {
  const { t } = useLanguage();
  const { methods, error } = usePaymentMethods({ admin: true });
  const catalog = catalogState({ methods, error });
  // 'failed' keeps the tab so the section can show its own error; 'present' needs the schema probe.
  const probe = useAsyncResource(getBizumSettings, { enabled: catalog === 'present' });

  const schemaDeployed = !(probe.data === null && probe.error?.schemaMissing);
  const showBizum = catalog === 'failed' || (catalog === 'present' && !isFirstLoad(probe) && schemaDeployed);

  const tabs = [
    { id: 'zelle', label: t('settings.payments.tabs.zelle'), render: () => <SettingsZelleTab /> }
  ];
  if (showBizum) {
    tabs.push({ id: 'bizum', label: t('settings.payments.tabs.bizum'), render: () => <SettingsBizumSection /> });
  }

  return (
    <>
      <PaymentMethodsStatusCard />
      <PaymentsTabs ariaLabel={t('settings.payments.tabs.label')} tabs={tabs} />
    </>
  );
};

export default SettingsPaymentsTab;
