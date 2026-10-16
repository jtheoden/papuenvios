import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const { servicesMock, catalogMock, zelleMock } = vi.hoisted(() => ({
  servicesMock: {
    getBizumSettings: vi.fn(),
    listBizumAccounts: vi.fn(),
    getPaymentFxStatus: vi.fn(),
    setBizumSettings: vi.fn()
  },
  catalogMock: { state: {} },
  zelleMock: {
    getAllZelleAccounts: vi.fn(),
    getZelleAccountUsageSummary: vi.fn(),
    getZelleAccountHistoricalTotals: vi.fn()
  }
}));

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock('@/contexts/LanguageContext', async () => {
  const { tEcho } = await import('./helpers/bizumTestUtils.js');
  return { useLanguage: () => ({ t: tEcho, language: 'en' }) };
});
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => ({ visualSettings: { primaryColor: '#000' } }) }));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/hooks/usePaymentMethods', () => ({ usePaymentMethods: () => catalogMock.state }));
vi.mock('@/lib/bizumService', async (importOriginal) => ({
  ...(await importOriginal()),
  getBizumSettings: (...a) => servicesMock.getBizumSettings(...a),
  listBizumAccounts: (...a) => servicesMock.listBizumAccounts(...a),
  setBizumSettings: (...a) => servicesMock.setBizumSettings(...a)
}));
vi.mock('@/lib/paymentFxService', async (importOriginal) => ({
  ...(await importOriginal()),
  getPaymentFxStatus: (...a) => servicesMock.getPaymentFxStatus(...a)
}));
vi.mock('@/lib/zelleService', () => ({ zelleService: zelleMock }));
vi.mock('@/components/settings/ZelleAccountTableConfig', () => ({ getZelleTableColumns: () => [], getZelleModalColumns: () => [] }));
vi.mock('@/components/modals/TableDetailModal', () => ({ default: () => null }));

import SettingsBizumSection from '@/components/settings/SettingsBizumSection';
import SettingsZelleTab from '@/components/settings/SettingsZelleTab';
import { toBizumError } from '@/lib/bizumErrors';
import { BIZUM_SETTING_FIELDS } from '@/lib/bizumService';
import { PG_ERRORS } from './helpers/bizumTestUtils';

const SETTINGS = { default_spread_pct: 1.5, default_per_operation_limit: 1000, fx_warn_hours: 24, fx_block_hours: 96 };
const NONE_STATUS = { state: 'none', fx_warn_hours: 24, fx_block_hours: 96, id: null };
const catalog = (codes, extra = {}) => ({
  methods: codes.map((code) => ({ code, available: false })),
  loading: false,
  error: null,
  refresh: vi.fn(),
  ...extra
});

beforeEach(() => {
  Object.values(servicesMock).forEach((fn) => fn.mockReset());
  Object.values(zelleMock).forEach((fn) => fn.mockReset());
  servicesMock.getBizumSettings.mockResolvedValue(SETTINGS);
  servicesMock.listBizumAccounts.mockResolvedValue([]);
  servicesMock.getPaymentFxStatus.mockResolvedValue(NONE_STATUS);
  zelleMock.getAllZelleAccounts.mockResolvedValue([{ id: 'z1', account_name: 'Zelle Main' }]);
  zelleMock.getZelleAccountUsageSummary.mockResolvedValue({});
  zelleMock.getZelleAccountHistoricalTotals.mockResolvedValue({});
  catalogMock.state = catalog(['zelle', 'bizum']);
});
afterEach(() => vi.restoreAllMocks());

describe('SettingsBizumSection gating (R-01)', () => {
  it('renders the Bizum section (h2) when the catalog has the bizum row, even if not available', async () => {
    render(<SettingsBizumSection />);
    expect(await screen.findByRole('heading', { level: 2, name: 'settings.bizum.title' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('shows the FX badge inside the section header from the single FX read, and no stray top margin', async () => {
    servicesMock.getPaymentFxStatus.mockResolvedValue({ ...NONE_STATUS, state: 'blocked' });
    render(<SettingsBizumSection />);
    const badge = await screen.findByTestId('fx-badge');
    expect(badge).toHaveAttribute('data-state', 'blocked');
    const section = screen.getByRole('heading', { level: 2, name: 'settings.bizum.title' }).closest('section');
    expect(section).toContainElement(badge);
    expect(section.className).not.toMatch(/\bmt-\d+/);
    expect(servicesMock.getPaymentFxStatus).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when the catalog has no bizum row', async () => {
    catalogMock.state = catalog(['zelle']);
    const { container } = render(<SettingsBizumSection />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(servicesMock.getBizumSettings).not.toHaveBeenCalled();
  });

  it('renders nothing while the catalog is loading', () => {
    catalogMock.state = catalog([], { methods: null, loading: true });
    const { container } = render(<SettingsBizumSection />);
    expect(container).toBeEmptyDOMElement();
  });

  it('hides the section when the catalog schema is missing', () => {
    catalogMock.state = catalog([], { methods: null, error: Object.assign(new Error('x'), { context: { schemaMissing: true } }) });
    const { container } = render(<SettingsBizumSection />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows an own error state (not hiding) when the catalog fails for another reason', () => {
    const refresh = vi.fn();
    catalogMock.state = catalog([], { methods: null, error: new Error('network'), refresh });
    render(<SettingsBizumSection />);
    expect(screen.getByRole('heading', { level: 2, name: 'settings.bizum.title' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('settings.bizum.loadError');
  });

  it.each([
    ['PGRST202 (RPC missing)', PG_ERRORS.missingFunction],
    ['PGRST205 (table missing)', PG_ERRORS.missingTable]
  ])('hides the whole section when the Bizum data fails with %s (migrations not applied)', async (_, raw) => {
    servicesMock.getBizumSettings.mockRejectedValue(toBizumError(raw));
    const { container } = render(<SettingsBizumSection />);
    await waitFor(() => expect(servicesMock.getBizumSettings).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    // Sequential probe: with the schema absent (prod today) only ONE call is made.
    expect(servicesMock.getPaymentFxStatus).not.toHaveBeenCalled();
    expect(servicesMock.listBizumAccounts).not.toHaveBeenCalled();
  });

  it('shows an own error state when the Bizum data fails with a non-schema error', async () => {
    servicesMock.getBizumSettings.mockRejectedValue(toBizumError({ code: 'XX000', message: 'boom' }));
    render(<SettingsBizumSection />);
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((a) => a.textContent.includes('settings.bizum.errors.unknown'))).toBe(true);
    expect(screen.getByRole('heading', { level: 2, name: 'settings.bizum.title' })).toBeInTheDocument();
  });
});

describe('Bizum failure never breaks Zelle', () => {
  it('keeps the Zelle tab rendered while the Bizum RPCs fail', async () => {
    servicesMock.getBizumSettings.mockRejectedValue(toBizumError({ code: 'XX000', message: 'boom' }));
    servicesMock.getPaymentFxStatus.mockRejectedValue(toBizumError({ code: 'XX000', message: 'boom' }));
    servicesMock.listBizumAccounts.mockRejectedValue(toBizumError({ code: 'XX000', message: 'boom' }));
    render(
      <>
        <SettingsZelleTab />
        <SettingsBizumSection />
      </>
    );
    expect(await screen.findByText('zelle.accounts')).toBeInTheDocument();
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
    expect(screen.getByText('zelle.accounts')).toBeInTheDocument();
    expect(zelleMock.getAllZelleAccounts).toHaveBeenCalled();
  });

  it('keeps Zelle intact when Bizum is absent because the schema is missing', async () => {
    servicesMock.getBizumSettings.mockRejectedValue(toBizumError(PG_ERRORS.missingFunction));
    servicesMock.getPaymentFxStatus.mockRejectedValue(toBizumError(PG_ERRORS.missingFunction));
    servicesMock.listBizumAccounts.mockRejectedValue(toBizumError(PG_ERRORS.missingTable));
    render(
      <>
        <SettingsZelleTab />
        <SettingsBizumSection />
      </>
    );
    expect(await screen.findByText('zelle.accounts')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('settings.bizum.title')).toBeNull());
    expect(screen.getByText('zelle.accounts')).toBeInTheDocument();
  });
});

describe('partial schema and reload behaviour', () => {
  it('S3 deployed but S4 missing: shows the FX and settings cards and omits only the accounts card', async () => {
    servicesMock.listBizumAccounts.mockRejectedValue(toBizumError(PG_ERRORS.missingTable));
    render(<SettingsBizumSection />);
    expect(await screen.findByText('settings.fxRate.title')).toBeInTheDocument();
    expect(screen.getByText('settings.bizum.settings.title')).toBeInTheDocument();
    expect(screen.queryByText('settings.bizum.accounts.title')).toBeNull();
  });

  it('FX missing but accounts present: omits only the FX card', async () => {
    servicesMock.getPaymentFxStatus.mockRejectedValue(toBizumError(PG_ERRORS.missingFunction));
    render(<SettingsBizumSection />);
    expect(await screen.findByText('settings.bizum.accounts.title')).toBeInTheDocument();
    expect(screen.queryByText('settings.fxRate.title')).toBeNull();
  });

  it('a transient failure (PGRST002) on the initial load shows an error, it does not hide the section', async () => {
    const outage = { code: 'PGRST002', message: 'Could not query the database for the schema cache. Retrying.' };
    servicesMock.listBizumAccounts.mockRejectedValue(toBizumError(outage));
    render(<SettingsBizumSection />);
    expect(await screen.findByText('settings.bizum.accounts.title')).toBeInTheDocument();
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
  });

  it('a schema-missing error on a RELOAD never unmounts the section', async () => {
    servicesMock.getPaymentFxStatus.mockResolvedValueOnce({ ...NONE_STATUS, state: 'ok', id: 'r1', mid_rate: 0.9, spread_pct: 1, effective_rate: 0.909, age_hours: 1, created_at: '2026-10-15T10:00:00Z' });
    servicesMock.getPaymentFxStatus.mockRejectedValueOnce(toBizumError(PG_ERRORS.missingFunction));
    const full = Object.fromEntries(BIZUM_SETTING_FIELDS.map((field) => [field.key, field.default]));
    servicesMock.getBizumSettings.mockResolvedValue(full);
    servicesMock.setBizumSettings.mockResolvedValue({ ...full, fx_warn_hours: 12 });
    render(<SettingsBizumSection />);
    // Saving the settings re-reads the FX state (the thresholds the server derives it from may have changed).
    fireEvent.change(await screen.findByLabelText('settings.bizum.fields.fx_warn_hours.label'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'settings.bizum.settings.save' }));
    await waitFor(() => expect(servicesMock.getPaymentFxStatus).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(screen.getByRole('heading', { level: 2, name: 'settings.bizum.title' })).toBeInTheDocument();
    expect(screen.getByText('settings.bizum.accounts.title')).toBeInTheDocument();
  });
});
