import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';

// Request budget of an admin tab left open for one simulated hour (Supabase Free plan: 5 GB egress).
// The REAL supabase client and services run over a counting fetch, so this file also measures `main`
// (BUDGET_REPORT=1 prints the numbers). Realtime is silenced: the worst case, every refresh comes from polling.
const auth = vi.hoisted(() => ({
  value: { user: { id: 'admin-1', email: 'a@b.c' }, isAdmin: true, isSuperAdmin: false, userRole: 'admin', userCategory: 'regular', roleStatus: 'resolved', roleFetchFailed: false, retryRoleResolution: () => {}, logout: () => {} }
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth.value }));
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ language: 'es', setLanguage: () => {}, t: (key) => key })
}));
vi.mock('@/contexts/BusinessContext', () => ({
  useBusiness: () => ({ cart: [], visualSettings: {}, products: [], combos: [], financialSettings: { productProfit: 40 } })
}));
vi.mock('@/hooks/useRealtimeSubscription', () => ({
  useRealtimeOrders: () => ({ isSubscribed: true }),
  useRealtimeRemittances: () => ({ isSubscribed: true }),
  useRealtimeSubscription: () => ({ isSubscribed: true })
}));
vi.mock('@/components/ui/use-toast', () => ({ toast: () => {}, useToast: () => ({ toast: () => {} }) }));
vi.mock('@/components/ui/user-avatar', () => ({ UserAvatar: () => null }));
vi.mock('@/lib/styleUtils', () => ({ getHeadingStyle: () => ({}) }));
vi.mock('@/components/TabsResponsive', () => ({
  default: ({ tabs, activeTab }) => tabs.find((tab) => tab.id === activeTab)?.content ?? null
}));
vi.mock('@/components/AdminOrdersTab', () => ({ default: () => null }));
vi.mock('@/components/AdminRemittancesTab', () => ({ default: () => null }));
vi.mock('@/components/AdminOffersTab', () => ({ default: () => null }));
vi.mock('@/components/RemittanceTypesConfig', () => ({ default: () => null }));
vi.mock('@/components/admin/ZellePaymentHistoryTab', () => ({ default: () => null }));
vi.mock('@/components/ActivityLogTab', () => ({ default: () => null }));

const HOUR = 60 * 60_000;
const STARTUP = 60_000;
const CURRENCIES = [
  { id: 'usd', code: 'USD', symbol: '$', is_base: true, is_active: true },
  { id: 'eur', code: 'EUR', symbol: '€', is_base: false, is_active: true },
  { id: 'cup', code: 'CUP', symbol: '$', is_base: false, is_active: true }
];
const RATES = [
  { from_currency_id: 'usd', to_currency_id: 'cup', rate: 400, effective_date: '2026-11-01' },
  { from_currency_id: 'usd', to_currency_id: 'eur', rate: 0.9, effective_date: '2026-11-01' }
];

const requests = [];
const bodyFor = (path, url) => {
  if (path.endsWith('/currencies')) return CURRENCIES;
  if (path.endsWith('/exchange_rates')) {
    const from = url.searchParams.get('from_currency_id')?.replace('eq.', '');
    const to = url.searchParams.get('to_currency_id')?.replace('eq.', '');
    const rows = RATES.filter((r) => (!from || r.from_currency_id === from) && (!to || r.to_currency_id === to));
    return url.searchParams.get('limit') === '1' ? rows.slice(0, 1) : rows;
  }
  if (path.endsWith('/rpc/get_pending_orders_count')) return 2;
  if (path.endsWith('/rpc/admin_refund_counts')) return [{ actionable: 0, on_hold: 0, due_soon: 0, overdue: 0, pending_amount_usd: 0 }];
  return [];
};
const countingFetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const method = (init.method || 'GET').toUpperCase();
  if (url.pathname.startsWith('/rest/v1/')) requests.push(`${method} ${url.pathname}`);
  const accept = new Headers(init.headers).get('accept') || '';
  let body = bodyFor(url.pathname, url);
  if (accept.includes('vnd.pgrst.object') && Array.isArray(body)) body = body[0] ?? null;
  return new Response(method === 'HEAD' ? null : JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Content-Range': '0-0/0' }
  });
};

const setHidden = (hidden) => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
  document.dispatchEvent(new Event('visibilitychange'));
};
const advance = async (ms) => {
  for (let elapsed = 0; elapsed < ms; elapsed += 10_000) {
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  }
};
const report = (label, value) => {
  if (process.env.BUDGET_REPORT) process.stdout.write(`[budget] ${label}: ${value}\n`);
};
const byEndpoint = () => requests.reduce((acc, r) => ({ ...acc, [r]: (acc[r] || 0) + 1 }), {});

let Header;
let CurrencyProvider;
let DashboardPage;
let usePendingRemittances;
let useRefundQueue;

beforeAll(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
  vi.stubGlobal('fetch', countingFetch);
});
// Fresh modules per test (a page load): the request cache and the polling resources of one test, stamped with its
// simulated clock, must not leak into the next.
const loadApp = async () => {
  vi.resetModules();
  ({ default: Header } = await import('@/components/Header'));
  ({ CurrencyProvider } = await import('@/contexts/CurrencyContext'));
  ({ default: DashboardPage } = await import('@/components/DashboardPage'));
  ({ usePendingRemittances } = await import('@/hooks/usePendingRemittances'));
  ({ useRefundQueue } = await import('@/hooks/useRefundQueue'));
};
afterAll(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// What AdminWorkTabs (the admin panel) keeps polling, without its heavy tab bodies
const AdminWorkLists = () => {
  usePendingRemittances({ enabled: true });
  useRefundQueue({ enabled: true });
  return null;
};

const AdminShell = ({ withDashboard, withAdminPanel }) => (
  <CurrencyProvider>
    <Header currentPage={withDashboard ? 'dashboard' : 'admin'} onNavigate={() => {}} />
    {withDashboard ? <DashboardPage onNavigate={() => {}} /> : null}
    {withAdminPanel ? <AdminWorkLists /> : null}
  </CurrencyProvider>
);

const runHour = async ({ withDashboard = false, withAdminPanel = false, hidden = false } = {}) => {
  render(<AdminShell withDashboard={withDashboard} withAdminPanel={withAdminPanel} />);
  await advance(STARTUP);
  const startup = requests.length;
  if (hidden) setHidden(true);
  requests.length = 0;
  await advance(HOUR);
  return { startup, hour: requests.length, endpoints: byEndpoint() };
};

describe('admin tab request budget (1 simulated hour, realtime silent)', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    localStorage.clear();
    sessionStorage.clear();
    requests.length = 0;
    setHidden(false);
    await loadApp();
  });
  afterEach(() => {
    cleanup();
    setHidden(false);
    vi.useRealTimers();
  });

  it('admin on a non-dashboard view, tab visible: <= 60 REST requests per hour after startup', async () => {
    const { startup, hour, endpoints } = await runHour();
    report('admin view visible - startup (1st minute)', startup);
    report('admin view visible - requests/hour', `${hour} ${JSON.stringify(endpoints)}`);
    expect(hour).toBeLessThanOrEqual(60);
  });

  it('admin panel (work lists of remittances and refunds), tab visible: <= 60 REST requests per hour', async () => {
    const { startup, hour, endpoints } = await runHour({ withAdminPanel: true });
    report('admin panel visible - startup (1st minute)', startup);
    report('admin panel visible - requests/hour', `${hour} ${JSON.stringify(endpoints)}`);
    expect(hour).toBeLessThanOrEqual(60);
  });

  it('admin on the Dashboard, tab visible: bounded (5-min safety net, no 30 s polling)', async () => {
    const { startup, hour, endpoints } = await runHour({ withDashboard: true });
    report('dashboard visible - startup (1st minute)', startup);
    report('dashboard visible - requests/hour', `${hour} ${JSON.stringify(endpoints)}`);
    expect(hour).toBeLessThanOrEqual(300);
  });

  it('tab hidden: 0 REST requests per hour (admin view and Dashboard)', async () => {
    const { hour, endpoints } = await runHour({ withDashboard: true, withAdminPanel: true, hidden: true });
    report('dashboard hidden - requests/hour', `${hour} ${JSON.stringify(endpoints)}`);
    expect(hour).toBe(0);
  });

  it('a normal hour never trips the guardrail', async () => {
    const { logError } = await import('@/lib/errorHandler');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await runHour({ withDashboard: true });
    const tripped = spy.mock.calls.some((args) => args.some((arg) => String(arg?.message ?? arg).includes('Request budget exceeded')));
    spy.mockRestore();
    expect(typeof logError).toBe('function');
    expect(tripped).toBe(false);
  });
});
