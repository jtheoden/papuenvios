import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { usePendingRemittances } from '@/hooks/usePendingRemittances';
import AdminRemittancesInbox from '@/components/admin/AdminRemittancesInbox';

const TAB_ORDERS = 'orders';
const TAB_REMITTANCES = 'remittances';
const TABS = [TAB_ORDERS, TAB_REMITTANCES];

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

const AdminWorkTabsInner = ({ ordersCount, onNavigate, children }) => {
  const { t } = useLanguage();
  const baseId = useId();
  const { remittances, loading, error, refreshFailed, toProcessCount, newCount, reload, retry } = usePendingRemittances({ enabled: true });

  const urlTabRef = useRef(readTabFromUrl());
  const decidedRef = useRef(urlTabRef.current !== null);
  const tabRefs = useRef({});
  const [activeTab, setActiveTab] = useState(urlTabRef.current || TAB_ORDERS);

  // Default to the tab that has work: only when the URL did not choose and nothing was picked yet.
  useEffect(() => {
    if (decidedRef.current) return;
    if (ordersCount === null || ordersCount === undefined || loading) return;
    decidedRef.current = true;
    if (ordersCount === 0 && toProcessCount > 0) setActiveTab(TAB_REMITTANCES);
  }, [ordersCount, loading, toProcessCount]);

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
  const labels = { [TAB_ORDERS]: t('adminInbox.ordersTab'), [TAB_REMITTANCES]: t('adminInbox.remittancesTab') };

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
              <CountBadge count={counts[tab]} t={t} />
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
              liveMessage={newCount > 0 ? t('adminInbox.liveNew', { count: newCount }) : ''}
            />
          </section>
        )}
      </div>
    </div>
  );
};

/**
 * Admin-only wrapper: shows "orders / remittances to process" tabs around the orders card.
 * For any other role it renders the children untouched and starts no remittance loading.
 */
const AdminWorkTabs = ({ enabled, ...props }) => {
  if (!enabled) return props.children;
  return <AdminWorkTabsInner {...props} />;
};

export default AdminWorkTabs;
