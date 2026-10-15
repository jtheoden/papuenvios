import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'es' }),
}));

const auth = { user: { id: 'u1' } };
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }));

const toast = vi.fn();
vi.mock('@/components/ui/use-toast', () => ({ toast: (...args) => toast(...args) }));

const checkCurrentAcceptance = vi.fn();
const recordLegalAcceptance = vi.fn();
vi.mock('@/lib/legalAcceptanceService', () => ({
  checkCurrentAcceptance: (...args) => checkCurrentAcceptance(...args),
  recordLegalAcceptance: (...args) => recordLegalAcceptance(...args),
}));

import { LegalAcceptanceProvider, useLegalAcceptance } from '@/contexts/LegalAcceptanceContext';

let ensure;
const Probe = () => {
  ({ ensureAccepted: ensure } = useLegalAcceptance());
  return null;
};

const mount = () =>
  render(
    <LegalAcceptanceProvider>
      <Probe />
    </LegalAcceptanceProvider>
  );

const acceptInModal = async () => {
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(screen.getByLabelText('legal.gate.birthDateLabel'), { target: { value: '1990-05-01' } });
  fireEvent.click(screen.getByRole('button', { name: 'legal.gate.accept' }));
};

beforeEach(() => {
  checkCurrentAcceptance.mockReset();
  recordLegalAcceptance.mockReset();
  toast.mockReset();
  auth.user = { id: 'u1' };
});

describe('LegalAcceptanceProvider.ensureAccepted', () => {
  it('resolves true without any lookup when nobody is signed in (login is handled by the caller)', async () => {
    auth.user = null;
    mount();
    await expect(ensure('checkout')).resolves.toBe(true);
    expect(checkCurrentAcceptance).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('resolves true without a modal when acceptance is current, and caches it in memory', async () => {
    checkCurrentAcceptance.mockResolvedValue('accepted');
    mount();
    await waitFor(() => expect(checkCurrentAcceptance).toHaveBeenCalledTimes(1)); // warm-up after login
    await expect(ensure('checkout')).resolves.toBe(true);
    await expect(ensure('remittance')).resolves.toBe(true);
    expect(checkCurrentAcceptance).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('fails open when the server side is unavailable (migration not applied yet)', async () => {
    checkCurrentAcceptance.mockResolvedValue('unavailable');
    mount();
    await expect(ensure('checkout')).resolves.toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('blocks with a retryable message when the check fails for any reason other than a missing RPC', async () => {
    checkCurrentAcceptance.mockResolvedValue('error');
    mount();
    await expect(ensure('checkout')).resolves.toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive', description: 'legal.gate.errors.checkFailed' })
    );
    // retry works once the backend answers
    checkCurrentAcceptance.mockResolvedValue('accepted');
    await expect(ensure('checkout')).resolves.toBe(true);
  });

  it('resolves false and closes the gate when the session changes or ends while it is open', async () => {
    checkCurrentAcceptance.mockResolvedValue('required');
    const { rerender } = mount();
    const pending = ensure('checkout');
    await screen.findByRole('dialog');
    auth.user = null;
    rerender(
      <LegalAcceptanceProvider>
        <Probe />
      </LegalAcceptanceProvider>
    );
    await expect(pending).resolves.toBe(false);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('opens the gate when acceptance is required and resolves true after the user accepts', async () => {
    checkCurrentAcceptance.mockResolvedValue('required');
    recordLegalAcceptance.mockResolvedValue({ ok: true });
    mount();
    let result;
    const pending = ensure('checkout').then((v) => { result = v; });
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(result).toBeUndefined();
    await acceptInModal();
    await act(async () => { await pending; });
    expect(result).toBe(true);
    expect(recordLegalAcceptance).toHaveBeenCalledWith({ birthDate: '1990-05-01', source: 'checkout' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // positive result is now cached: no further lookup
    checkCurrentAcceptance.mockClear();
    await expect(ensure('checkout')).resolves.toBe(true);
    expect(checkCurrentAcceptance).not.toHaveBeenCalled();
  });

  it('resolves false when the user cancels, and asks again next time', async () => {
    checkCurrentAcceptance.mockResolvedValue('required');
    mount();
    const pending = ensure('remittance');
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'legal.gate.cancel' }));
    await expect(pending).resolves.toBe(false);
    expect(recordLegalAcceptance).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const again = ensure('remittance');
    expect(await screen.findByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'legal.gate.cancel' }));
    await expect(again).resolves.toBe(false);
  });

  it('shares one modal between concurrent callers', async () => {
    checkCurrentAcceptance.mockResolvedValue('required');
    recordLegalAcceptance.mockResolvedValue({ ok: true });
    mount();
    const a = ensure('checkout');
    const b = ensure('checkout');
    await screen.findByRole('dialog');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    await acceptInModal();
    await expect(Promise.all([a, b])).resolves.toEqual([true, true]);
  });

  it('does not reuse the cache for a different user', async () => {
    checkCurrentAcceptance.mockResolvedValue('accepted');
    const { rerender } = mount();
    await expect(ensure('checkout')).resolves.toBe(true);
    checkCurrentAcceptance.mockResolvedValue('required');
    auth.user = { id: 'u2' };
    rerender(
      <LegalAcceptanceProvider>
        <Probe />
      </LegalAcceptanceProvider>
    );
    const pending = ensure('checkout');
    expect(await screen.findByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'legal.gate.cancel' }));
    await expect(pending).resolves.toBe(false);
  });
});

describe('useLegalAcceptance outside a provider', () => {
  it('returns a pass-through ensureAccepted so isolated components keep working', async () => {
    render(<Probe />);
    await expect(ensure('checkout')).resolves.toBe(true);
  });
});
