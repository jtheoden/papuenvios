/**
 * Optional "who delivered" selector inside the shared delivery dialog.
 * The front ships before the migrations: with the module missing the selector must not render at all.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const svc = vi.hoisted(() => ({ listDeliveryCouriers: vi.fn(), assignDeliveryCourier: vi.fn() }));
vi.mock('@/lib/courierService', () => svc);

import DeliveryProofModal from '@/components/admin/modals/DeliveryProofModal';

const t = (key) => key;
const submit = () => screen.getByRole('button', { name: 'adminOrders.deliveryModal.submit' });
const setup = (props = {}) => {
  const calls = [];
  const onConfirm = vi.fn(async () => { calls.push('confirm'); });
  svc.assignDeliveryCourier.mockImplementation(async () => { calls.push('assign'); });
  render(<DeliveryProofModal onClose={() => {}} onConfirm={onConfirm} t={t} courierKind="remittance" courierOperationId="rem-1" {...props} />);
  return { calls, onConfirm };
};

beforeEach(() => {
  vi.clearAllMocks();
  svc.listDeliveryCouriers.mockResolvedValue([{ id: 'c1', name: 'Ana' }, { id: 'c2', name: 'Luis' }]);
});

describe('DeliveryCourierSelect in the delivery dialog', () => {
  it('renders nothing when the module is unavailable (no active couriers)', async () => {
    svc.listDeliveryCouriers.mockResolvedValue([]);
    setup();
    await waitFor(() => expect(svc.listDeliveryCouriers).toHaveBeenCalled());
    expect(screen.queryByLabelText('couriers.delivery.label')).toBeNull();
  });

  it('is not rendered at all without the courier props (other callers unchanged)', () => {
    setup({ courierKind: undefined, courierOperationId: undefined });
    expect(svc.listDeliveryCouriers).not.toHaveBeenCalled();
  });

  it('offers an optional list of active couriers', async () => {
    setup();
    const select = await screen.findByLabelText('couriers.delivery.label');
    expect(select.value).toBe('');
    expect(screen.getByRole('option', { name: 'Ana' })).toBeTruthy();
  });

  it('assigns the courier BEFORE the delivery transition', async () => {
    const { calls, onConfirm } = setup();
    fireEvent.change(await screen.findByLabelText('couriers.delivery.label'), { target: { value: 'c2' } });
    fireEvent.click(submit());
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    expect(svc.assignDeliveryCourier).toHaveBeenCalledWith('remittance', 'rem-1', 'c2');
    expect(calls).toEqual(['assign', 'confirm']);
  });

  it('skips the assignment when nobody is chosen', async () => {
    const { onConfirm } = setup();
    await screen.findByLabelText('couriers.delivery.label');
    fireEvent.click(submit());
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    expect(svc.assignDeliveryCourier).not.toHaveBeenCalled();
  });

  it('does not deliver when the assignment fails, and shows the typed error', async () => {
    const { onConfirm } = setup();
    svc.assignDeliveryCourier.mockRejectedValue(Object.assign(new Error('x'), { i18nKey: 'couriers.errors.alreadyDelivered' }));
    fireEvent.change(await screen.findByLabelText('couriers.delivery.label'), { target: { value: 'c1' } });
    fireEvent.click(submit());
    expect(await screen.findByText('couriers.errors.alreadyDelivered')).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('warns when "none" is chosen after a courier was already assigned by a failed attempt (the assignment is kept)', async () => {
    const { onConfirm } = setup();
    onConfirm.mockRejectedValueOnce(new Error('transition failed'));
    const select = await screen.findByLabelText('couriers.delivery.label');
    fireEvent.change(select, { target: { value: 'c1' } });
    fireEvent.click(submit());
    await waitFor(() => expect(svc.assignDeliveryCourier).toHaveBeenCalledTimes(1));
    await screen.findByRole('alert');
    expect(screen.queryByText('couriers.delivery.clearedWarning')).toBeNull();
    fireEvent.change(select, { target: { value: '' } });
    expect(await screen.findByText('couriers.delivery.clearedWarning')).toBeTruthy();
  });
});
