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
import PaymentFxBadge from '@/components/settings/PaymentFxBadge';
import { buildRateStatus } from '@/lib/rateAge';

const PAIR = { from: 'USD', to: 'CUP' };
const NOW = new Date('2026-10-27T16:00:00Z');
const active = (over = {}) => ({ rate: 830, effective_date: '2026-10-22', updated_at: '2026-10-22T09:00:00Z', ageHours: 136, ...over });

const renderCard = (props = {}) => {
  const onRetry = vi.fn();
  const onGoToFinancial = vi.fn();
  const utils = render(
    <PaymentFxRateCard pair={PAIR} status={buildRateStatus(active(), { now: NOW })} error={null} onRetry={onRetry} onGoToFinancial={onGoToFinancial} {...props} />
  );
  return { ...utils, onRetry, onGoToFinancial };
};

beforeEach(() => {
  langState.value = 'en';
});

describe('buildRateStatus', () => {
  it('maps an active rate to the card status; thresholds stay absent when the pair has none', () => {
    expect(buildRateStatus(active(), { now: NOW })).toEqual({
      state: 'ok', mid_rate: 830, age_hours: 136, effective_date: '2026-10-22'
    });
  });

  it('is none (no numbers) when there is no active rate', () => {
    expect(buildRateStatus(null, { now: NOW })).toEqual({ state: 'none' });
  });

  it('carries the thresholds it was given and derives the state from them', () => {
    expect(buildRateStatus(active(), { warnHours: 24, blockHours: 168, now: NOW })).toMatchObject({
      state: 'warn', fx_warn_hours: 24, fx_block_hours: 168
    });
  });
});

describe('PaymentFxRateCard for a non-Bizum pair (USD -> CUP)', () => {
  it('shows pair title, the rate, the effective date and the age, in a single column on mobile', () => {
    renderCard();
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('settings.fxRate.generic.title from=USD to=CUP');
    const card = screen.getByTestId('fx-status');
    expect(card).toHaveAttribute('data-state', 'ok');
    expect(card).toHaveTextContent('settings.fxRate.generic.state.ok');
    expect(card).toHaveTextContent('830');
    expect(card).toHaveTextContent('Oct 22, 2026');
    expect(card).toHaveTextContent('hours=136.0');
    expect(card.querySelector('dl').className).toMatch(/grid-cols-1/);
    expect(card.querySelector('dl').className).not.toMatch(/(^|\s)grid-cols-2/);
  });

  it('does not render Bizum-only blocks: no spread, no effective rate, no thresholds', () => {
    renderCard();
    const card = screen.getByTestId('fx-status');
    expect(card).not.toHaveTextContent('settings.fxRate.labels.spread');
    expect(card).not.toHaveTextContent('settings.fxRate.labels.effective');
    expect(card).not.toHaveTextContent('settings.fxRate.labels.thresholds');
    expect(screen.queryByText(/settings\.fxRate\.managedCentrally/)).toBeNull();
  });

  it('formats the rate and the date with the app language', () => {
    langState.value = 'es';
    renderCard({ status: buildRateStatus(active({ rate: 830.5 }), { now: NOW }) });
    const card = screen.getByTestId('fx-status');
    expect(card).toHaveTextContent('830,5');
    expect(card).not.toHaveTextContent('830.5');
    expect(card).toHaveTextContent('2026');
    expect(card).not.toHaveTextContent('Oct');
  });

  it('without a rate says the cause and the action, never a zero', () => {
    renderCard({ status: buildRateStatus(null, { now: NOW }) });
    const card = screen.getByTestId('fx-status');
    expect(card).toHaveAttribute('data-state', 'none');
    expect(card).toHaveTextContent('settings.fxRate.generic.state.none');
    expect(card).toHaveTextContent('settings.fxRate.generic.noneHelp from=USD to=CUP');
    expect(card).not.toHaveTextContent(/\b0\b/);
    expect(screen.getByRole('button', { name: 'settings.fxRate.goToFinancial' })).toBeEnabled();
  });

  it('on a load error shows an alert with the cause and a retry button', () => {
    const { onRetry } = renderCard({ status: null, error: new Error('boom') });
    expect(screen.getByRole('alert')).toHaveTextContent('settings.fxRate.generic.loadError from=USD to=CUP');
    fireEvent.click(screen.getByRole('button', { name: 'settings.fxRate.generic.retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('fx-status')).toBeNull();
  });

  it('an old rate on a pair without thresholds is informative only: ok state, no alert, nothing disabled', () => {
    const old = active({ effective_date: '2026-01-01' });
    const { container, onGoToFinancial } = renderCard({ status: buildRateStatus(old, { now: NOW }) });
    const card = screen.getByTestId('fx-status');
    expect(card).toHaveAttribute('data-state', 'ok');
    expect(card).toHaveTextContent('settings.fxRate.generic.ageNote');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(container.querySelectorAll('[disabled],[aria-disabled="true"]')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'settings.fxRate.goToFinancial' }));
    expect(onGoToFinancial).toHaveBeenCalledTimes(1);
  });

  it('offers no input to type a second rate', () => {
    renderCard();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  });

  it.each([
    ['ok', {}],
    ['warn', { warnHours: 24, blockHours: 168 }],
    ['blocked', { warnHours: 24, blockHours: 100 }],
    ['none', null]
  ])('state %s has a text label and an icon (not only colour)', (state, thresholds) => {
    const status = thresholds === null ? buildRateStatus(null) : buildRateStatus(active(), { ...thresholds, now: NOW });
    renderCard({ status });
    const card = screen.getByTestId('fx-status');
    expect(card).toHaveAttribute('data-state', state);
    expect(card).toHaveTextContent(`settings.fxRate.generic.state.${state}`);
    const icon = card.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('keeps the live-region roles: status for warn, alert for blocked', () => {
    renderCard({ status: buildRateStatus(active(), { warnHours: 24, blockHours: 168, now: NOW }) });
    expect(screen.getByRole('status')).toHaveTextContent('settings.fxRate.generic.warnHelp');
  });

  it('blocked uses role alert with the cause and action', () => {
    renderCard({ status: buildRateStatus(active(), { warnHours: 24, blockHours: 100, now: NOW }) });
    expect(screen.getByRole('alert')).toHaveTextContent('settings.fxRate.generic.blockedHelp');
  });
});

describe('PaymentFxBadge for a pair', () => {
  it.each(['ok', 'warn', 'blocked', 'none'])('shows pair text and an icon for %s', (state) => {
    render(<PaymentFxBadge pair={PAIR} status={{ state }} />);
    const badge = screen.getByTestId('fx-badge');
    expect(badge).toHaveTextContent(`settings.fxRate.generic.badge.${state} from=USD to=CUP`);
    expect(badge.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('Bizum cards also get icons (additive, aria-hidden)', () => {
  it('the default card shows an icon next to the state text', () => {
    render(<PaymentFxRateCard status={{ state: 'ok', mid_rate: 0.9, age_hours: 1, fx_warn_hours: 24, fx_block_hours: 96 }} />);
    expect(screen.getByTestId('fx-status').querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
