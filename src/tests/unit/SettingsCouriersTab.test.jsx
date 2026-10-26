import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';

const svc = vi.hoisted(() => ({
  listCouriers: vi.fn(), upsertCourier: vi.fn(), listPaymentTypes: vi.fn(), setPaymentType: vi.fn(), deactivatePaymentType: vi.fn(),
  getMarginSettings: vi.fn(), setMarginThresholds: vi.fn(), listZoneOptions: vi.fn(), listRemittanceTypeOptions: vi.fn(),
  listAccruals: vi.fn(), registerPayment: vi.fn(), voidAccrual: vi.fn(), adjustAccrual: vi.fn(), recalculateAccrual: vi.fn(),
  listDeliveriesWithoutAccrual: vi.fn(), backfillMissingAccruals: vi.fn(), getCourierReport: vi.fn()
}));
const auth = vi.hoisted(() => ({ isSuperAdmin: false }));
vi.mock('@/lib/courierService', () => svc);
vi.mock('@/contexts/LanguageContext', () => ({ useLanguage: () => ({ t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key), language: 'es' }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ isAdmin: true, isSuperAdmin: auth.isSuperAdmin }) }));

import SettingsCouriersTab from '@/components/settings/couriers/SettingsCouriersTab';

const COURIERS = [{ id: 'c1', name: 'Ana', phone: null, notes: null, is_active: true }];
const accrual = (over = {}) => ({ id: 'a1111111-aaaa', courier_id: 'c1', source_kind: 'remittance', component: 'delivery', amount_cup: '100', delivered_at: '2026-10-20T12:00:00Z', status: 'calculated', ...over });
const goTab = (name) => fireEvent.click(screen.getByRole('tab', { name }));

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/');
  auth.isSuperAdmin = false;
  svc.listCouriers.mockResolvedValue({ available: true, items: COURIERS });
  svc.listPaymentTypes.mockResolvedValue({ available: true, items: [] });
  svc.getMarginSettings.mockResolvedValue({ available: true, settings: { remittance: { targetPct: null, warningPct: 10, criticalPct: 5 }, order: { targetPct: null, warningPct: null, criticalPct: null } } });
  svc.listZoneOptions.mockResolvedValue([]);
  svc.listRemittanceTypeOptions.mockResolvedValue([]);
  svc.listAccruals.mockImplementation(async ({ status } = {}) => ({ available: true, items: status === 'paid' ? [] : [] }));
  svc.listDeliveriesWithoutAccrual.mockResolvedValue({ available: true, items: [] });
  svc.getCourierReport.mockResolvedValue({ available: true, rows: [] });
});
afterEach(() => vi.useRealTimers());

describe('module not deployed yet (front before migrations)', () => {
  it('shows a calm note: no tabs, no error alert', async () => {
    svc.listCouriers.mockResolvedValue({ available: false, items: [] });
    render(<SettingsCouriersTab />);
    expect(await screen.findByTestId('couriers-unavailable')).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('looks again every 5 minutes and enables itself once the module exists', async () => {
    vi.useFakeTimers();
    svc.listCouriers.mockResolvedValueOnce({ available: false, items: [] });
    render(<SettingsCouriersTab />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByTestId('couriers-unavailable')).toBeTruthy();
    expect(svc.listCouriers).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000); });
    expect(svc.listCouriers).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('tablist')).toBeTruthy();
  });
});

describe('tabs', () => {
  it('exposes the four sub-tabs as an ARIA tablist and switches panels', async () => {
    render(<SettingsCouriersTab />);
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['couriers.tabs.couriers', 'couriers.tabs.types', 'couriers.tabs.payable', 'couriers.tabs.reports']);
    expect(await screen.findByText('couriers.couriers.title')).toBeTruthy();
    goTab('couriers.tabs.reports');
    expect(await screen.findByText('couriers.reports.title')).toBeTruthy();
  });
});

describe('payment type form and simulator', () => {
  const openForm = async () => {
    render(<SettingsCouriersTab />);
    await screen.findByRole('tablist');
    goTab('couriers.tabs.types');
    fireEvent.click(await screen.findByRole('button', { name: 'couriers.types.add' }));
    return screen.findByRole('form', { name: 'couriers.types.formTitle' });
  };

  it('warns that it only applies to new deliveries and that no rule means unknown cost', async () => {
    await openForm();
    expect(screen.getByText('couriers.types.onlyNewDeliveries')).toBeTruthy();
    expect(screen.getByText('couriers.types.noRuleUnknown')).toBeTruthy();
  });

  it('blocks an empty submit with field errors and never calls the RPC', async () => {
    const form = await openForm();
    fireEvent.click(within(form).getByRole('button', { name: 'couriers.common.save' }));
    expect((await screen.findAllByText('couriers.validation.required')).length).toBeGreaterThan(0);
    expect(svc.setPaymentType).not.toHaveBeenCalled();
  });

  it('only offers the base selector for methods that use one', async () => {
    const form = await openForm();
    expect(within(form).queryByLabelText('couriers.types.base')).toBeNull();
    fireEvent.change(within(form).getByLabelText('couriers.types.method'), { target: { value: 'percent_of_base' } });
    expect(within(form).getByLabelText('couriers.types.base')).toBeTruthy();
  });

  it('saves a valid rule through the RPC with the typed values (nothing hardcoded)', async () => {
    svc.setPaymentType.mockResolvedValue('id');
    const form = await openForm();
    fireEvent.change(within(form).getByLabelText('couriers.types.code'), { target: { value: 'my-rule' } });
    fireEvent.change(within(form).getByLabelText('couriers.types.name'), { target: { value: 'My rule' } });
    fireEvent.change(within(form).getByLabelText('couriers.types.fixedCup'), { target: { value: '321' } });
    fireEvent.click(within(form).getByRole('button', { name: 'couriers.common.save' }));
    await waitFor(() => expect(svc.setPaymentType).toHaveBeenCalled());
    expect(svc.setPaymentType.mock.calls[0][0]).toMatchObject({ p_code: 'my-rule', p_method: 'fixed_cup', p_fixed_cup: 321, p_percent: null });
  });

  it('shows a typed error for an overlapping rule', async () => {
    svc.setPaymentType.mockRejectedValue(Object.assign(new Error('x'), { i18nKey: 'couriers.errors.overlap' }));
    const form = await openForm();
    fireEvent.change(within(form).getByLabelText('couriers.types.code'), { target: { value: 'r' } });
    fireEvent.change(within(form).getByLabelText('couriers.types.name'), { target: { value: 'R' } });
    fireEvent.change(within(form).getByLabelText('couriers.types.fixedCup'), { target: { value: '1' } });
    fireEvent.click(within(form).getByRole('button', { name: 'couriers.common.save' }));
    expect(await screen.findByText('couriers.errors.overlap')).toBeTruthy();
  });

  it('simulates cost and margin and flags a result below the owner threshold (text, not only colour)', async () => {
    const form = await openForm();
    fireEvent.change(within(form).getByLabelText('couriers.types.code'), { target: { value: 'r' } });
    fireEvent.change(within(form).getByLabelText('couriers.types.name'), { target: { value: 'R' } });
    fireEvent.change(within(form).getByLabelText('couriers.types.fixedCup'), { target: { value: '120' } });
    await waitFor(() => expect(svc.getMarginSettings).toHaveBeenCalled());
    fireEvent.change(within(form).getByLabelText('couriers.simulator.sent'), { target: { value: '100' } });
    fireEvent.change(within(form).getByLabelText('couriers.simulator.commission'), { target: { value: '4' } });
    fireEvent.change(within(form).getByLabelText('couriers.simulator.rate'), { target: { value: '120' } });
    // cost = 120 CUP = 1 USD; income 4 USD on a 100 base = 3% margin; thresholds 10 / 5 => critical
    const status = await within(form).findByTestId('simulator-status');
    expect(status.textContent).toContain('couriers.margin.critical');
    expect(status.textContent).toContain('couriers.simulator.belowCritical');
  });
});

describe('payable tab', () => {
  const openPayable = async () => {
    render(<SettingsCouriersTab />);
    await screen.findByRole('tablist');
    goTab('couriers.tabs.payable');
  };

  it('marks the selected accruals as paid with method, reference and date', async () => {
    svc.listAccruals.mockImplementation(async ({ status }) => ({ available: true, items: status === 'paid' ? [] : [accrual(), accrual({ id: 'b2222222-bbbb', amount_cup: '50' })] }));
    svc.registerPayment.mockResolvedValue('pay');
    await openPayable();
    const group = await screen.findByTestId('payable-group');
    const boxes = within(group).getAllByRole('checkbox');
    expect(within(group).getByRole('button', { name: 'couriers.payable.markPaid' }).disabled).toBe(true);
    fireEvent.click(boxes[0]);
    fireEvent.click(within(group).getByRole('button', { name: 'couriers.payable.markPaid' }));
    const form = await screen.findByRole('form', { name: 'couriers.payable.markPaid' });
    fireEvent.change(within(form).getByLabelText('couriers.payable.method'), { target: { value: 'cash' } });
    fireEvent.change(within(form).getByLabelText('couriers.payable.reference'), { target: { value: 'REF-1' } });
    fireEvent.click(within(form).getByRole('button', { name: 'couriers.payable.confirmPay' }));
    await waitFor(() => expect(svc.registerPayment).toHaveBeenCalled());
    expect(svc.registerPayment.mock.calls[0][0]).toMatchObject({ courierId: 'c1', accrualIds: ['a1111111-aaaa'], method: 'cash', reference: 'REF-1' });
    expect(svc.registerPayment.mock.calls[0][0].paidAt).toMatch(/T/);
  });

  it('keeps unknown-amount accruals out of the payable list and offers a recalculation', async () => {
    svc.listAccruals.mockImplementation(async ({ status }) => ({ available: true, items: status === 'paid' ? [] : [accrual({ amount_cup: null })] }));
    svc.recalculateAccrual.mockResolvedValue(undefined);
    await openPayable();
    const unknown = await screen.findByTestId('payable-unknown');
    expect(within(screen.getByTestId('payable-group')).queryAllByRole('checkbox')).toHaveLength(0);
    fireEvent.click(within(unknown).getByRole('button', { name: /couriers\.payable\.recalculate/ }));
    await waitFor(() => expect(svc.recalculateAccrual).toHaveBeenCalledWith('a1111111-aaaa'));
  });

  it('disables void/adjust on paid items for an admin and explains why; enables them for a super admin', async () => {
    svc.listAccruals.mockImplementation(async ({ status }) => ({ available: true, items: status === 'paid' ? [accrual({ status: 'paid' })] : [] }));
    await openPayable();
    const voidBtn = await screen.findByRole('button', { name: /couriers\.payable\.void/ });
    expect(voidBtn.disabled).toBe(true);
    expect(voidBtn.title).toBe('couriers.payable.superAdminOnlyReason');
    expect(screen.getAllByText('couriers.payable.superAdminOnlyReason').length).toBeGreaterThan(0);
  });

  it('enables void on paid items for a super admin', async () => {
    auth.isSuperAdmin = true;
    svc.listAccruals.mockImplementation(async ({ status }) => ({ available: true, items: status === 'paid' ? [accrual({ status: 'paid' })] : [] }));
    await openPayable();
    expect((await screen.findByRole('button', { name: /couriers\.payable\.void/ })).disabled).toBe(false);
  });

  it('lets an admin review the gaps but disables the backfill with a visible reason (super_admin only)', async () => {
    svc.listDeliveriesWithoutAccrual.mockResolvedValue({ available: true, items: [{ id: 1 }] });
    await openPayable();
    fireEvent.change(await screen.findByLabelText('couriers.payable.gapsFrom'), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'couriers.payable.gapsReview' }));
    const btn = await screen.findByRole('button', { name: 'couriers.payable.backfill' });
    expect(btn.disabled).toBe(true);
    expect(within(screen.getByTestId('gaps-result')).getByText('couriers.payable.backfillSuperOnly')).toBeTruthy();
  });

  it('requires an explicit confirmation, showing the count and the "now" warning, before a backfill', async () => {
    auth.isSuperAdmin = true;
    svc.listDeliveriesWithoutAccrual.mockResolvedValue({ available: true, items: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    svc.backfillMissingAccruals.mockResolvedValue(3);
    await openPayable();
    fireEvent.change(await screen.findByLabelText('couriers.payable.gapsFrom'), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'couriers.payable.gapsReview' }));
    fireEvent.click(await screen.findByRole('button', { name: 'couriers.payable.backfill' }));
    expect(svc.backfillMissingAccruals).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('"count":3');
    expect(dialog.textContent).toContain('couriers.payable.recalcWarning');
    fireEvent.click(within(dialog).getByRole('button', { name: 'couriers.payable.backfillYes' }));
    await waitFor(() => expect(svc.backfillMissingAccruals).toHaveBeenCalledTimes(1));
  });
});

describe('reports tab', () => {
  it('runs the report and shows unknown counts apart; exports a CSV', async () => {
    svc.getCourierReport.mockResolvedValue({ available: true, rows: [{ courier_id: 'c1', courier_name: 'Ana', remittance_deliveries: 2, order_deliveries: 1, accrued_cup: '300', paid_cup: '100', pending_cup: '200', unknown_amount_count: 1 }] });
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    render(<SettingsCouriersTab />);
    await screen.findByRole('tablist');
    goTab('couriers.tabs.reports');
    fireEvent.click(await screen.findByRole('button', { name: 'couriers.reports.run' }));
    const row = await screen.findByTestId('report-row');
    expect(row.textContent).toContain('Ana');
    expect(row.textContent).toContain('couriers.reports.cols.unknown_amount_count');
    fireEvent.click(screen.getByRole('button', { name: 'couriers.reports.exportCsv' }));
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled(); // deferred, so the download is not cancelled
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:x'), { timeout: 3000 });
  });
});
