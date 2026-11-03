import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EN from '@/translations/EN.json';
import ES from '@/translations/ES.json';

const { svc, lang } = vi.hoisted(() => ({ svc: { fetch: vi.fn() }, lang: { current: 'en' } }));

// Real translations: the exact user-facing sentences are part of the contract.
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => {
    const dict = lang.current === 'es' ? ES : EN;
    const t = (key, params = {}) => {
      const raw = key.split('.').reduce((acc, part) => acc?.[part], dict);
      if (typeof raw !== 'string') return key;
      return Object.entries(params).reduce((acc, [name, value]) => acc.replace(`{${name}}`, value), raw);
    };
    return { t, language: lang.current };
  }
}));
vi.mock('@/lib/fxReference', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchUsdEurReference: (...args) => svc.fetch(...args)
}));

import FxReferenceCard from '@/components/settings/FxReferenceCard';
import { FxReferenceError } from '@/lib/fxReference';

const NOW = new Date('2026-10-16T12:00:00Z');
const reference = (overrides = {}) => ({
  pair: 'USD_EUR',
  rate: 0.892,
  providerName: 'ExchangeRate-API',
  providerDomain: 'exchangerate-api.com',
  providerUpdatedAt: new Date('2026-10-16T00:00:01Z'),
  providerDate: '2026-10-16',
  fetchedAt: NOW,
  ...overrides
});

beforeEach(() => {
  lang.current = 'en';
  svc.fetch.mockReset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('FxReferenceCard', () => {
  it('shows the source, the provider update (local and UTC), the query time and the labelled value', async () => {
    svc.fetch.mockResolvedValue(reference());
    render(<FxReferenceCard onUse={vi.fn()} />);

    expect(await screen.findByText('Reference: 1 USD = 0.892 EUR (not the operative rate)')).toBeInTheDocument();
    expect(screen.getByText('Source: ExchangeRate-API (exchangerate-api.com)')).toBeInTheDocument();
    expect(screen.getByText(/Updated by the provider: .*2026.*\(UTC: Oct 16, 2026, 12:00 AM\)/)).toBeInTheDocument();
    expect(screen.getByText(/Checked: .*2026.* \(local time\)/)).toBeInTheDocument();
    expect(screen.getByText('Provider data is 11 h old')).toBeInTheDocument();
  });

  it('never prints the bare "EUR: 0.8920" grid of the old block', async () => {
    svc.fetch.mockResolvedValue(reference());
    render(<FxReferenceCard onUse={vi.fn()} />);
    await screen.findByText(/Reference: 1 USD/);
    expect(screen.queryByText('EUR:')).toBeNull();
    expect(screen.queryByText('0.8920')).toBeNull();
  });

  it('shows a loading status while the query is in flight', async () => {
    svc.fetch.mockReturnValue(new Promise(() => {}));
    render(<FxReferenceCard onUse={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Checking the external source...');
  });

  it('shows an alert with retry on error, never an empty box', async () => {
    svc.fetch.mockRejectedValueOnce(new FxReferenceError('timeout')).mockResolvedValueOnce(reference());
    render(<FxReferenceCard onUse={vi.fn()} />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The external source did not answer in time.');
    expect(screen.queryByText(/Reference: 1 USD/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use as rate' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/Reference: 1 USD = 0.892 EUR/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    ['invalid_payload', 'The external source returned data that cannot be trusted.'],
    ['out_of_band', 'The external source returned a rate outside the expected range.'],
    ['network', 'The external source could not be reached.']
  ])('explains %s and offers no way to use it', async (code, message) => {
    svc.fetch.mockRejectedValue(new FxReferenceError(code));
    render(<FxReferenceCard onUse={vi.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByText(/1.0000/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use as rate' })).toBeNull();
  });

  it('warns about stale provider data and disables "Use as rate"', async () => {
    svc.fetch.mockResolvedValue(reference({ providerUpdatedAt: new Date('2026-10-13T12:00:00Z') }));
    const onUse = vi.fn();
    render(<FxReferenceCard onUse={onUse} />);

    expect(await screen.findByText(/Outdated data/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('72 h old (limit 48 h)');
    const use = screen.getByRole('button', { name: 'Use as rate' });
    expect(use).toBeDisabled();
    fireEvent.click(use);
    expect(onUse).not.toHaveBeenCalled();
  });

  it('treats an unknown provider date as not usable', async () => {
    svc.fetch.mockResolvedValue(reference({ providerUpdatedAt: null, providerDate: null }));
    render(<FxReferenceCard onUse={vi.fn()} />);

    expect(await screen.findByText('The provider did not report when it updated this rate.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use as rate' })).toBeDisabled();
  });

  it('"Use as rate" only hands the rate to the parent', async () => {
    svc.fetch.mockResolvedValue(reference());
    const onUse = vi.fn();
    render(<FxReferenceCard onUse={onUse} />);

    const use = await screen.findByRole('button', { name: 'Use as rate' });
    expect(screen.getByText('Only preloads the form below; nothing is saved.')).toBeInTheDocument();
    fireEvent.click(use);

    expect(onUse).toHaveBeenCalledTimes(1);
    expect(onUse).toHaveBeenCalledWith({ rate: 0.892 });
  });

  it('disables "Use as rate" with a visible reason supplied by the parent', async () => {
    svc.fetch.mockResolvedValue(reference());
    render(<FxReferenceCard onUse={vi.fn()} disabledReason="Create the currencies first." />);

    expect(await screen.findByText('Create the currencies first.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use as rate' })).toBeDisabled();
  });

  it('starts empty without auto load and queries on demand', async () => {
    svc.fetch.mockResolvedValue(reference());
    render(<FxReferenceCard onUse={vi.fn()} autoLoad={false} />);

    expect(svc.fetch).not.toHaveBeenCalled();
    expect(screen.getByText(/Not checked yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText(/Reference: 1 USD = 0.892 EUR/)).toBeInTheDocument();
  });

  it('keeps the previous value visible but unusable when a refresh fails (degraded)', async () => {
    svc.fetch.mockResolvedValueOnce(reference()).mockRejectedValueOnce(new FxReferenceError('network'));
    render(<FxReferenceCard onUse={vi.fn()} />);

    await screen.findByText(/Reference: 1 USD = 0.892 EUR/);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not refresh. Showing the previous result.');
    expect(screen.getByText(/Reference: 1 USD = 0.892 EUR/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use as rate' })).toBeDisabled();
  });

  it('renders the Spanish sentence', async () => {
    lang.current = 'es';
    svc.fetch.mockResolvedValue(reference());
    render(<FxReferenceCard onUse={vi.fn()} />);

    expect(await screen.findByText('Referencia: 1 USD = 0,892 EUR (no es la tasa operativa)')).toBeInTheDocument();
  });

  it('ignores an aborted request on unmount without touching state', async () => {
    svc.fetch.mockImplementation(({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new FxReferenceError('aborted')));
    }));
    const { unmount } = render(<FxReferenceCard onUse={vi.fn()} />);
    unmount();
    await waitFor(() => expect(svc.fetch).toHaveBeenCalledTimes(1));
    expect(svc.fetch.mock.calls[0][0].signal.aborted).toBe(true);
  });
});
