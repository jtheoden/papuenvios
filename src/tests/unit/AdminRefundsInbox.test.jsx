import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';

// @testing-library/user-event is not a dependency of the project: minimal equivalents on top of fireEvent.
const userEvent = {
  click: async (element) => {
    element.focus?.();
    fireEvent.click(element);
  },
  type: async (element, text) => {
    fireEvent.change(element, { target: { value: `${element.value}${text}` } });
  },
  clear: async (element) => {
    fireEvent.change(element, { target: { value: '' } });
  },
  keyboard: async (keys) => {
    if (keys === '{Escape}') fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' });
  }
};

const NOW = new Date('2026-10-30T12:00:00.000Z');
const iso = (hours) => new Date(NOW.getTime() + hours * 3600 * 1000).toISOString();

const resolveRefund = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());
const proofModal = vi.hoisted(() => vi.fn());

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'en',
    t: (key, params) => (params ? `${key}|${Object.values(params).join('|')}` : key)
  })
}));
vi.mock('@/components/ui/use-toast', () => ({ toast }));
const getRefundDisputeStates = vi.hoisted(() => vi.fn());
vi.mock('@/lib/refundService', () => ({
  getRefundDisputeStates,
  resolveRefund,
  notifyRefundsChanged: () => window.dispatchEvent(new Event('papuenvios:refunds-changed'))
}));
vi.mock('@/components/ImageProofModal', () => ({
  default: (props) => {
    proofModal(props);
    return props.isOpen ? <div data-testid="proof-modal">{props.bucketName}</div> : null;
  }
}));

import AdminRefundsInbox from '@/components/admin/AdminRefundsInbox';

const base = {
  status: 'pending',
  payment_evidence: 'validated',
  amount: '250.00',
  currency: 'USD',
  eligible_at: iso(-10),
  due_at: iso(100),
  customer_name: 'Ana Perez',
  customer_email: 'ana@example.test',
  payer_phone: '+13055550100',
  payment_reference: 'PAY-1',
  cancelled_at: iso(-60),
  cancelled_by_role: 'admin',
  cancellation_reason: 'out of stock',
  zelle_account: { id: 'z1', account_name: 'Cuenta A', email: 'zelle@example.test' },
  payment_proof_url: 'payment-proofs/p.jpg',
  resolution_reason: null,
  resolved_at: null
};
const mk = (over) => ({ ...base, ...over });

const overdue = mk({ id: 'over', operation_type: 'order', order_id: 'o1', operation_number: 'ORD-1042', due_at: iso(-30) });
const soon = mk({ id: 'soon', operation_type: 'remittance', remittance_id: 'm1', operation_number: 'REM-0311', payment_evidence: 'proof_unverified', amount: '60.00', due_at: iso(5) });
const onTime = mk({ id: 'ontime', operation_type: 'order', order_id: 'o2', operation_number: 'ORD-2000', amount: '10.00' });
const hold = mk({ id: 'hold', operation_type: 'order', order_id: 'o3', operation_number: 'ORD-3000', eligible_at: iso(12), due_at: iso(130), amount: '5.00' });
const refunded = mk({ id: 'done', status: 'refunded', operation_type: 'order', order_id: 'o4', operation_number: 'ORD-4000', refund_reference: 'ZELLE-77', refunded_at: iso(-3), resolved_at: iso(-3) });
const reopened = mk({ id: 'reopen', status: 'not_applicable', operation_type: 'order', order_id: 'o5', operation_number: 'ORD-5000', resolution_reason: 'reopened', resolved_at: iso(-2) });
const na = mk({ id: 'na', status: 'not_applicable', operation_type: 'remittance', remittance_id: 'm2', operation_number: 'REM-9000', resolution_reason: 'never arrived', resolved_at: iso(-5) });
const ALL = [onTime, hold, soon, overdue, refunded, reopened, na];

const renderInbox = (props = {}) => {
  const onChanged = vi.fn(async () => {});
  const utils = render(<AdminRefundsInbox refunds={ALL} now={NOW} onChanged={onChanged} onRetry={vi.fn()} {...props} />);
  return { ...utils, onChanged };
};

const cardOf = (number) => document.querySelector(`[data-operation-number="${number}"]`);
const numbersShown = () => [...document.querySelectorAll('[data-operation-number]')].map((n) => n.getAttribute('data-operation-number'));

describe('AdminRefundsInbox', () => {
  beforeEach(() => {
    resolveRefund.mockReset();
    getRefundDisputeStates.mockReset();
    getRefundDisputeStates.mockResolvedValue(null);
    resolveRefund.mockResolvedValue({});
    toast.mockReset();
    proofModal.mockReset();
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
  });

  describe('states', () => {
    it('shows a skeleton while loading', () => {
      renderInbox({ loading: true, refunds: [] });
      expect(screen.getByTestId('refunds-skeleton')).toBeTruthy();
    });

    it('shows an alert with retry when the first load failed', async () => {
      const onRetry = vi.fn();
      renderInbox({ error: new Error('x'), refunds: [], onRetry });
      const alert = screen.getByRole('alert');
      await userEvent.click(within(alert).getByRole('button', { name: 'adminRefunds.states.retry' }));
      expect(onRetry).toHaveBeenCalled();
    });

    it('shows the stale warning but keeps the list when a later refresh failed', () => {
      renderInbox({ stale: true });
      expect(screen.getByText('adminRefunds.states.stale')).toBeTruthy();
      expect(numbersShown().length).toBeGreaterThan(0);
    });

    it('says how many are shown when the server has more than the page', () => {
      renderInbox({ total: 523 });
      expect(screen.getByText(`adminRefunds.states.showing|${ALL.length}|523`)).toBeTruthy();
    });

    it('shows no such note when everything fits', () => {
      renderInbox({ total: ALL.length });
      expect(screen.queryByText(/adminRefunds\.states\.showing/)).toBeNull();
    });

    it('shows the launch empty state', () => {
      renderInbox({ refunds: [] });
      expect(screen.getByText('adminRefunds.states.emptyPending')).toBeTruthy();
    });

    it('with only on-hold items, says how many are waiting', () => {
      renderInbox({ refunds: [hold] });
      expect(screen.getByText(/adminRefunds\.states\.emptyOnHold\|1\|48/)).toBeTruthy();
    });

    it('announces news in a polite live region', () => {
      renderInbox({ liveMessage: '1 new' });
      expect(document.querySelector('[aria-live="polite"]').textContent).toBe('1 new');
    });
  });

  describe('summary, filters and ordering', () => {
    it('summarizes pending, USD amount (labelled USD only), and due soon / overdue', () => {
      renderInbox();
      const summary = screen.getByTestId('refunds-summary');
      // pending: onTime, hold, soon, overdue
      expect(within(summary).getByText('4')).toBeTruthy();
      expect(within(summary).getByText('adminRefunds.summary.amountUsd')).toBeTruthy();
      expect(within(summary).getByText('$325.00')).toBeTruthy();
      expect(within(summary).getByText('1 / 1')).toBeTruthy();
    });

    it('defaults to "to refund": actionable only, overdue first, no on-hold, no resolved', () => {
      renderInbox();
      expect(numbersShown()).toEqual(['ORD-1042', 'REM-0311', 'ORD-2000']);
      expect(screen.getByRole('button', { name: /adminRefunds\.filter\.toRefund/ }).getAttribute('aria-pressed')).toBe('true');
    });

    it('chips carry counts', () => {
      renderInbox();
      const counts = Object.fromEntries(
        ['toRefund', 'verify', 'onHold', 'overdue', 'refunded', 'notApplicable', 'all'].map((id) => {
          const chip = screen.getByRole('button', { name: new RegExp(`adminRefunds\\.filter\\.${id}`) });
          return [id, chip.querySelector('[data-count]').textContent];
        })
      );
      expect(counts).toEqual({ toRefund: '3', verify: '1', onHold: '1', overdue: '1', refunded: '1', notApplicable: '2', all: '7' });
    });

    it.each([
      ['verify', ['REM-0311']],
      ['onHold', ['ORD-3000']],
      ['overdue', ['ORD-1042']],
      ['refunded', ['ORD-4000']],
      ['notApplicable', ['ORD-5000', 'REM-9000']],
      ['all', ['ORD-1042', 'REM-0311', 'ORD-2000', 'ORD-3000', 'ORD-5000', 'ORD-4000', 'REM-9000']]
    ])('filter %s', async (id, expected) => {
      renderInbox();
      await userEvent.click(screen.getByRole('button', { name: new RegExp(`adminRefunds\\.filter\\.${id}`) }));
      expect(numbersShown()).toEqual(expected);
    });

    it('filters by operation type and by search text', async () => {
      renderInbox();
      await userEvent.click(screen.getByRole('button', { name: 'adminRefunds.type.remittance' }));
      expect(numbersShown()).toEqual(['REM-0311']);
      await userEvent.click(screen.getByRole('button', { name: 'adminRefunds.type.all' }));
      await userEvent.type(screen.getByLabelText('adminRefunds.searchLabel'), 'ord-2000');
      expect(numbersShown()).toEqual(['ORD-2000']);
      await userEvent.clear(screen.getByLabelText('adminRefunds.searchLabel'));
      await userEvent.type(screen.getByLabelText('adminRefunds.searchLabel'), 'zzz');
      expect(screen.getByText('adminRefunds.states.emptyFilter')).toBeTruthy();
    });
  });

  describe('cards', () => {
    it('shows level, amount, customer, zelle account, reference and exact deadline', () => {
      renderInbox();
      const card = cardOf('ORD-1042');
      expect(within(card).getByText('adminRefunds.level.validated')).toBeTruthy();
      expect(within(card).getByText('$250.00')).toBeTruthy();
      expect(within(card).getByText('Ana Perez')).toBeTruthy();
      expect(within(card).getByText(/Cuenta A/)).toBeTruthy();
      expect(within(card).getByText('PAY-1')).toBeTruthy();
      expect(within(card).getByText(/adminRefunds\.deadline\.overdue/)).toBeTruthy();
      expect(card.querySelector(`time[datetime="${overdue.due_at}"]`)).toBeTruthy();
      expect(within(card).getByText(/adminRefunds\.deadline\.dueBy/)).toBeTruthy();
    });

    it('marks the proof-unverified level and the due-soon state with text, not only color', () => {
      renderInbox();
      const card = cardOf('REM-0311');
      expect(within(card).getByText('adminRefunds.level.proof_unverified')).toBeTruthy();
      expect(within(card).getByText(/adminRefunds\.deadline\.dueSoon/)).toBeTruthy();
    });

    it('on-hold card blocks "mark refunded" visibly, with the reason, and does nothing on click', async () => {
      renderInbox();
      await userEvent.click(screen.getByRole('button', { name: /adminRefunds\.filter\.onHold/ }));
      const card = cardOf('ORD-3000');
      const button = within(card).getByRole('button', { name: /adminRefunds\.actions\.markRefundedAria/ });
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(within(card).getByText(/adminRefunds\.actions\.onHoldBlocked/)).toBeTruthy();
      expect(within(card).getByText(/adminRefunds\.deadline\.onHold/)).toBeTruthy();
      await userEvent.click(button);
      expect(screen.queryByRole('dialog')).toBeNull();
      // "not applicable" stays available during the hold
      expect(within(card).getByRole('button', { name: /adminRefunds\.actions\.notApplicableAria/ })).toBeTruthy();
    });

    it('every action is at least 44 px high and there is no bulk action', () => {
      renderInbox();
      const card = cardOf('ORD-1042');
      within(card).getAllByRole('button').forEach((b) => expect(b.className).toContain('min-h-[44px]'));
      expect(screen.queryByRole('checkbox')).toBeNull();
    });

    it('resolved cards describe the outcome and offer no actions', async () => {
      renderInbox();
      await userEvent.click(screen.getByRole('button', { name: /adminRefunds\.filter\.all/ }));
      const done = cardOf('ORD-4000');
      expect(within(done).getByText(/adminRefunds\.refundedLine/)).toBeTruthy();
      expect(within(done).getByText(/ZELLE-77/)).toBeTruthy();
      // No resolution action on a resolved card (dispute control hidden here: the state is unknown in this suite)
      expect(within(done).queryByRole('button', { name: /adminRefunds\.actions\.(markRefunded|notApplicable)Aria/ })).toBeNull();
      expect(within(done).queryByRole('button')).toBeNull();
      expect(within(cardOf('ORD-5000')).queryByRole('button')).toBeNull();
      expect(within(cardOf('ORD-5000')).getByText('adminRefunds.reopenedLine')).toBeTruthy();
      expect(within(cardOf('REM-9000')).getByText(/adminRefunds\.notApplicableLine/)).toBeTruthy();
    });

    it('opens the proof with the bucket of the operation type', async () => {
      renderInbox();
      await userEvent.click(within(cardOf('ORD-1042')).getByRole('button', { name: /adminRefunds\.actions\.viewProofAria/ }));
      expect(screen.getByTestId('proof-modal').textContent).toBe('order-documents');
      expect(proofModal.mock.calls.at(-1)[0].proofUrl).toBe('payment-proofs/p.jpg');
    });

    it('opens the remittance proof from the remittance-proofs bucket', async () => {
      renderInbox();
      await userEvent.click(within(cardOf('REM-0311')).getByRole('button', { name: /adminRefunds\.actions\.viewProofAria/ }));
      expect(screen.getByTestId('proof-modal').textContent).toBe('remittance-proofs');
    });

    it('copies one block with the data to send the Zelle', async () => {
      renderInbox();
      await userEvent.click(within(cardOf('ORD-1042')).getByRole('button', { name: /adminRefunds\.actions\.copyAria/ }));
      await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
      const written = navigator.clipboard.writeText.mock.calls[0][0];
      expect(written).toContain('250.00 USD');
      expect(written).toContain('ana@example.test');
      expect(written).toContain('ORD-1042');
      await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'adminRefunds.actions.copied' })));
    });

    it('tells the admin when copying is not possible', async () => {
      navigator.clipboard.writeText = vi.fn(async () => {
        throw new Error('denied');
      });
      document.execCommand = vi.fn(() => false);
      renderInbox();
      await userEvent.click(within(cardOf('ORD-1042')).getByRole('button', { name: /adminRefunds\.actions\.copyAria/ }));
      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: 'adminRefunds.actions.copyFailed', variant: 'destructive' }))
      );
    });
  });

  describe('mark refunded', () => {
    const open = async (number = 'ORD-2000') => {
      await userEvent.click(within(cardOf(number)).getByRole('button', { name: /adminRefunds\.actions\.markRefundedAria/ }));
      return screen.getByRole('dialog');
    };

    const PROOF_LABEL = /adminRefunds\.modal\.refunded\.proofLabel/;
    const proof = () => new File(['proof'], 'zelle.png', { type: 'image/png' });
    const attach = (dialog, file = proof()) => {
      fireEvent.change(within(dialog).getByLabelText(PROOF_LABEL), { target: { files: [file] } });
      return file;
    };

    it('requires a reference and a proof, shows amount and customer, and saves with a null date for today', async () => {
      const { onChanged } = renderInbox();
      const dialog = await open();
      expect(within(dialog).getByText(/\$?10\.00|10\.00/)).toBeTruthy();
      expect(within(dialog).getByText(/Ana Perez/)).toBeTruthy();
      const submit = within(dialog).getByRole('button', { name: 'adminRefunds.modal.refunded.submit' });
      await userEvent.click(submit);
      expect(resolveRefund).not.toHaveBeenCalled();
      expect(within(dialog).getByRole('alert').textContent).toContain('adminRefunds.errors.invalidReference');

      await userEvent.type(within(dialog).getByLabelText(/adminRefunds\.modal\.refunded\.referenceLabel/), '  ZELLE-9 ');
      await userEvent.click(submit);
      expect(resolveRefund).not.toHaveBeenCalled();
      expect(within(dialog).getByRole('alert').textContent).toContain('adminRefunds.errors.proofRequired');

      const file = attach(dialog);
      await userEvent.click(submit);
      await waitFor(() => expect(resolveRefund).toHaveBeenCalledTimes(1));
      expect(resolveRefund).toHaveBeenCalledWith({ refundId: 'ontime', action: 'refunded', reference: 'ZELLE-9', refundedAt: null, proofFile: file });
      await waitFor(() => expect(onChanged).toHaveBeenCalled());
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: 'adminRefunds.success.refunded' }));
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('tells the rest of the app (header badge) that refunds changed, and moves the focus to the summary instead of body', async () => {
      const listener = vi.fn();
      window.addEventListener('papuenvios:refunds-changed', listener);
      renderInbox();
      const dialog = await open();
      await userEvent.type(within(dialog).getByLabelText(/adminRefunds\.modal\.refunded\.referenceLabel/), 'ZELLE-9');
      attach(dialog);
      await userEvent.click(within(dialog).getByRole('button', { name: 'adminRefunds.modal.refunded.submit' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(listener).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('refunds-summary')));
      window.removeEventListener('papuenvios:refunds-changed', listener);
    });

    it('a conflict also refreshes the badge and keeps the focus on the summary', async () => {
      resolveRefund.mockRejectedValue(Object.assign(new Error('already_resolved'), { context: { reason: 'already_resolved' } }));
      const listener = vi.fn();
      window.addEventListener('papuenvios:refunds-changed', listener);
      renderInbox();
      const dialog = await open();
      await userEvent.type(within(dialog).getByLabelText(/adminRefunds\.modal\.refunded\.referenceLabel/), 'ZELLE-1');
      attach(dialog);
      await userEvent.click(within(dialog).getByRole('button', { name: 'adminRefunds.modal.refunded.submit' }));
      await waitFor(() => expect(listener).toHaveBeenCalled());
      await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('refunds-summary')));
      window.removeEventListener('papuenvios:refunds-changed', listener);
    });

    it('warns when the chosen day is raised to the moment the refund became available', async () => {
      const pad = (n) => String(n).padStart(2, '0');
      const day = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const localNow = new Date(2026, 9, 30, 10, 0, 0);
      const eligibleDay = new Date(2026, 9, 29, 22, 0, 0);
      const late = mk({ id: 'late', operation_type: 'order', order_id: 'o9', operation_number: 'ORD-9999', eligible_at: eligibleDay.toISOString(), due_at: new Date(2026, 10, 6).toISOString() });
      renderInbox({ refunds: [late], now: localNow });
      await userEvent.click(within(cardOf('ORD-9999')).getByRole('button', { name: /adminRefunds\.actions\.markRefundedAria/ }));
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).queryByText(/adminRefunds\.modal\.refunded\.dateClamped/)).toBeNull();
      fireEvent.change(within(dialog).getByLabelText(/adminRefunds\.modal\.refunded\.dateLabel/), { target: { value: day(eligibleDay) } });
      expect(within(dialog).getByText(/adminRefunds\.modal\.refunded\.dateClamped/)).toBeTruthy();
    });

    it('the unverified-proof level also requires confirming the payment arrived', async () => {
      renderInbox();
      const dialog = await open('REM-0311');
      await userEvent.type(within(dialog).getByLabelText(/adminRefunds\.modal\.refunded\.referenceLabel/), 'ZELLE-10');
      attach(dialog);
      await userEvent.click(within(dialog).getByRole('button', { name: 'adminRefunds.modal.refunded.submit' }));
      expect(resolveRefund).not.toHaveBeenCalled();
      await userEvent.click(within(dialog).getByRole('checkbox', { name: /adminRefunds\.modal\.refunded\.confirmArrived/ }));
      await userEvent.click(within(dialog).getByRole('button', { name: 'adminRefunds.modal.refunded.submit' }));
      await waitFor(() => expect(resolveRefund).toHaveBeenCalled());
    });

    it('refuses a proof of another type or over 5 MB without calling the service', async () => {
      renderInbox();
      const dialog = await open('ORD-2000');
      await userEvent.type(within(dialog).getByLabelText(/adminRefunds\.modal\.refunded\.referenceLabel/), 'ZELLE-1');
      attach(dialog, new File(['x'], 'a.txt', { type: 'text/plain' }));
      await userEvent.click(within(dialog).getByRole('button', { name: 'adminRefunds.modal.refunded.submit' }));
      expect(within(dialog).getByRole('alert').textContent).toContain('adminRefunds.errors.proofInvalid');
      const big = new File(['x'], 'big.png', { type: 'image/png' });
      Object.defineProperty(big, 'size', { value: 6 * 1024 * 1024 });
      attach(dialog, big);
      await userEvent.click(within(dialog).getByRole('button', { name: 'adminRefunds.modal.refunded.submit' }));
      expect(within(dialog).getByRole('alert').textContent).toContain('adminRefunds.errors.proofInvalid');
      expect(resolveRefund).not.toHaveBeenCalled();
    });

    it('"not applicable" asks for no proof', async () => {
      renderInbox();
      await userEvent.click(within(cardOf('ORD-2000')).getByRole('button', { name: /adminRefunds\.actions\.notApplicableAria/ }));
      expect(within(screen.getByRole('dialog')).queryByLabelText(PROOF_LABEL)).toBeNull();
    });

    it('the validated level has no arrival checkbox', async () => {
      renderInbox();
      const dialog = await open('ORD-2000');
      expect(within(dialog).queryByRole('checkbox')).toBeNull();
    });

    it('shows the server refusal inside the dialog and keeps it open (refund_on_hold)', async () => {
      resolveRefund.mockRejectedValue(Object.assign(new Error('refund_on_hold'), { context: { reason: 'refund_on_hold', eligibleAt: iso(1) } }));
      renderInbox();
      const dialog = await open('ORD-2000');
      await userEvent.type(within(dialog).getByLabelText(/adminRefunds\.modal\.refunded\.referenceLabel/), 'ZELLE-1');
      attach(dialog);
      await userEvent.click(within(dialog).getByRole('button', { name: 'adminRefunds.modal.refunded.submit' }));
      await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toContain('adminRefunds.errors.onHold'));
      expect(screen.getByRole('dialog')).toBeTruthy();
    });

    it('a conflict (already resolved elsewhere) closes the dialog, says so and reloads', async () => {
      resolveRefund.mockRejectedValue(Object.assign(new Error('already_resolved'), { context: { reason: 'already_resolved' } }));
      const { onChanged } = renderInbox();
      const dialog = await open('ORD-2000');
      await userEvent.type(within(dialog).getByLabelText(/adminRefunds\.modal\.refunded\.referenceLabel/), 'ZELLE-1');
      attach(dialog);
      await userEvent.click(within(dialog).getByRole('button', { name: 'adminRefunds.modal.refunded.submit' }));
      await waitFor(() => expect(onChanged).toHaveBeenCalled());
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: 'adminRefunds.states.conflict' }));
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('closes with Escape and returns the focus to the button that opened it', async () => {
      renderInbox();
      const opener = within(cardOf('ORD-2000')).getByRole('button', { name: /adminRefunds\.actions\.markRefundedAria/ });
      await userEvent.click(opener);
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(opener);
    });
  });

  describe('not applicable', () => {
    it('requires a reason; presets fill it; saves', async () => {
      const { onChanged } = renderInbox();
      await userEvent.click(within(cardOf('ORD-1042')).getByRole('button', { name: /adminRefunds\.actions\.notApplicableAria/ }));
      const dialog = screen.getByRole('dialog');
      const submit = within(dialog).getByRole('button', { name: 'adminRefunds.modal.notApplicable.submit' });
      await userEvent.click(submit);
      expect(resolveRefund).not.toHaveBeenCalled();
      expect(within(dialog).getByRole('alert').textContent).toContain('adminRefunds.errors.invalidReason');

      await userEvent.click(within(dialog).getByRole('button', { name: 'adminRefunds.modal.notApplicable.presets.neverArrived' }));
      expect(within(dialog).getByLabelText(/adminRefunds\.modal\.notApplicable\.reasonLabel/).value).toBe('adminRefunds.modal.notApplicable.presets.neverArrived');
      await userEvent.click(submit);
      await waitFor(() => expect(resolveRefund).toHaveBeenCalledWith({
        refundId: 'over',
        action: 'not_applicable',
        reason: 'adminRefunds.modal.notApplicable.presets.neverArrived'
      }));
      await waitFor(() => expect(onChanged).toHaveBeenCalled());
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: 'adminRefunds.success.notApplicable' }));
    });

    it('works during the 48 h hold', async () => {
      renderInbox();
      await userEvent.click(screen.getByRole('button', { name: /adminRefunds\.filter\.onHold/ }));
      await userEvent.click(within(cardOf('ORD-3000')).getByRole('button', { name: /adminRefunds\.actions\.notApplicableAria/ }));
      const dialog = screen.getByRole('dialog');
      await userEvent.type(within(dialog).getByLabelText(/adminRefunds\.modal\.notApplicable\.reasonLabel/), 'no money received');
      await userEvent.click(within(dialog).getByRole('button', { name: 'adminRefunds.modal.notApplicable.submit' }));
      await waitFor(() => expect(resolveRefund).toHaveBeenCalledWith({ refundId: 'hold', action: 'not_applicable', reason: 'no money received' }));
    });
  });
  describe('own operation (separation of duties)', () => {
    const own = mk({ id: 'own', operation_type: 'order', order_id: 'o7', operation_number: 'ORD-7000', user_id: 'me', amount: '20.00' });
    const other = mk({ id: 'other', operation_type: 'order', order_id: 'o8', operation_number: 'ORD-8000', user_id: 'someone-else', amount: '30.00' });

    it('labels the admin\'s own operation and blocks both resolutions with the reason', async () => {
      renderInbox({ refunds: [own, other], currentUserId: 'me', isSuperAdmin: false });
      const card = cardOf('ORD-7000');
      expect(within(card).getByText('adminRefunds.ownOperation')).toBeTruthy();
      expect(within(cardOf('ORD-8000')).queryByText('adminRefunds.ownOperation')).toBeNull();
      for (const name of [/adminRefunds\.actions\.markRefundedAria/, /adminRefunds\.actions\.notApplicableAria/]) {
        const button = within(card).getByRole('button', { name });
        expect(button.getAttribute('aria-disabled')).toBe('true');
        await userEvent.click(button);
      }
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(within(card).getByText('adminRefunds.actions.ownBlocked')).toBeTruthy();
    });

    it('another admin resolves it normally', async () => {
      renderInbox({ refunds: [own], currentUserId: 'someone-else', isSuperAdmin: false });
      const button = within(cardOf('ORD-7000')).getByRole('button', { name: /adminRefunds\.actions\.notApplicableAria/ });
      expect(button.getAttribute('aria-disabled')).toBeNull();
      await userEvent.click(button);
      expect(screen.getByRole('dialog')).toBeTruthy();
    });

    it('a super admin can resolve his own only after a reinforced confirmation, which is sent to the service', async () => {
      renderInbox({ refunds: [own], currentUserId: 'me', isSuperAdmin: true });
      await userEvent.click(within(cardOf('ORD-7000')).getByRole('button', { name: /adminRefunds\.actions\.notApplicableAria/ }));
      const dialog = screen.getByRole('dialog');
      await userEvent.type(within(dialog).getByLabelText(/adminRefunds\.modal\.notApplicable\.reasonLabel/), 'duplicate');
      await userEvent.click(within(dialog).getByRole('button', { name: 'adminRefunds.modal.notApplicable.submit' }));
      expect(resolveRefund).not.toHaveBeenCalled();
      expect(within(dialog).getByRole('alert').textContent).toContain('adminRefunds.errors.selfResolveConfirm');
      await userEvent.click(within(dialog).getByRole('checkbox', { name: /adminRefunds\.modal\.selfResolve\.confirm/ }));
      await userEvent.click(within(dialog).getByRole('button', { name: 'adminRefunds.modal.notApplicable.submit' }));
      await waitFor(() => expect(resolveRefund).toHaveBeenCalledWith({ refundId: 'own', action: 'not_applicable', reason: 'duplicate', selfResolveConfirm: true }));
    });

    it('a normal refund never sends the confirmation flag', async () => {
      renderInbox({ refunds: [other], currentUserId: 'me', isSuperAdmin: true });
      await userEvent.click(within(cardOf('ORD-8000')).getByRole('button', { name: /adminRefunds\.actions\.notApplicableAria/ }));
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).queryByRole('checkbox')).toBeNull();
      await userEvent.type(within(dialog).getByLabelText(/adminRefunds\.modal\.notApplicable\.reasonLabel/), 'duplicate');
      await userEvent.click(within(dialog).getByRole('button', { name: 'adminRefunds.modal.notApplicable.submit' }));
      await waitFor(() => expect(resolveRefund).toHaveBeenCalledWith({ refundId: 'other', action: 'not_applicable', reason: 'duplicate' }));
    });

    it('shows the typed refusals inside the dialog', async () => {
      resolveRefund.mockRejectedValue(Object.assign(new Error('x'), { context: { reason: 'self_resolution_not_allowed' } }));
      renderInbox({ refunds: [other], currentUserId: 'nobody', isSuperAdmin: false });
      await userEvent.click(within(cardOf('ORD-8000')).getByRole('button', { name: /adminRefunds\.actions\.notApplicableAria/ }));
      const dialog = screen.getByRole('dialog');
      await userEvent.type(within(dialog).getByLabelText(/adminRefunds\.modal\.notApplicable\.reasonLabel/), 'x');
      await userEvent.click(within(dialog).getByRole('button', { name: 'adminRefunds.modal.notApplicable.submit' }));
      await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toContain('adminRefunds.errors.selfResolution'));
    });
  });
});
