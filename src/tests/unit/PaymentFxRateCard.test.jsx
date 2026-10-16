import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { langState } = vi.hoisted(() => ({ langState: { value: 'en' } }));

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock('@/contexts/LanguageContext', async () => {
  const { tEcho } = await import('./helpers/bizumTestUtils.js');
  return { useLanguage: () => ({ t: tEcho, language: langState.value }) };
});

import PaymentFxRateCard from '@/components/settings/PaymentFxRateCard';
import * as paymentFxService from '@/lib/paymentFxService';
import { toBizumError } from '@/lib/bizumErrors';

// Shape returned by get_payment_fx_status once the rate is the central USD->EUR row of exchange_rates.
const status = (over = {}) => ({
  id: 'r1', mid_rate: 0.9234, spread_pct: 1.5, effective_rate: 0.937251, source: 'exchange_rates', created_by: null,
  created_at: '2026-10-15T10:00:00Z', age_hours: 3.5, state: 'ok', fx_warn_hours: 24, fx_block_hours: 96, ...over
});

const renderCard = (props = {}) => {
  const onRetry = vi.fn();
  const utils = render(<PaymentFxRateCard status={status()} error={null} onRetry={onRetry} {...props} />);
  return { ...utils, onRetry };
};

beforeEach(() => {
  langState.value = 'en';
});

describe('PaymentFxRateCard states', () => {
  it('shows the central rate, the Bizum spread, the effective rate and its age when ok', () => {
    renderCard();
    const card = screen.getByTestId('fx-status');
    expect(card).toHaveAttribute('data-state', 'ok');
    expect(card).toHaveTextContent('settings.fxRate.state.ok');
    expect(card).toHaveTextContent('0.9234');
    expect(card).toHaveTextContent('1.5');
    expect(card).toHaveTextContent('0.937251');
    expect(card).toHaveTextContent('hours=3.5');
  });

  it('does not show an author: the central rate keeps none', () => {
    renderCard();
    expect(screen.queryByText('settings.fxRate.labels.author')).toBeNull();
    expect(screen.queryByText('settings.fxRate.authorUnknown')).toBeNull();
  });

  it('shows the amber warning state with a text label (not only colour)', () => {
    renderCard({ status: status({ state: 'warn', age_hours: 30 }) });
    const card = screen.getByTestId('fx-status');
    expect(card).toHaveAttribute('data-state', 'warn');
    expect(card).toHaveTextContent('settings.fxRate.state.warn');
    expect(card.className).toMatch(/amber/);
  });

  it('shows the red blocked state with its explanation', () => {
    renderCard({ status: status({ state: 'blocked', age_hours: 120 }) });
    const card = screen.getByTestId('fx-status');
    expect(card).toHaveAttribute('data-state', 'blocked');
    expect(card).toHaveTextContent('settings.fxRate.state.blocked');
    expect(card.className).toMatch(/red/);
    expect(screen.getByRole('alert')).toHaveTextContent('settings.fxRate.blockedHelp');
  });

  it('for the none state tells the admin to load an active USD -> EUR rate in Financial Settings', () => {
    renderCard({ status: { state: 'none', id: null, fx_warn_hours: 24, fx_block_hours: 96 } });
    const card = screen.getByTestId('fx-status');
    expect(card).toHaveAttribute('data-state', 'none');
    expect(card).toHaveTextContent('settings.fxRate.noneHelp');
  });

  it('renders the thresholds returned by the RPC (non default 6/12), never hardcoded 24/96', () => {
    renderCard({ status: status({ fx_warn_hours: 6, fx_block_hours: 12, age_hours: 8, state: 'warn' }) });
    const card = screen.getByTestId('fx-status');
    expect(card).toHaveTextContent('warn=6');
    expect(card).toHaveTextContent('block=12');
    expect(card).not.toHaveTextContent('warn=24');
    expect(card).not.toHaveTextContent('block=96');
  });

  it('takes the colour state from the server, not from age vs thresholds', () => {
    renderCard({ status: status({ state: 'ok', age_hours: 500, fx_warn_hours: 6, fx_block_hours: 12 }) });
    expect(screen.getByTestId('fx-status')).toHaveAttribute('data-state', 'ok');
  });

  it('shows an own error alert with retry when the status failed', () => {
    const { onRetry } = renderCard({ status: null, error: toBizumError({ code: 'XX000', message: 'boom' }) });
    expect(screen.getByRole('alert')).toHaveTextContent('settings.bizum.errors.unknown');
    fireEvent.click(screen.getByRole('button', { name: 'settings.bizum.retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('formats numbers with the app language (es uses a decimal comma)', () => {
    langState.value = 'es';
    renderCard();
    const card = screen.getByTestId('fx-status');
    expect(card).toHaveTextContent('0,9234');
    expect(card).toHaveTextContent('0,937251');
    expect(card).not.toHaveTextContent('0.9234');
  });
});

describe('PaymentFxRateCard is read-only: the rate is managed in Financial Settings', () => {
  it('explains where the rate is loaded', () => {
    renderCard();
    expect(screen.getByText('settings.fxRate.managedCentrally')).toBeInTheDocument();
  });

  it('offers no way to load a second, duplicated rate: no inputs, no submit button, no dialog', () => {
    renderCard();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'settings.fxRate.form.submit' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps no write path in the service: the old ledger writer and its form helpers are gone', () => {
    for (const removed of ['setPaymentFxRate', 'validatePaymentFxForm', 'effectiveRate', 'changePercent', 'PAYMENT_FX_BOUNDS']) {
      expect(paymentFxService[removed], removed).toBeUndefined();
    }
  });
});
