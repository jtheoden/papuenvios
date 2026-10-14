import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

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
    render(<NotifyAdminWhatsAppButton remittance={remittance} />);
    await waitFor(() => expect(getButton()).not.toBeDisabled());
    expect(openSpy).not.toHaveBeenCalled();

    fireEvent.click(getButton());
    expect(openSpy).toHaveBeenCalledTimes(1);
    const url = openSpy.mock.calls[0][0];
    expect(url).toMatch(/^https:\/\/wa\.me\/15551234567\?text=/);
    expect(decodeURIComponent(url)).toContain('REM-1');
  });

  it('shows an error toast and never throws when the recipient cannot be resolved', async () => {
    recipientMock.mockResolvedValue('');
    render(<NotifyAdminWhatsAppButton remittance={remittance} />);
    await waitFor(() => expect(getButton()).not.toBeDisabled());

    fireEvent.click(getButton());
    expect(openSpy).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }));
  });

  it('treats a rejected recipient lookup as unavailable', async () => {
    recipientMock.mockRejectedValue(new Error('network'));
    render(<NotifyAdminWhatsAppButton remittance={remittance} />);
    await waitFor(() => expect(getButton()).not.toBeDisabled());

    fireEvent.click(getButton());
    expect(openSpy).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledTimes(1);
  });
});
