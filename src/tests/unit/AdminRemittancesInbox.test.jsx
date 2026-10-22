import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';

const NOW = new Date('2026-10-14T12:00:00Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600 * 1000).toISOString();

const showModal = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key) => key, language: 'en' })
}));
vi.mock('@/contexts/ModalContext', () => ({ useModal: () => ({ showModal }) }));
vi.mock('@/components/ui/use-toast', () => ({ toast }));
vi.mock('@/lib/remittanceCalculations', () => ({
  calcTotalToPay: ({ amountSent, deliveryCost }) => Number(amountSent) + Number(deliveryCost || 0)
}));
vi.mock('@/components/ImageProofModal', () => ({
  default: ({ isOpen, proofUrl }) => (isOpen ? <div data-testid="proof-modal">{proofUrl}</div> : null)
}));
vi.mock('@/lib/remittanceService', () => {
  const groups = {
    needs_validation: ['payment_proof_uploaded'],
    needs_delivery: ['payment_validated', 'processing'],
    awaiting_customer: ['payment_pending']
  };
  return {
    REMITTANCE_WORK_GROUPS: groups,
    TO_PROCESS_STATUSES: ['payment_proof_uploaded', 'payment_validated', 'processing'],
    groupRemittancesByWork: (list) =>
      Object.fromEntries(
        Object.keys(groups).map((key) => [key, list.filter((r) => groups[key].includes(r.status))])
      ),
    validatePayment: vi.fn(async () => ({})),
    rejectPayment: vi.fn(async () => ({})),
    startProcessing: vi.fn(async () => ({})),
    confirmDelivery: vi.fn(async () => ({}))
  };
});

import AdminRemittancesInbox from '@/components/admin/AdminRemittancesInbox';
import { validatePayment, rejectPayment, startProcessing, confirmDelivery } from '@/lib/remittanceService';

const base = {
  currency_sent: 'USD',
  currency_delivered: 'CUP',
  amount_to_deliver: 100,
  delivery_cost: 0,
  recipient_name: 'Maria',
  sender_name: 'Juan',
  payment_method: 'zelle'
};

const REMITTANCES = [
  { ...base, id: 'p-new', remittance_number: 'REM-PENDING-NEW', status: 'payment_pending', amount_sent: 10, created_at: hoursAgo(2) },
  { ...base, id: 'v-new', remittance_number: 'REM-PROOF-NEW', status: 'payment_proof_uploaded', amount_sent: 20, created_at: hoursAgo(5), payment_proof_url: 'u/new.png' },
  { ...base, id: 'v-old', remittance_number: 'REM-PROOF-OLD', status: 'payment_proof_uploaded', amount_sent: 30, created_at: hoursAgo(50), payment_proof_url: 'u/old.png' },
  { ...base, id: 'd-val', remittance_number: 'REM-VALIDATED', status: 'payment_validated', amount_sent: 40, created_at: hoursAgo(30) },
  { ...base, id: 'd-proc', remittance_number: 'REM-PROCESSING', status: 'processing', amount_sent: 50, created_at: hoursAgo(10) }
];

const renderInbox = (props = {}) => {
  const onChanged = vi.fn();
  const onRetry = vi.fn();
  const onNavigate = vi.fn();
  const utils = render(
    <AdminRemittancesInbox
      remittances={REMITTANCES}
      loading={false}
      error={null}
      onRetry={onRetry}
      onChanged={onChanged}
      onNavigate={onNavigate}
      liveMessage=""
      {...props}
    />
  );
  return { ...utils, onChanged, onRetry, onNavigate };
};

const rowNumbers = () =>
  screen.getAllByRole('listitem').map((li) => li.getAttribute('data-remittance-number'));

describe('AdminRemittancesInbox', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    showModal.mockReset();
    toast.mockReset();
    validatePayment.mockClear();
    rejectPayment.mockClear();
    startProcessing.mockClear();
    confirmDelivery.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('lists the default "to process" view grouped (validate first) and oldest first', () => {
    renderInbox();
    expect(rowNumbers()).toEqual(['REM-PROOF-OLD', 'REM-PROOF-NEW', 'REM-VALIDATED', 'REM-PROCESSING']);
  });

  it('shows a count on every filter chip and the default chip is pressed', () => {
    renderInbox();
    const chip = (key) => screen.getByRole('button', { name: new RegExp(`adminInbox.filter.${key}`) });
    expect(within(chip('toProcess')).getByText('4')).toBeTruthy();
    expect(within(chip('needsValidation')).getByText('2')).toBeTruthy();
    expect(within(chip('needsDelivery')).getByText('2')).toBeTruthy();
    expect(within(chip('awaitingCustomer')).getByText('1')).toBeTruthy();
    expect(within(chip('all')).getByText('5')).toBeTruthy();
    expect(chip('toProcess').getAttribute('aria-pressed')).toBe('true');
  });

  it('switches to the delivery view with its own rows', () => {
    renderInbox();
    fireEvent.click(screen.getByRole('button', { name: /adminInbox.filter.needsDelivery/ }));
    expect(rowNumbers()).toEqual(['REM-VALIDATED', 'REM-PROCESSING']);
  });

  it('renders sender, recipient, amount, payment method chip and a text status badge', () => {
    renderInbox();
    const row = screen.getAllByRole('listitem').find((li) => li.getAttribute('data-remittance-number') === 'REM-PROOF-NEW');
    expect(within(row).getByText('Juan')).toBeTruthy();
    expect(within(row).getByText('Maria')).toBeTruthy();
    expect(within(row).getByText(/20 USD/)).toBeTruthy();
    expect(within(row).getByText('zelle')).toBeTruthy();
    expect(within(row).getByText('remittances.status.paymentProofUploaded')).toBeTruthy();
  });

  it('marks remittances older than 48h with visible Overdue text and not the recent ones', () => {
    renderInbox();
    const rows = screen.getAllByRole('listitem');
    const old = rows.find((li) => li.getAttribute('data-remittance-number') === 'REM-PROOF-OLD');
    const recent = rows.find((li) => li.getAttribute('data-remittance-number') === 'REM-PROOF-NEW');
    expect(within(old).getByText('adminInbox.age.overdue')).toBeTruthy();
    expect(within(recent).queryByText('adminInbox.age.overdue')).toBeNull();
  });

  it('exposes the age as a <time> element with dateTime and title', () => {
    renderInbox();
    const row = screen.getAllByRole('listitem').find((li) => li.getAttribute('data-remittance-number') === 'REM-PROOF-NEW');
    const time = row.querySelector('time');
    expect(time.getAttribute('datetime')).toBe(hoursAgo(5));
    expect(time.getAttribute('title')).toBeTruthy();
  });

  it('opens the payment proof from a button with a descriptive aria-label', () => {
    renderInbox();
    fireEvent.click(screen.getAllByRole('button', { name: /adminInbox.viewProofAria/ })[0]);
    expect(screen.getByTestId('proof-modal')).toBeTruthy();
  });

  it('validates a payment through the service and reports the change', async () => {
    showModal.mockResolvedValue('looks good');
    const { onChanged } = renderInbox();
    const row = screen.getAllByRole('listitem').find((li) => li.getAttribute('data-remittance-number') === 'REM-PROOF-OLD');
    fireEvent.click(within(row).getByRole('button', { name: 'adminInbox.validate' }));
    await waitFor(() => expect(validatePayment).toHaveBeenCalledWith('v-old', 'looks good'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('does not validate when the admin cancels the modal', async () => {
    showModal.mockResolvedValue(false);
    const { onChanged } = renderInbox();
    const row = screen.getAllByRole('listitem').find((li) => li.getAttribute('data-remittance-number') === 'REM-PROOF-OLD');
    fireEvent.click(within(row).getByRole('button', { name: 'adminInbox.validate' }));
    await waitFor(() => expect(showModal).toHaveBeenCalled());
    expect(validatePayment).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('rejects a payment with the typed reason', async () => {
    showModal.mockResolvedValue('blurry proof');
    renderInbox();
    const row = screen.getAllByRole('listitem').find((li) => li.getAttribute('data-remittance-number') === 'REM-PROOF-OLD');
    fireEvent.click(within(row).getByRole('button', { name: 'adminInbox.reject' }));
    await waitFor(() => expect(rejectPayment).toHaveBeenCalledWith('v-old', 'blurry proof'));
  });

  it('starts processing a validated remittance from the delivery view', async () => {
    showModal.mockResolvedValue(true);
    const { onChanged } = renderInbox();
    fireEvent.click(screen.getByRole('button', { name: /adminInbox.filter.needsDelivery/ }));
    const row = screen.getAllByRole('listitem').find((li) => li.getAttribute('data-remittance-number') === 'REM-VALIDATED');
    fireEvent.click(within(row).getByRole('button', { name: 'adminInbox.startProcessing' }));
    await waitFor(() => expect(startProcessing).toHaveBeenCalledWith('d-val', ''));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('shows a destructive toast and keeps going when the service fails', async () => {
    showModal.mockResolvedValue('');
    validatePayment.mockRejectedValueOnce(new Error('boom'));
    const { onChanged } = renderInbox();
    const row = screen.getAllByRole('listitem').find((li) => li.getAttribute('data-remittance-number') === 'REM-PROOF-OLD');
    fireEvent.click(within(row).getByRole('button', { name: 'adminInbox.validate' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' })));
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('explains a status conflict (someone else already moved the remittance) instead of the raw error', async () => {
    showModal.mockResolvedValue('');
    const conflict = Object.assign(new Error('Remittance r changed state'), {
      code: 'CONFLICT',
      context: { reason: 'invalid_transition' }
    });
    validatePayment.mockRejectedValueOnce(conflict);
    renderInbox();
    const row = screen.getAllByRole('listitem').find((li) => li.getAttribute('data-remittance-number') === 'REM-PROOF-OLD');
    fireEvent.click(within(row).getByRole('button', { name: 'adminInbox.validate' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive', description: 'common.statusConflict' }))
    );
  });

  it('shows a busy skeleton while loading', () => {
    const { container } = renderInbox({ remittances: [], loading: true });
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(screen.queryAllByRole('listitem').length).toBe(0);
  });

  it('shows the all-caught-up empty state', () => {
    renderInbox({ remittances: [] });
    expect(screen.getByText('adminInbox.emptyToProcess')).toBeTruthy();
  });

  it('does not show the empty state while the delivery group has items', () => {
    renderInbox({ remittances: REMITTANCES.filter((r) => r.status === 'processing') });
    expect(screen.queryByText('adminInbox.emptyToProcess')).toBeNull();
    expect(rowNumbers()).toEqual(['REM-PROCESSING']);
  });

  it('shows the empty state when only customer-pending remittances exist', () => {
    renderInbox({ remittances: REMITTANCES.filter((r) => r.status === 'payment_pending') });
    expect(screen.getByText('adminInbox.emptyToProcess')).toBeTruthy();
  });

  it('disables Confirm delivery without delivery proof, with a visible hint and a link to the full tab', () => {
    renderInbox();
    const row = screen.getAllByRole('listitem').find((li) => li.getAttribute('data-remittance-number') === 'REM-PROCESSING');
    expect(within(row).getByRole('button', { name: 'adminInbox.confirmDelivery' }).disabled).toBe(true);
    expect(within(row).getByText('adminInbox.deliveryProofMissing')).toBeTruthy();
    expect(within(row).getByRole('link', { name: 'adminInbox.openFullTab' }).getAttribute('href')).toBe('/dashboard?tab=remittances');
  });

  it('enables Confirm delivery when the delivery proof exists and confirms through the service', async () => {
    showModal.mockResolvedValue('');
    const withProof = REMITTANCES.map((r) => (r.id === 'd-proc' ? { ...r, delivery_proof_url: 'u/d.png' } : r));
    renderInbox({ remittances: withProof });
    const row = screen.getAllByRole('listitem').find((li) => li.getAttribute('data-remittance-number') === 'REM-PROCESSING');
    const button = within(row).getByRole('button', { name: 'adminInbox.confirmDelivery' });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(confirmDelivery).toHaveBeenCalledWith('d-proc', null, ''));
  });

  it('shows an inline warning and keeps the list when a refresh failed after a good load', () => {
    renderInbox({ stale: true });
    expect(screen.getByText('adminInbox.staleWarning')).toBeTruthy();
    expect(rowNumbers().length).toBe(4);
  });

  it('labels the skeleton for assistive tech with the loading text', () => {
    renderInbox({ remittances: [], loading: true });
    expect(screen.getByText('adminInbox.loading')).toBeTruthy();
  });

  it('shows an error with a Retry button that calls onRetry', () => {
    const { onRetry } = renderInbox({ remittances: [], error: new Error('x') });
    expect(screen.getByRole('alert').textContent).toContain('adminInbox.error');
    fireEvent.click(screen.getByRole('button', { name: 'adminInbox.retry' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('links to the full remittances dashboard tab', () => {
    const { onNavigate } = renderInbox();
    const link = screen.getByRole('link', { name: 'adminInbox.viewAll' });
    expect(link.getAttribute('href')).toBe('/dashboard?tab=remittances');
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith('dashboard');
    expect(window.location.search).toContain('tab=remittances');
  });

  it('announces new arrivals politely', () => {
    renderInbox({ liveMessage: 'adminInbox.liveNew' });
    const live = screen.getByText('adminInbox.liveNew');
    expect(live.closest('[aria-live="polite"]')).toBeTruthy();
  });
});
