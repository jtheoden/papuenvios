import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const { fxMock, toastMock, langState } = vi.hoisted(() => ({ fxMock: { setPaymentFxRate: vi.fn() }, toastMock: vi.fn(), langState: { value: 'en' } }));

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock('@/contexts/LanguageContext', async () => {
  const { tEcho } = await import('./helpers/bizumTestUtils.js');
  return { useLanguage: () => ({ t: tEcho, language: langState.value }) };
});
vi.mock('@/components/ui/use-toast', () => ({ toast: (...a) => toastMock(...a) }));
vi.mock('@/lib/paymentFxService', async (importOriginal) => ({
  ...(await importOriginal()),
  setPaymentFxRate: (...a) => fxMock.setPaymentFxRate(...a)
}));

import PaymentFxRateCard from '@/components/settings/PaymentFxRateCard';
import { toBizumError } from '@/lib/bizumErrors';
import { PG_ERRORS } from './helpers/bizumTestUtils';

const status = (over = {}) => ({
  id: 'r1', mid_rate: 0.9234, spread_pct: 1.5, effective_rate: 0.937251, source: 'manual', created_by: 'u1',
  created_by_name: 'Ana Admin', created_at: '2026-10-15T10:00:00Z', age_hours: 3.5, state: 'ok',
  fx_warn_hours: 24, fx_block_hours: 96, ...over
});

const renderCard = (props = {}) => {
  const onSaved = vi.fn();
  const onRetry = vi.fn();
  const utils = render(<PaymentFxRateCard status={status()} error={null} defaultSpread={2.25} onSaved={onSaved} onRetry={onRetry} {...props} />);
  return { ...utils, onSaved, onRetry };
};

beforeEach(() => {
  langState.value = 'en';
  fxMock.setPaymentFxRate.mockReset();
  toastMock.mockReset();
  fxMock.setPaymentFxRate.mockResolvedValue({ id: 'r2' });
});

describe('PaymentFxRateCard states', () => {
  it('shows the latest rate, spread, effective rate, author and age when ok', () => {
    renderCard();
    const card = screen.getByTestId('fx-status');
    expect(card).toHaveAttribute('data-state', 'ok');
    expect(card).toHaveTextContent('settings.fxRate.state.ok');
    expect(card).toHaveTextContent('0.9234');
    expect(card).toHaveTextContent('1.5');
    expect(card).toHaveTextContent('0.937251');
    expect(card).toHaveTextContent('Ana Admin');
    expect(card).toHaveTextContent('hours=3.5');
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

  it('shows the "load the first rate" message for the none state', () => {
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
});

describe('PaymentFxRateCard form', () => {
  it('prefills the spread from the settings default', () => {
    renderCard();
    expect(screen.getByLabelText('settings.fxRate.form.spread')).toHaveValue('2.25');
  });

  it('submits mid + settings spread + manual source and reloads on success', async () => {
    const { onSaved } = renderCard();
    fireEvent.change(screen.getByLabelText('settings.fxRate.form.mid'), { target: { value: '0.9300' } });
    fireEvent.change(screen.getByLabelText('settings.fxRate.form.note'), { target: { value: 'ECB 10:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'settings.fxRate.form.submit' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(fxMock.setPaymentFxRate).toHaveBeenCalledTimes(1);
    expect(fxMock.setPaymentFxRate).toHaveBeenCalledWith({
      mid: 0.93, spread: 2.25, source: 'manual', note: 'ECB 10:00', confirmLargeChange: false
    });
  });

  it('does not call the server with an invalid mid and associates the error with the field', async () => {
    renderCard();
    const mid = screen.getByLabelText('settings.fxRate.form.mid');
    fireEvent.change(mid, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'settings.fxRate.form.submit' }));
    expect(fxMock.setPaymentFxRate).not.toHaveBeenCalled();
    expect(mid).toHaveAttribute('aria-invalid', 'true');
    const describedBy = mid.getAttribute('aria-describedby').split(' ');
    expect(describedBy.some((id) => document.getElementById(id)?.textContent.includes('settings.fxRate.validation.range'))).toBe(true);
  });

  it('has no "preload ECB" button in this slice', () => {
    renderCard();
    expect(screen.queryByRole('button', { name: /ecb|bce/i })).toBeNull();
  });

  it('shows the server error for other failures and keeps the form values', async () => {
    fxMock.setPaymentFxRate.mockRejectedValue(toBizumError(PG_ERRORS.raise('payment_fx_forbidden', null, '42501')));
    renderCard();
    fireEvent.change(screen.getByLabelText('settings.fxRate.form.mid'), { target: { value: '0.93' } });
    fireEvent.click(screen.getByRole('button', { name: 'settings.fxRate.form.submit' }));
    await waitFor(() => expect(screen.getAllByRole('alert').some((a) => a.textContent.includes('settings.fxRate.errors.forbidden'))).toBe(true));
    expect(screen.getByLabelText('settings.fxRate.form.mid')).toHaveValue('0.93');
  });
});

describe('PaymentFxRateCard large change confirmation', () => {
  const submitLargeChange = async () => {
    fxMock.setPaymentFxRate.mockRejectedValueOnce(toBizumError(PG_ERRORS.raise('payment_fx_large_change')));
    const utils = renderCard();
    fireEvent.change(screen.getByLabelText('settings.fxRate.form.mid'), { target: { value: '1.2' } });
    fireEvent.click(screen.getByRole('button', { name: 'settings.fxRate.form.submit' }));
    const dialog = await screen.findByRole('dialog');
    return { ...utils, dialog };
  };

  it('opens an own dialog (never window.confirm) when the RPC answers payment_fx_large_change', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { dialog } = await submitLargeChange();
    expect(within(dialog).getByText('settings.fxRate.largeChange.title')).toBeInTheDocument();
    expect(fxMock.setPaymentFxRate).toHaveBeenCalledTimes(1);
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('retries the identical payload with confirmLargeChange=true when confirmed', async () => {
    const { dialog, onSaved } = await submitLargeChange();
    fireEvent.click(within(dialog).getByRole('button', { name: 'settings.fxRate.largeChange.confirm' }));
    await waitFor(() => expect(fxMock.setPaymentFxRate).toHaveBeenCalledTimes(2));
    expect(fxMock.setPaymentFxRate.mock.calls[0][0]).toEqual({ mid: 1.2, spread: 2.25, source: 'manual', note: '', confirmLargeChange: false });
    expect(fxMock.setPaymentFxRate.mock.calls[1][0]).toEqual({ mid: 1.2, spread: 2.25, source: 'manual', note: '', confirmLargeChange: true });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('does not retry when cancelled', async () => {
    const { dialog, onSaved } = await submitLargeChange();
    fireEvent.click(within(dialog).getByRole('button', { name: 'common.cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(fxMock.setPaymentFxRate).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe('PaymentFxRateCard hardening', () => {
  const deferred = () => {
    let resolve;
    const promise = new Promise((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };

  it('formats numbers with the app language (es uses a decimal comma)', () => {
    langState.value = 'es';
    renderCard();
    const card = screen.getByTestId('fx-status');
    expect(card).toHaveTextContent('0,9234');
    expect(card).toHaveTextContent('0,937251');
    expect(card).not.toHaveTextContent('0.9234');
  });

  it('moves focus to the first invalid field on a failed submit', () => {
    renderCard();
    fireEvent.change(screen.getByLabelText('settings.fxRate.form.mid'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'settings.fxRate.form.submit' }));
    expect(screen.getByLabelText('settings.fxRate.form.mid')).toHaveFocus();
    fireEvent.change(screen.getByLabelText('settings.fxRate.form.mid'), { target: { value: '0.9' } });
    fireEvent.change(screen.getByLabelText('settings.fxRate.form.spread'), { target: { value: '99' } });
    fireEvent.click(screen.getByRole('button', { name: 'settings.fxRate.form.submit' }));
    expect(screen.getByLabelText('settings.fxRate.form.spread')).toHaveFocus();
  });

  it('keeps persistent, empty aria-live containers for field errors before any error exists', () => {
    renderCard();
    for (const id of ['fx-rate-mid-error', 'fx-rate-spread-error', 'fx-rate-note-error']) {
      const region = document.getElementById(id);
      expect(region, id).not.toBeNull();
      expect(region).toHaveAttribute('aria-live', 'polite');
      expect(region).toBeEmptyDOMElement();
    }
  });

  it('ignores a second submit while the first is in flight', async () => {
    const gate = deferred();
    fxMock.setPaymentFxRate.mockReturnValue(gate.promise);
    renderCard();
    fireEvent.change(screen.getByLabelText('settings.fxRate.form.mid'), { target: { value: '0.93' } });
    const form = screen.getByLabelText('settings.fxRate.form.mid').closest('form');
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(fxMock.setPaymentFxRate).toHaveBeenCalledTimes(1);
    gate.resolve({ id: 'r2' });
    await waitFor(() => expect(toastMock).toHaveBeenCalled());
  });

  describe('large change dialog', () => {
    const open = async (props = {}) => {
      fxMock.setPaymentFxRate.mockRejectedValueOnce(toBizumError(PG_ERRORS.raise('payment_fx_large_change')));
      const utils = renderCard(props);
      fireEvent.change(screen.getByLabelText('settings.fxRate.form.mid'), { target: { value: '1.2' } });
      fireEvent.click(screen.getByRole('button', { name: 'settings.fxRate.form.submit' }));
      const dialog = await screen.findByRole('dialog');
      return { ...utils, dialog };
    };

    it('shows the previous effective rate, the new one and the % change', async () => {
      const { dialog } = await open();
      expect(dialog).toHaveTextContent('previous=0.937251');
      expect(dialog).toHaveTextContent('next=1.227');
      expect(dialog).toHaveTextContent('change=+30.91');
    });

    it('formats the comparison with the app language', async () => {
      langState.value = 'es';
      const { dialog } = await open();
      expect(dialog).toHaveTextContent('previous=0,937251');
      expect(dialog).toHaveTextContent('next=1,227');
      expect(dialog).toHaveTextContent('change=+30,91');
    });

    it('cannot be dismissed with Escape while the confirmed save is in flight', async () => {
      const gate = deferred();
      const { dialog } = await open();
      fxMock.setPaymentFxRate.mockReturnValueOnce(gate.promise);
      fireEvent.click(within(dialog).getByRole('button', { name: 'settings.fxRate.largeChange.confirm' }));
      await waitFor(() => expect(fxMock.setPaymentFxRate).toHaveBeenCalledTimes(2));
      fireEvent.keyDown(dialog, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).not.toBeNull();
      gate.resolve({ id: 'r3' });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('sends the confirmed retry only once on a double click', async () => {
      const gate = deferred();
      const { dialog } = await open();
      fxMock.setPaymentFxRate.mockReturnValueOnce(gate.promise);
      const confirm = within(dialog).getByRole('button', { name: 'settings.fxRate.largeChange.confirm' });
      fireEvent.click(confirm);
      fireEvent.click(confirm);
      expect(fxMock.setPaymentFxRate).toHaveBeenCalledTimes(2);
      gate.resolve({ id: 'r3' });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });
  });
});
