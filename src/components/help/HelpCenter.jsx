import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getHelpSectionForPage, getHelpSectionsForRole } from '@/lib/helpContent';
import { FINANCIAL_RISK_WARNING_EVENT } from '@/lib/financialRiskWarnings';

const AVATAR_URL = '/images/superadmin-chatbot-avatar.png';

export default function HelpCenter({ userRole, language = 'es', t, currentPage }) {
  const [open, setOpen] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState(null);
  const [search, setSearch] = useState('');
  const [routeTab, setRouteTab] = useState(() => new URLSearchParams(window.location.search).get('tab'));
  const [detailTab, setDetailTab] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('courierTab') || params.get('paymentsTab');
  });
  const [financialWarning, setFinancialWarning] = useState(null);
  const sections = useMemo(() => getHelpSectionsForRole(userRole), [userRole]);
  const isSpanish = language !== 'en';
  // Follow the active admin area by default; category navigation remains available.
  const pageSection = getHelpSectionForPage(currentPage, routeTab, detailTab);
  const defaultPageSection = getHelpSectionForPage(currentPage);
  const activeSection = sections.find(section => section.id === activeSectionId)
    || sections.find(section => section.id === pageSection)
    || sections.find(section => section.id === defaultPageSection)
    || sections[0];

  useEffect(() => {
    setActiveSectionId(null);
    setSearch('');
    setRouteTab(new URLSearchParams(window.location.search).get('tab'));
    const params = new URLSearchParams(window.location.search);
    setDetailTab(params.get('courierTab') || params.get('paymentsTab'));
  }, [currentPage]);

  useEffect(() => {
    const syncTabs = () => {
      const params = new URLSearchParams(window.location.search);
      setRouteTab(params.get('tab'));
      setDetailTab(params.get('courierTab') || params.get('paymentsTab'));
    };
    window.addEventListener('admin-tab-change', syncTabs);
    window.addEventListener('popstate', syncTabs);
    return () => {
      window.removeEventListener('admin-tab-change', syncTabs);
      window.removeEventListener('popstate', syncTabs);
    };
  }, []);

  useEffect(() => {
    const onFinancialRisk = event => {
      const warning = event?.detail;
      if (!warning?.title || !warning?.message) return;
      setFinancialWarning(warning);
      setOpen(true);
    };
    window.addEventListener(FINANCIAL_RISK_WARNING_EVENT, onFinancialRisk);
    return () => window.removeEventListener(FINANCIAL_RISK_WARNING_EVENT, onFinancialRisk);
  }, []);
  const entries = useMemo(() => {
    const query = search.trim().toLocaleLowerCase(isSpanish ? 'es' : 'en');
    if (!query) return activeSection?.entries || [];
    return (activeSection?.entries || []).filter(entry =>
      `${entry.question[isSpanish ? 'es' : 'en']} ${entry.answer[isSpanish ? 'es' : 'en']}`
        .toLocaleLowerCase(isSpanish ? 'es' : 'en').includes(query)
    );
  }, [activeSection, search, isSpanish]);

  useEffect(() => {
    if (!sections.length) return undefined;
    const onKeyDown = event => {
      if (event.key === 'F1') {
        event.preventDefault();
        setOpen(value => !value);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sections.length]);

  if (!sections.length) return null;

  const label = t('helpCenter.trigger');

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      {typeof document !== 'undefined' && createPortal(
        <Dialog.Trigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={label}
            title={`${label} (F1)`}
            data-testid="help-center-floating-trigger"
            className="fixed bottom-36 right-4 z-[70] h-14 w-14 overflow-hidden rounded-full border-2 p-0 shadow-xl ring-2 ring-white/90 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 sm:bottom-24 sm:right-6"
            style={{ borderColor: 'var(--brand-button-bg, #2563eb)', backgroundColor: 'var(--brand-button-bg, #2563eb)' }}
          >
            <img src={AVATAR_URL} alt="" className="h-full w-full rounded-full object-cover" />
            {financialWarning && (
              <span
                data-testid="financial-risk-indicator"
                aria-label={isSpanish ? 'Advertencia financiera pendiente' : 'Pending financial warning'}
                className="absolute -right-0.5 -top-0.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white"
                style={{ backgroundColor: 'hsl(var(--destructive, 0 72% 51%))', color: 'hsl(var(--destructive-foreground, 0 0% 100%))' }}
              >
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            )}
            <span className="sr-only">{label}</span>
          </Button>
        </Dialog.Trigger>,
        document.body
      )}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[81] flex max-h-[85vh] w-[min(92vw,760px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl focus:outline-none" style={{ borderColor: 'var(--brand-border, #e5e7eb)' }}>
          <div className="flex items-center gap-3 border-b border-gray-200 p-4 sm:p-5">
            <img src={AVATAR_URL} alt="" className="h-12 w-12 rounded-full object-cover" />
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-lg font-semibold" style={{ color: 'var(--brand-ink, #111827)' }}>
                {t('helpCenter.title')}
              </Dialog.Title>
              <Dialog.Description className="text-sm" style={{ color: 'var(--brand-muted-text, #4b5563)' }}>
                {t('helpCenter.description')}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label={t('helpCenter.close')}>
                <X className="h-4 w-4" />
              </Button>
            </Dialog.Close>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 sm:grid-cols-[190px_1fr]">
            <nav aria-label={t('helpCenter.topics')} className="flex gap-2 overflow-x-auto border-b p-3 sm:flex-col sm:border-b-0 sm:border-r sm:p-4" style={{ borderColor: 'var(--brand-border, #e5e7eb)' }}>
              {sections.map(section => {
                const active = activeSection?.id === section.id;
                return (
                  <button
                    key={section.id}
                    type="button"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => { setActiveSectionId(section.id); setSearch(''); }}
                    className={`shrink-0 rounded-lg px-3 py-2 text-left text-sm transition-colors ${active ? 'font-semibold' : 'text-gray-700 hover:bg-gray-100'}`}
                    style={active
                      ? { backgroundColor: 'var(--brand-button-bg, #2563eb)', color: 'var(--brand-button-text, #ffffff)' }
                      : { color: 'var(--brand-muted-text, #4b5563)' }}
                  >
                    {section.title[isSpanish ? 'es' : 'en']}
                  </button>
                );
              })}
            </nav>

            <section className="min-h-0 overflow-y-auto p-4 sm:p-5" aria-label={activeSection?.title[isSpanish ? 'es' : 'en']}>
              {financialWarning && (
                <div
                  role="alert"
                  data-testid="financial-risk-warning"
                  className="mb-4 rounded-xl border-2 p-4 shadow-sm"
                  style={{
                    borderColor: 'hsl(var(--destructive, 0 72% 51%))',
                    backgroundColor: 'hsl(var(--destructive, 0 72% 51%) / 0.08)',
                    color: 'hsl(var(--destructive, 0 72% 36%))'
                  }}
                >
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: 'hsl(var(--destructive, 0 72% 51%))', color: 'hsl(var(--destructive-foreground, 0 0% 100%))' }}>
                      <AlertTriangle className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 className="font-bold">{financialWarning.title}</h2>
                      <p className="mt-1 text-sm leading-6">{financialWarning.message}</p>
                      {financialWarning.impact && <p className="mt-2 text-sm font-semibold">{financialWarning.impact}</p>}
                    </div>
                    <button type="button" onClick={() => setFinancialWarning(null)} className="rounded p-1" aria-label={isSpanish ? 'Cerrar advertencia' : 'Dismiss warning'}>
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              )}
              <label className="sr-only" htmlFor="help-search">{t('helpCenter.searchLabel')}</label>
              <input
                id="help-search"
                type="search"
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder={t('helpCenter.searchPlaceholder')}
                className="mb-4 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-offset-1"
                style={{ '--tw-ring-color': 'var(--brand-focus-ring, #2563eb)', borderColor: 'var(--brand-border, #d1d5db)' }}
              />
              {entries.length ? (
                <div className="space-y-3">
                  {entries.map(entry => (
                    <article key={entry.id} className="rounded-xl border border-gray-200 p-4">
                      <h3 className="font-semibold text-gray-900">{entry.question[isSpanish ? 'es' : 'en']}</h3>
                      <p className="mt-2 text-sm leading-6 text-gray-700">{entry.answer[isSpanish ? 'es' : 'en']}</p>
                      {entry.visualExamples?.map(example => (
                        <figure key={example.src} className="mt-4 overflow-hidden rounded-lg border border-gray-200">
                          <img
                            src={example.src}
                            alt={example.alt?.[isSpanish ? 'es' : 'en'] || ''}
                            loading="lazy"
                            className="h-auto w-full object-contain"
                          />
                        </figure>
                      ))}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-600">{t('helpCenter.noResults')}</p>
              )}
              <p className="mt-5 text-xs" style={{ color: 'var(--brand-muted-text, #6b7280)' }}>
                {t('helpCenter.disclaimer')}
              </p>
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
