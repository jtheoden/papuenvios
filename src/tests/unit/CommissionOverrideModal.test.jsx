import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const toast = vi.fn();
const setRemittanceCommission = vi.fn();
const getOpenProposals = vi.fn();

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key, params) => (params ? `${key}|${Object.values(params).join('|')}` : key),
    language: 'es',
  }),
}));
vi.mock('@/components/ui/use-toast', () => ({ toast: (...args) => toast(...args) }));
vi.mock('@/lib/commissionProposalService', () => ({ getOpenProposals: (...a) => getOpenProposals(...a) }));
vi.mock('@/lib/remittanceService', () => ({
  setRemittanceCommission: (...args) => setRemittanceCommission(...args),
}));

import CommissionOverrideModal from '@/components/admin/CommissionOverrideModal';

const KEY = 'remittances.admin.commissionOverride';
const REASON = 'Cliente frecuente, acuerdo comercial';

const remittance = (over = {}) => ({
  id: 'rem-1',
  remittance_number: 'REM-1',
  status: 'payment_pending',
  amount_sent: 100,
  currency_sent: 'USD',
  currency_delivered: 'CUP',
  exchange_rate: 800,
  commission_total: 2.5,
  amount_to_deliver: 78000,
  ...over,
});

const setup = (rem = remittance(), override = null) => {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(<CommissionOverrideModal remittance={rem} override={override} onClose={onClose} onSaved={onSaved} />);
  return { onClose, onSaved };
};

const typeCommission = (value) =>
  fireEvent.change(screen.getByLabelText(`${KEY}.newCommission`), { target: { value } });
const typeReason = (value) => fireEvent.change(screen.getByLabelText(`${KEY}.reason`), { target: { value } });
const confirmButton = () => screen.getByRole('button', { name: `${KEY}.confirm` });

describe('CommissionOverrideModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setRemittance();
    getOpenProposals.mockResolvedValue([{ id: 'p1', remittance_id: 'rem-1', status: 'pending', new_commission: '5.00' }]);
  });
  function setRemittance() {
    setRemittanceCommission.mockResolvedValue({ id: 'rem-1', commission_total: 5, amount_to_deliver: 76000 });
  }

  it('is an accessible modal dialog that shows the standard and current commission and the current delivery amount', () => {
    setup();
    const dialog = screen.getByRole('dialog', { name: `${KEY}.modalTitle` });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveTextContent('2.50 USD');
    expect(dialog).toHaveTextContent('78000.00 CUP');
  });

  it('focuses the commission field on open', () => {
    setup();
    expect(screen.getByLabelText(`${KEY}.newCommission`)).toHaveFocus();
  });

  it('previews the delivery amount and the difference against the standard commission before confirming', () => {
    setup();
    typeCommission('5');
    const preview = screen.getByTestId('commission-override-preview');
    expect(preview).toHaveTextContent('76000.00 CUP');
    expect(preview).toHaveTextContent(`${KEY}.differenceHigher|2.50|USD`);
    expect(screen.getByText(`${KEY}.higherWarning`)).toBeInTheDocument();
  });

  it('a lower commission shows the difference below the standard and no warning', () => {
    setup();
    typeCommission('1');
    expect(screen.getByTestId('commission-override-preview')).toHaveTextContent(`${KEY}.differenceLower|1.50|USD`);
    expect(screen.getByTestId('commission-override-preview')).toHaveTextContent('79200.00 CUP');
    expect(screen.queryByText(`${KEY}.higherWarning`)).not.toBeInTheDocument();
  });

  it('has no lower-only mode any more: neither hint nor extra error, whatever the status', () => {
    setup(remittance({ status: 'payment_pending' }));
    expect(screen.queryByText(`${KEY}.lowerOnlyHint`)).not.toBeInTheDocument();
    typeReason(REASON);
    typeCommission('3');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(confirmButton()).not.toBeDisabled();
  });

  it('when an override already exists the standard is its standard_commission, not the current commission', () => {
    setup(remittance({ commission_total: 5 }), { commission: 5, standard_commission: 2.5, reason: REASON });
    typeCommission('2.5');
    expect(screen.getByTestId('commission-override-preview')).toHaveTextContent(`${KEY}.differenceNone`);
  });

  it('requires a valid commission and a reason of at least 10 characters before it can be confirmed', () => {
    setup();
    expect(confirmButton()).toBeDisabled();
    typeCommission('5');
    expect(confirmButton()).toBeDisabled();
    typeReason('too short');
    expect(confirmButton()).toBeDisabled();
    typeReason(REASON);
    expect(confirmButton()).toBeEnabled();
    typeCommission('100'); // equal to the amount sent
    expect(confirmButton()).toBeDisabled();
    expect(screen.getByText(`${KEY}.errorCommissionRange`)).toBeInTheDocument();
    typeCommission('1.005');
    expect(confirmButton()).toBeDisabled();
  });

  it('submits through the service with the typed values and hands the updated remittance back', async () => {
    const { onSaved } = setup();
    typeCommission('5');
    typeReason(REASON);
    fireEvent.click(confirmButton());
    await waitFor(() => expect(setRemittanceCommission).toHaveBeenCalledWith('rem-1', 5, REASON));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ id: 'rem-1', commission_total: 5, amount_to_deliver: 76000 }));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: `${KEY}.savedAwaitingCustomer` }));
  });

  it('a decrease: the backend created an informed proposal -> "customer informed" message', async () => {
    getOpenProposals.mockResolvedValue([{ id: 'p2', remittance_id: 'rem-1', status: 'informed', new_commission: '1.00' }]);
    setRemittanceCommission.mockResolvedValue({ id: 'rem-1', commission_total: 1 });
    setup();
    typeCommission('1');
    typeReason(REASON);
    fireEvent.click(confirmButton());
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: `${KEY}.savedCustomerInformed` })));
    expect(getOpenProposals).toHaveBeenCalledWith(['rem-1']);
  });

  it('an old backend that created no proposal gets the neutral message, never a claim that the customer was notified', async () => {
    getOpenProposals.mockResolvedValue([]);
    setup();
    typeCommission('5');
    typeReason(REASON);
    fireEvent.click(confirmButton());
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: `${KEY}.saved` })));
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ description: `${KEY}.savedAwaitingCustomer` }));
  });

  it('a failing proposals read falls back to the neutral message and still saves', async () => {
    getOpenProposals.mockRejectedValue(new Error('x'));
    const { onSaved } = setup();
    typeCommission('5');
    typeReason(REASON);
    fireEvent.click(confirmButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: `${KEY}.saved` }));
  });

  it('shows the server error in a toast and stays open', async () => {
    setRemittanceCommission.mockRejectedValue(new Error('invalid_status: the commission can only be adjusted'));
    const { onSaved, onClose } = setup();
    typeCommission('5');
    typeReason(REASON);
    fireEvent.click(confirmButton());
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' })));
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(confirmButton()).toBeEnabled());
  });

  it('maps the server invalid_status error (22023) to a translated message instead of the raw text', async () => {
    setRemittanceCommission.mockRejectedValue(new Error('invalid_status: the commission can only be adjusted while the payment is pending or rejected'));
    setup();
    typeCommission('5');
    typeReason(REASON);
    fireEvent.click(confirmButton());
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: `${KEY}.errorInvalidStatus`, variant: 'destructive' }))
    );
  });

  it('maps commission_self_adjust_not_allowed (42501) to the translated own-operation message', async () => {
    setRemittanceCommission.mockRejectedValue(new Error('commission_self_adjust_not_allowed'));
    setup();
    typeCommission('5');
    typeReason(REASON);
    fireEvent.click(confirmButton());
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: 'common.statusSelfDealing', variant: 'destructive' }))
    );
  });

  it('closes with Escape and with Cancel', () => {
    const { onClose } = setup();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: `${KEY}.cancel` }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
