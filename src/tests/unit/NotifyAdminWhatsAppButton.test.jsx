import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const STRINGS = {
  'remittances.notifyAdmin.button': 'Avisar al administrador por WhatsApp',
  'remittances.notifyAdmin.noRecipientTitle': 'No se pudo avisar',
  'remittances.notifyAdmin.noRecipient': 'Numero no configurado'
};

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => STRINGS[key] ?? key, language: 'es' })
}));

const toastMock = vi.fn();
vi.mock('@/components/ui/use-toast', () => ({ toast: (...args) => toastMock(...args) }));

const recipientMock = vi.fn();
vi.mock('@/lib/notificationSettingsService', () => ({
  getFreshGuidedWhatsappPhone: () => recipientMock()
}));

vi.mock('@/lib/supabase', () => ({ supabase: { storage: { from: vi.fn() } } }));

import NotifyAdminWhatsAppButton from '@/components/NotifyAdminWhatsAppButton';

const remittance = {
  id: 'rem-1',
  remittance_number: 'REM-1',
  amount_sent: 10,
  currency_sent: 'USD',
  recipient_name: 'Maria',
  payment_proof_url: 'https://x.test/proof.png'
};

const getButton = () => screen.getByRole('button', { name: /Avisar al administrador por WhatsApp/ });

// Mount and wait until the recipient lookup finished (the button leaves its disabled/loading state).
// act() flushes the already-resolved mocks and the resulting render inside the test's control; polling a
// ByRole query instead is costly (the first call is cold) and, under CPU load, each render hop queued behind
// a poll, leaving the button disabled past the 5 s timeout. The poll below uses a cheap text query.
const mountReady = async () => {
  render(<NotifyAdminWhatsAppButton remittance={remittance} />);
  await act(async () => {});
  await waitFor(() => expect(screen.getByText('Avisar al administrador por WhatsApp').closest('button')).not.toBeDisabled());
};

describe('NotifyAdminWhatsAppButton', () => {
  let openSpy;

  beforeEach(() => {
    toastMock.mockClear();
    recipientMock.mockReset();
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not open WhatsApp on mount, only on click (user gesture)', async () => {
    recipientMock.mockResolvedValue('+15551234567');
    await mountReady();
    expect(openSpy).not.toHaveBeenCalled();

    fireEvent.click(getButton());
    expect(openSpy).toHaveBeenCalledTimes(1);
    const url = openSpy.mock.calls[0][0];
    expect(url).toMatch(/^https:\/\/wa\.me\/15551234567\?text=/);
    expect(decodeURIComponent(url)).toContain('REM-1');
  });

  it('shows an error toast and never throws when the recipient cannot be resolved', async () => {
    recipientMock.mockResolvedValue('');
    await mountReady();

    fireEvent.click(getButton());
    expect(openSpy).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }));
  });

  it('treats a rejected recipient lookup as unavailable', async () => {
    recipientMock.mockRejectedValue(new Error('network'));
    await mountReady();

    fireEvent.click(getButton());
    expect(openSpy).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledTimes(1);
  });
});
