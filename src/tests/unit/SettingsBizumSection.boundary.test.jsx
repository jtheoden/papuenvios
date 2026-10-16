import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock('@/contexts/LanguageContext', async () => {
  const { tEcho } = await import('./helpers/bizumTestUtils.js');
  return { useLanguage: () => ({ t: tEcho, language: 'en' }) };
});
vi.mock('@/contexts/BusinessContext', () => ({ useBusiness: () => ({ visualSettings: {} }) }));
vi.mock('@/hooks/usePaymentMethods', () => ({
  usePaymentMethods: () => ({ methods: [{ code: 'bizum' }], loading: false, error: null, refresh: vi.fn() })
}));
vi.mock('@/lib/bizumService', async (importOriginal) => ({
  ...(await importOriginal()),
  getBizumSettings: vi.fn().mockResolvedValue({ default_spread_pct: 1.5 }),
  listBizumAccounts: vi.fn().mockResolvedValue([])
}));
vi.mock('@/lib/paymentFxService', async (importOriginal) => ({
  ...(await importOriginal()),
  getPaymentFxStatus: vi.fn().mockResolvedValue({ state: 'none', fx_warn_hours: 24, fx_block_hours: 96 })
}));
vi.mock('@/components/settings/BizumSettingsCard', () => ({
  default: () => {
    throw new Error('render crash');
  }
}));

import SettingsBizumSection from '@/components/settings/SettingsBizumSection';

describe('SettingsBizumSection error boundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('contains a render crash: siblings (Zelle) stay mounted and a discreet i18n notice is shown', async () => {
    render(
      <main>
        <p>zelle-still-here</p>
        <SettingsBizumSection />
      </main>
    );
    expect(await screen.findByText('settings.bizum.renderError')).toBeInTheDocument();
    expect(screen.getByText('zelle-still-here')).toBeInTheDocument();
  });
});
