import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const { svcMock, toastMock } = vi.hoisted(() => ({ svcMock: { setBizumSettings: vi.fn() }, toastMock: vi.fn() }));

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock('@/contexts/LanguageContext', async () => {
  const { tEcho } = await import('./helpers/bizumTestUtils.js');
  return { useLanguage: () => ({ t: tEcho, language: 'en' }) };
});
vi.mock('@/components/ui/use-toast', () => ({ toast: (...a) => toastMock(...a) }));
vi.mock('@/lib/bizumService', async (importOriginal) => ({
  ...(await importOriginal()),
  setBizumSettings: (...a) => svcMock.setBizumSettings(...a)
}));

import BizumSettingsCard from '@/components/settings/BizumSettingsCard';
import { BIZUM_SETTING_FIELDS } from '@/lib/bizumService';
import { toBizumError } from '@/lib/bizumErrors';
import { PG_ERRORS } from './helpers/bizumTestUtils';

const SETTINGS = {
  default_spread_pct: 1.5, quote_validity_minutes: 240, quote_grace_hours: 24, fx_warn_hours: 24, fx_block_hours: 96,
  fx_max_change_pct: 5, default_per_operation_limit: 1000, remittance_warn_hours: 48, remittance_expire_hours: 72,
  max_unpaid_ops_per_user: 3, max_open_quotes_per_user: 3, max_quotes_per_hour: 10, proof_retention_years: 5
};

const label = (key) => `settings.bizum.fields.${key}.label`;
const save = () => screen.getByRole('button', { name: 'settings.bizum.settings.save' });

const renderCard = (props = {}) => {
  const onSaved = vi.fn();
  const onRetry = vi.fn();
  render(<BizumSettingsCard settings={SETTINGS} error={null} onSaved={onSaved} onRetry={onRetry} {...props} />);
  return { onSaved, onRetry };
};

beforeEach(() => {
  svcMock.setBizumSettings.mockReset();
  toastMock.mockReset();
  svcMock.setBizumSettings.mockImplementation(async (patch) => ({ ...SETTINGS, ...patch }));
});

describe('BizumSettingsCard form', () => {
  it('renders every parameter with label, unit, range and default visible as help', () => {
    renderCard();
    for (const field of BIZUM_SETTING_FIELDS) {
      const input = screen.getByLabelText(label(field.key));
      expect(input).toHaveValue(String(SETTINGS[field.key]));
      const help = document.getElementById(`bizum-setting-${field.key}-meta`);
      expect(help, field.key).not.toBeNull();
      expect(help.textContent).toContain(`min=${field.min}`);
      expect(help.textContent).toContain(`max=${field.max}`);
      expect(help.textContent).toContain(`default=${field.default}`);
      expect(help.textContent).toContain(`settings.bizum.units.${field.unit}`);
      expect(input.getAttribute('aria-describedby')).toContain(`bizum-setting-${field.key}-meta`);
    }
  });

  it('keeps save disabled until something changes', () => {
    renderCard();
    expect(save()).toBeDisabled();
    fireEvent.change(screen.getByLabelText(label('fx_warn_hours')), { target: { value: '12' } });
    expect(save()).toBeEnabled();
  });

  it('sends only the modified keys, as numbers', async () => {
    const { onSaved } = renderCard();
    fireEvent.change(screen.getByLabelText(label('fx_warn_hours')), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText(label('default_spread_pct')), { target: { value: '2.25' } });
    fireEvent.click(save());
    await waitFor(() => expect(svcMock.setBizumSettings).toHaveBeenCalledTimes(1));
    expect(svcMock.setBizumSettings).toHaveBeenCalledWith({ fx_warn_hours: 12, default_spread_pct: 2.25 });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ ...SETTINGS, fx_warn_hours: 12, default_spread_pct: 2.25 }));
  });

  it('blocks invalid values locally with a field error linked via aria-describedby', () => {
    renderCard();
    const input = screen.getByLabelText(label('max_quotes_per_hour'));
    fireEvent.change(input, { target: { value: '500' } });
    expect(save()).toBeDisabled();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const ids = input.getAttribute('aria-describedby').split(' ');
    expect(ids.some((id) => document.getElementById(id)?.textContent.includes('settings.bizum.validation.range'))).toBe(true);
    expect(svcMock.setBizumSettings).not.toHaveBeenCalled();
  });

  it('shows the server out_of_range error on the offending field', async () => {
    svcMock.setBizumSettings.mockRejectedValue(toBizumError(PG_ERRORS.raise('bizum_settings_out_of_range', 'key=fx_block_hours')));
    renderCard();
    const input = screen.getByLabelText(label('fx_block_hours'));
    fireEvent.change(input, { target: { value: '30' } });
    fireEvent.click(save());
    await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'));
    const ids = input.getAttribute('aria-describedby').split(' ');
    expect(ids.some((id) => document.getElementById(id)?.textContent.includes('settings.bizum.errors.outOfRange'))).toBe(true);
  });

  it('shows a general alert for non-field errors', async () => {
    svcMock.setBizumSettings.mockRejectedValue(toBizumError(PG_ERRORS.raise('bizum_settings_forbidden', null, '42501')));
    renderCard();
    fireEvent.change(screen.getByLabelText(label('fx_warn_hours')), { target: { value: '12' } });
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('settings.bizum.errors.forbidden'));
  });

  it('restore-recommended only fills the form, it does not call the server', () => {
    renderCard();
    const input = screen.getByLabelText(label('fx_warn_hours'));
    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: `settings.bizum.restore ${label('fx_warn_hours')}` }));
    expect(input).toHaveValue('24');
    expect(svcMock.setBizumSettings).not.toHaveBeenCalled();
  });

  it('restore-recommended makes the field dirty when the stored value differs from the default', async () => {
    renderCard({ settings: { ...SETTINGS, fx_warn_hours: 12 } });
    expect(save()).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: `settings.bizum.restore ${label('fx_warn_hours')}` }));
    expect(save()).toBeEnabled();
    fireEvent.click(save());
    await waitFor(() => expect(svcMock.setBizumSettings).toHaveBeenCalledWith({ fx_warn_hours: 24 }));
  });

  it('shows an own error alert with retry when the settings failed to load', () => {
    const { onRetry } = renderCard({ settings: null, error: toBizumError({ code: 'XX000', message: 'boom' }) });
    expect(screen.getByRole('alert')).toHaveTextContent('settings.bizum.errors.unknown');
    fireEvent.click(screen.getByRole('button', { name: 'settings.bizum.retry' }));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe('BizumSettingsCard keeps what the admin typed while saving / when settings refresh', () => {
  it('does not overwrite a field edited while the save is in flight', async () => {
    let resolve;
    svcMock.setBizumSettings.mockReturnValue(new Promise((res) => { resolve = res; }));
    const { onSaved } = renderCard();
    fireEvent.change(screen.getByLabelText(label('fx_warn_hours')), { target: { value: '12' } });
    fireEvent.click(save());
    fireEvent.change(screen.getByLabelText(label('quote_grace_hours')), { target: { value: '30' } });
    await act(async () => {
      resolve({ ...SETTINGS, fx_warn_hours: 12 });
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(screen.getByLabelText(label('quote_grace_hours'))).toHaveValue('30');
    expect(screen.getByLabelText(label('fx_warn_hours'))).toHaveValue('12');
  });

  it('rebases onto refreshed settings without losing dirty fields', () => {
    const { rerender } = render(<BizumSettingsCard settings={SETTINGS} error={null} onSaved={vi.fn()} onRetry={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(label('quote_grace_hours')), { target: { value: '30' } });
    rerender(<BizumSettingsCard settings={{ ...SETTINGS, fx_warn_hours: 10 }} error={null} onSaved={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByLabelText(label('quote_grace_hours'))).toHaveValue('30');
    expect(screen.getByLabelText(label('fx_warn_hours'))).toHaveValue('10');
  });

  it('has a persistent empty aria-live container per field', () => {
    renderCard();
    const region = document.getElementById('bizum-setting-fx_warn_hours-error');
    expect(region).not.toBeNull();
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toBeEmptyDOMElement();
  });

  it('ignores a second save while one is in flight', async () => {
    let resolve;
    svcMock.setBizumSettings.mockReturnValue(new Promise((res) => { resolve = res; }));
    renderCard();
    fireEvent.change(screen.getByLabelText(label('fx_warn_hours')), { target: { value: '12' } });
    const form = screen.getByLabelText(label('fx_warn_hours')).closest('form');
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(svcMock.setBizumSettings).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve({ ...SETTINGS, fx_warn_hours: 12 });
    });
  });
});
