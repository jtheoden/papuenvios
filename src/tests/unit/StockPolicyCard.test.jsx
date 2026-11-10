import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

const auth = { isSuperAdmin: true, user: { email: 'root@x.test' } };

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'es' })
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/stockPolicyService', async (importOriginal) => ({
  ...(await importOriginal()),
  getStockPolicy: vi.fn(),
  setStockPolicy: vi.fn(),
  resetStockPolicy: vi.fn()
}));

import StockPolicyCard from '@/components/settings/StockPolicyCard';
import { getStockPolicy, setStockPolicy, resetStockPolicy } from '@/lib/stockPolicyService';
import { toast } from '@/components/ui/use-toast';

const POLICY = {
  unpaidHours: 24,
  proofHours: 100,
  maxOpenReservations: 3,
  defaults: { unpaidHours: 48, proofHours: 168, maxOpenReservations: 5 },
  bounds: {
    unpaidHours: { min: 6, max: 720 },
    proofHours: { min: 24, max: 2160 },
    maxOpenReservations: { min: 1, max: 50 }
  }
};

const unpaid = () => screen.getByLabelText('stockPolicy.unpaid.label');
const proof = () => screen.getByLabelText('stockPolicy.proof.label');
const maxOpen = () => screen.getByLabelText('stockPolicy.maxOpen.label');
const save = () => screen.getByRole('button', { name: 'stockPolicy.save' });

const renderLoaded = async () => {
  render(<StockPolicyCard />);
  await waitFor(() => expect(unpaid()).toHaveValue(24));
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.isSuperAdmin = true;
  getStockPolicy.mockResolvedValue(POLICY);
  setStockPolicy.mockResolvedValue({ ...POLICY, unpaidHours: 30 });
  resetStockPolicy.mockResolvedValue({ ...POLICY, ...POLICY.defaults });
});

describe('StockPolicyCard', () => {
  it('renders nothing and does not even query the policy for non super admins', () => {
    auth.isSuperAdmin = false;

    const { container } = render(<StockPolicyCard />);

    expect(container).toBeEmptyDOMElement();
    expect(getStockPolicy).not.toHaveBeenCalled();
  });

  it('shows, per field: label, plain-language help, allowed range, default and current value, all accessible', async () => {
    await renderLoaded();

    expect(screen.getByRole('group', { name: 'stockPolicy.title' })).toBeInTheDocument();
    const fields = [
      [unpaid(), 'stockPolicy.unpaid.help', '6–720', '48', '24'],
      [proof(), 'stockPolicy.proof.help', '24–2160', '168', '100'],
      [maxOpen(), 'stockPolicy.maxOpen.help', '1–50', '5', '3']
    ];
    for (const [input, helpKey, range, def, current] of fields) {
      const describedBy = input.getAttribute('aria-describedby').split(' ');
      const text = describedBy.map((id) => document.getElementById(id).textContent).join(' ');
      expect(text).toContain(helpKey);
      expect(text).toContain(range);
      expect(text).toContain(def);
      expect(text).toContain(current);
    }
    expect(screen.getByText('stockPolicy.scheduleNote')).toBeInTheDocument();
  });

  it('keeps save disabled until something valid changed and shows inline errors from the bounds', async () => {
    await renderLoaded();
    expect(save()).toBeDisabled();

    fireEvent.change(unpaid(), { target: { value: '5' } });
    expect(screen.getByText('stockPolicy.errors.range')).toBeInTheDocument();
    expect(unpaid()).toHaveAttribute('aria-invalid', 'true');
    expect(save()).toBeDisabled();

    fireEvent.change(unpaid(), { target: { value: '200' } }); // now above the 100 h proof window
    expect(screen.getByText('stockPolicy.errors.belowUnpaid')).toBeInTheDocument();
    expect(save()).toBeDisabled();

    fireEvent.change(proof(), { target: { value: '300' } });
    expect(screen.queryByText('stockPolicy.errors.belowUnpaid')).toBeNull();
    expect(save()).toBeEnabled();
  });

  it('saves numbers through the service (no client-side audit data), then confirms with a toast', async () => {
    await renderLoaded();
    fireEvent.change(unpaid(), { target: { value: '30' } });

    fireEvent.click(save());

    await waitFor(() => expect(setStockPolicy).toHaveBeenCalledTimes(1));
    // Only the values travel: the audit row (before/after/actor) is written by the database.
    expect(setStockPolicy).toHaveBeenCalledWith({ unpaidHours: 30, proofHours: 100, maxOpenReservations: 3 });
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'stockPolicy.saved' }))
    );
  });

  it('shows a destructive toast when saving fails and keeps the form editable', async () => {
    setStockPolicy.mockRejectedValue(Object.assign(new Error('nope'), { code: 'FORBIDDEN' }));
    await renderLoaded();
    fireEvent.change(unpaid(), { target: { value: '30' } });

    fireEvent.click(save());

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }))
    );
    expect(unpaid()).toBeEnabled();
  });

  it('resets to defaults only after an explicit confirmation', async () => {
    await renderLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'stockPolicy.reset' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('stockPolicy.resetConfirmMessage')).toBeInTheDocument();
    expect(resetStockPolicy).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'common.cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(resetStockPolicy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'stockPolicy.reset' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'stockPolicy.resetConfirm' }));

    await waitFor(() => expect(resetStockPolicy).toHaveBeenCalledTimes(1));
    expect(resetStockPolicy).toHaveBeenCalledWith();
    await waitFor(() => expect(unpaid()).toHaveValue(48));
  });

  it('shows a load error instead of a silent empty form', async () => {
    getStockPolicy.mockRejectedValue(new Error('boom'));

    render(<StockPolicyCard />);

    expect(await screen.findByText('stockPolicy.loadError')).toBeInTheDocument();
  });
});
