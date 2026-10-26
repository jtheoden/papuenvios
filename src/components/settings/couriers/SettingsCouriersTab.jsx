/**
 * Settings > Messaging (couriers). Four inner tabs following the AdminWorkTabs pattern (PaymentsTabs, `?courierTab=`).
 * The front is deployed before the migrations: while the module's tables/RPCs do not exist the tab shows a calm
 * "not available yet" note (no error, no console noise) and the service retries every 5 minutes.
 */
import React, { useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAsyncResource } from '@/hooks/useAsyncResource';
import { listCouriers } from '@/lib/courierService';
import PaymentsTabs from '@/components/settings/PaymentsTabs';
import { Btn, Notice, errorText } from './courierUi';
import CouriersPanel from './CouriersPanel';
import PaymentTypesPanel from './PaymentTypesPanel';
import PayablePanel from './PayablePanel';
import ReportsPanel from './ReportsPanel';

export const COURIER_TAB_PARAM = 'courierTab';
const RETRY_MS = 5 * 60 * 1000;

const SettingsCouriersTab = () => {
  const { t } = useLanguage();
  const probe = useAsyncResource(listCouriers);

  // Applying the migrations is picked up without a reload: while unavailable, look again every 5 minutes.
  const unavailable = probe.data?.available === false;
  const { reload } = probe;
  useEffect(() => {
    if (!unavailable) return undefined;
    const timer = setInterval(reload, RETRY_MS);
    return () => clearInterval(timer);
  }, [unavailable, reload]);

  if (probe.loading && !probe.data) return <p role="status" className="text-sm text-gray-700">{t('couriers.loading')}</p>;
  if (probe.error && !probe.data) {
    return (
      <div className="space-y-2">
        <Notice tone="error">{errorText(t, probe.error)}</Notice>
        <Btn onClick={probe.reload}>{t('couriers.common.retry')}</Btn>
      </div>
    );
  }
  if (probe.data && !probe.data.available) {
    return <Notice tone="info" testId="couriers-unavailable">{t('couriers.unavailable')}</Notice>;
  }

  const couriers = probe.data?.items ?? [];
  const tabs = [
    { id: 'couriers', label: t('couriers.tabs.couriers'), render: () => <CouriersPanel couriers={couriers} onChanged={probe.reload} /> },
    { id: 'types', label: t('couriers.tabs.types'), render: () => <PaymentTypesPanel couriers={couriers} /> },
    { id: 'payable', label: t('couriers.tabs.payable'), render: () => <PayablePanel couriers={couriers} /> },
    { id: 'reports', label: t('couriers.tabs.reports'), render: () => <ReportsPanel couriers={couriers} /> }
  ];

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">{t('couriers.title')}</h2>
      <PaymentsTabs ariaLabel={t('couriers.tabs.label')} tabs={tabs} param={COURIER_TAB_PARAM} />
    </div>
  );
};

export default SettingsCouriersTab;
