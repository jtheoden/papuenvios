import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { AlertTriangle } from 'lucide-react';
import { usePendingRemittances } from '@/hooks/usePendingRemittances';
import { useRefundQueue } from '@/hooks/useRefundQueue';
import AdminRemittancesInbox from '@/components/admin/AdminRemittancesInbox';
import AdminRefundsInbox from '@/components/admin/AdminRefundsInbox';

const TAB_ORDERS = 'orders';
const TAB_REMITTANCES = 'remittances';
const TAB_REFUNDS = 'refunds';
// Refunds goes LAST so the default-tab logic and the existing deep links keep their meaning.
const TABS = [TAB_ORDERS, TAB_REMITTANCES, TAB_REFUNDS];

const readTabFromUrl = () => {
  try {
    const value = new URLSearchParams(window.location.search).get('tab');
    return TABS.includes(value) ? value : null;
  } catch {
    return null;
  }
};

const writeTabToUrl = (tab) => {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // URL state is a convenience; the tabs keep working without it.
  }
};

const CountBadge = ({ count, t }) => {
  if (count === null || count === undefined) return null;
  return (
    <>
      <span
        aria-hidden="true"
        className="ml-2 inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-gray-200 px-1.5 text-xs font-semibold text-gray-800"
      >
        {count}
      </span>
      <span className="sr-only">{t('adminInbox.countSr', { count })}</span>
    </>
  );
};

// Same neutral chip as the other tabs; with overdue refunds it turns red and carries an icon + words, never color alone.
const RefundCountBadge = ({ count, overdue, t }) => {
  if (count === null || count === undefined) return null;
  if (!overdue) {
    return (
      <>
        <span
          aria-hidden="true"
          className="ml-2 inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-gray-200 px-1.5 text-xs font-semibold text-gray-800"
        >
          {count}
        </span>
        <span className="sr-only">{t('adminRefunds.tabCountSr', { count })}</span>
      </>
    );
  }
  return (
    <>
      <span
        aria-hidden="true"
        className="ml-2 inline-flex min-w-[1.5rem] items-center justify-center gap-1 rounded-full bg-red-50 px-1.5 text-xs font-semibold text-red-800 ring-1 ring-red-300"
      >
        <AlertTriangle className="h-3.5 w-3.5" />
        {count}
      </span>
      <span className="sr-only">{t('adminRefunds.tabCountOverdueSr', { count, overdue })}</span>
    </>
  );
};

const AdminWorkTabsInner = ({ ordersCount, onNavigate, children, currentUserId = null, isSuperAdmin = false }) => {
  const { t } = useLanguage();
  const baseId = useId();
  const { remittances, loading, error, refreshFailed, toProcessCount, newCount, reload, retry } = usePendingRemittances({ enabled: true });
  const refundQueue = useRefundQueue({ enabled: true });

  const urlTabRef = useRef(readTabFromUrl());
  const decidedRef = useRef(urlTabRef.current !== null);
  const tabRefs = useRef({});
  const [activeTab, setActiveTab] = useState(urlTabRef.current || TAB_ORDERS);

  // Default to the tab that has work: only when the URL did not choose and nothing was picked yet.
  useEffect(() => {
    if (decidedRef.current) return;
    if (ordersCount === null || ordersCount === undefined || loading || refundQueue.loading) return;
    decidedRef.current = true;
    if (ordersCount === 0 && toProcessCount > 0) setActiveTab(TAB_REMITTANCES);
    else if (ordersCount === 0 && toProcessCount === 0 && refundQueue.overdueCount > 0) setActiveTab(TAB_REFUNDS);
  }, [ordersCount, loading, toProcessCount, refundQueue.loading, refundQueue.overdueCount]);

  const selectTab = useCallback((tab, { focus = false } = {}) => {
    decidedRef.current = true;
    setActiveTab(tab);
    writeTabToUrl(tab);
    if (focus) tabRefs.current[tab]?.focus();
  }, []);

  const handleKeyDown = (event) => {
    const index = TABS.indexOf(activeTab);
    let next = null;
    if (event.key === 'ArrowRight') next = TABS[(index + 1) % TABS.length];
    else if (event.key === 'ArrowLeft') next = TABS[(index - 1 + TABS.length) % TABS.length];
    else if (event.key === 'Home') next = TABS[0];
    else if (event.key === 'End') next = TABS[TABS.length - 1];
    if (!next) return;
    event.preventDefault();
    selectTab(next, { focus: true });
  };

  const ids = (tab) => ({ tab: `${baseId}-tab-${tab}`, panel: `${baseId}-panel-${tab}` });
  const counts = { [TAB_ORDERS]: ordersCount, [TAB_REMITTANCES]: loading || error ? null : toProcessCount };
  const labels = {
    [TAB_ORDERS]: t('adminInbox.ordersTab'),
    [TAB_REMITTANCES]: t('adminInbox.remittancesTab'),
    [TAB_REFUNDS]: t('adminRefunds.tab')
  };
  const refundsCount = refundQueue.loading || refundQueue.error ? null : refundQueue.actionableCount;

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label={t('adminInbox.tablistLabel')}
        className="flex flex-wrap gap-2 rounded-2xl bg-white p-2 shadow border border-gray-200"
        onKeyDown={handleKeyDown}
      >
        {TABS.map((tab) => {
          const selected = activeTab === tab;
          return (
            <button
              key={tab}
              ref={(node) => {
                tabRefs.current[tab] = node;
              }}
              type="button"
              role="tab"
              id={ids(tab).tab}
              aria-selected={selected}
              aria-controls={ids(tab).panel}
              tabIndex={selected ? 0 : -1}
              onClick={() => selectTab(tab)}
              className={`inline-flex items-center min-h-[44px] px-4 rounded-xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-600 ${
                selected ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              {labels[tab]}
              {tab === TAB_REFUNDS ? (
                <RefundCountBadge count={refundsCount} overdue={refundQueue.overdueCount} t={t} />
              ) : (
                <CountBadge count={counts[tab]} t={t} />
              )}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={ids(TAB_ORDERS).panel}
        aria-labelledby={ids(TAB_ORDERS).tab}
        hidden={activeTab !== TAB_ORDERS}
      >
        {children}
      </div>

      <div
        role="tabpanel"
        id={ids(TAB_REMITTANCES).panel}
        aria-labelledby={ids(TAB_REMITTANCES).tab}
        hidden={activeTab !== TAB_REMITTANCES}
      >
        {activeTab === TAB_REMITTANCES && (
          <section className="rounded-2xl bg-white p-4 sm:p-8 shadow-lg border border-gray-200">
            <h2 className="mb-4 text-2xl font-semibold">{t('adminInbox.remittancesHeading')}</h2>
            <AdminRemittancesInbox
              remittances={remittances}
              loading={loading}
              error={error}
              onRetry={retry}
              stale={refreshFailed}
              onChanged={reload}
              onNavigate={onNavigate}
              currentUserId={currentUserId}
              liveMessage={newCount > 0 ? t('adminInbox.liveNew', { count: newCount }) : ''}
            />
          </section>
        )}
      </div>

      <div
        role="tabpanel"
        id={ids(TAB_REFUNDS).panel}
        aria-labelledby={ids(TAB_REFUNDS).tab}
        hidden={activeTab !== TAB_REFUNDS}
      >
        {activeTab === TAB_REFUNDS && (
          <section className="rounded-2xl bg-white p-4 sm:p-8 shadow-lg border border-gray-200">
            <h2 className="mb-4 text-2xl font-semibold">{t('adminRefunds.heading')}</h2>
            <AdminRefundsInbox
              refunds={refundQueue.refunds}
              total={refundQueue.total}
              loading={refundQueue.loading}
              error={refundQueue.error}
              onRetry={refundQueue.retry}
              stale={refundQueue.refreshFailed}
              onChanged={refundQueue.reload}
              currentUserId={currentUserId}
              isSuperAdmin={isSuperAdmin}
              liveMessage={refundQueue.newCount > 0 ? t('adminRefunds.states.liveNew', { count: refundQueue.newCount }) : ''}
            />
          </section>
        )}
      </div>
    </div>
  );
};

/**
 * Admin-only wrapper: shows "orders / remittances to process / refunds" tabs around the orders card.
 * For any other role it renders the children untouched and starts no remittance or refund loading.
 */
const AdminWorkTabs = ({ enabled, ...props }) => {
  if (!enabled) return props.children;
  return <AdminWorkTabsInner {...props} />;
};

export default AdminWorkTabs;
