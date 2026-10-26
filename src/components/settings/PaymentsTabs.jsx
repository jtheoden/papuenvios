/**
 * Inner tabs of Settings > Payments (Zelle | Bizum). Same accessibility contract as AdminWorkTabs:
 * hand-written ARIA (tablist / tab / tabpanel, roving tabindex), ArrowLeft / ArrowRight (wrapping),
 * Home / End, and the selected tab mirrored in `?paymentsTab=` with replaceState (no history entries,
 * no localStorage).
 *
 * - A tab is mounted the first time it is selected and then kept mounted (hidden), so a failing or slow
 *   tab never runs, or breaks, work belonging to another one.
 * - With a single tab there is nothing to choose: its content is rendered as is, without a tablist.
 *
 * @param {{
 *   ariaLabel: string,
 *   param?: string (query parameter that mirrors the selected tab; default `paymentsTab`),
 *   tabs: Array<{id: string, label: string, badge?: {text: string, srText?: string}, render: () => React.ReactNode}>
 * }} props
 */

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';

export const PAYMENTS_TAB_PARAM = 'paymentsTab';

const readTabFromUrl = (param) => {
  try {
    return new URLSearchParams(window.location.search).get(param);
  } catch {
    return null;
  }
};

const writeTabToUrl = (param, tab) => {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set(param, tab);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // URL state is a convenience; the tabs keep working without it.
  }
};

const TabBadge = ({ badge }) => {
  if (!badge?.text) return null;
  return (
    <>
      <span
        aria-hidden="true"
        className="ml-2 inline-flex items-center justify-center rounded-full bg-amber-100 px-2 text-xs font-semibold text-amber-900 border border-amber-500"
      >
        {badge.text}
      </span>
      {badge.srText && <span className="sr-only">{badge.srText}</span>}
    </>
  );
};

const PaymentsTabs = ({ ariaLabel, tabs, param = PAYMENTS_TAB_PARAM }) => {
  const baseId = useId();
  const tabRefs = useRef({});
  const ids = tabs.map((tab) => tab.id);
  const firstId = ids[0];

  // The URL may name a tab that is not available yet (the catalog loads asynchronously): keep the
  // request and honour it as soon as the tab shows up.
  const [selected, setSelected] = useState(() => readTabFromUrl(param) ?? firstId);
  const [visited, setVisited] = useState(() => new Set());
  const seenRef = useRef(new Set());

  const activeId = ids.includes(selected) ? selected : firstId;

  // A tab that was available and then disappears (e.g. Bizum removed): settle on the first one for good.
  useEffect(() => {
    const seen = seenRef.current;
    const wasAvailable = seen.has(selected);
    ids.forEach((id) => seen.add(id));
    if (firstId !== undefined && !ids.includes(selected) && wasAvailable) setSelected(firstId);
  }, [firstId, ids, selected]);

  // Mount a tab the first time it is shown (the initial one included) and keep it mounted afterwards.
  useEffect(() => {
    setVisited((prev) => (prev.has(activeId) ? prev : new Set(prev).add(activeId)));
  }, [activeId]);

  const selectTab = useCallback((id, { focus = false } = {}) => {
    setSelected(id);
    writeTabToUrl(param, id);
    if (focus) tabRefs.current[id]?.focus();
  }, [param]);

  if (tabs.length === 0) return null;
  if (tabs.length === 1) return <>{tabs[0].render()}</>;

  const handleKeyDown = (event) => {
    const index = ids.indexOf(activeId);
    let next = null;
    if (event.key === 'ArrowRight') next = ids[(index + 1) % ids.length];
    else if (event.key === 'ArrowLeft') next = ids[(index - 1 + ids.length) % ids.length];
    else if (event.key === 'Home') next = ids[0];
    else if (event.key === 'End') next = ids[ids.length - 1];
    if (!next) return;
    event.preventDefault();
    selectTab(next, { focus: true });
  };

  const idsFor = (id) => ({ tab: `${baseId}-tab-${id}`, panel: `${baseId}-panel-${id}` });

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label={ariaLabel}
        className="flex flex-wrap gap-2 rounded-2xl bg-white p-2 shadow border border-gray-200"
        onKeyDown={handleKeyDown}
      >
        {tabs.map((tab) => {
          const isSelected = activeId === tab.id;
          return (
            <button
              key={tab.id}
              ref={(node) => {
                tabRefs.current[tab.id] = node;
              }}
              type="button"
              role="tab"
              id={idsFor(tab.id).tab}
              aria-selected={isSelected}
              aria-controls={idsFor(tab.id).panel}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => selectTab(tab.id)}
              className={`inline-flex items-center min-h-[44px] px-4 rounded-xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-600 ${
                isSelected ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              {tab.label}
              <TabBadge badge={tab.badge} />
            </button>
          );
        })}
      </div>

      {tabs.map((tab) => {
        const isSelected = activeId === tab.id;
        const mounted = isSelected || visited.has(tab.id);
        return (
          <div
            key={tab.id}
            role="tabpanel"
            id={idsFor(tab.id).panel}
            aria-labelledby={idsFor(tab.id).tab}
            hidden={!isSelected}
          >
            {mounted && tab.render()}
          </div>
        );
      })}
    </div>
  );
};

export default PaymentsTabs;
