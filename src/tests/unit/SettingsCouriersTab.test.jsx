import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';

const svc = vi.hoisted(() => ({
  listCouriers: vi.fn(), upsertCourier: vi.fn(), listPaymentTypes: vi.fn(), setPaymentType: vi.fn(), deactivatePaymentType: vi.fn(),
  getMarginSettings: vi.fn(), setMarginThresholds: vi.fn(), listZoneOptions: vi.fn(), listRemittanceTypeOptions: vi.fn(),
  listAccruals: vi.fn(), registerPayment: vi.fn(), voidAccrual: vi.fn(), adjustAccrual: vi.fn(), recalculateAccrual: vi.fn(),
  listDeliveriesWithoutAccrual: vi.fn(), backfillMissingAccruals: vi.fn(), getCourierReport: vi.fn(),
  listSubscriptions: vi.fn(), subscribeCourier: vi.fn(), unsubscribeCourier: vi.fn()
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
  svc.listSubscriptions.mockResolvedValue({ available: true, items: [] });
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
    await act(async () => { await vi.advanceTimersByTimeAsync(5.5 * 60 * 1000); }); // 5 min ± 10 % jitter
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
    fireEvent.change(within(form).getByLabelText('couriers.types.fixedAmount'), { target: { value: '321' } });
    fireEvent.click(within(form).getByRole('button', { name: 'couriers.common.save' }));
    await waitFor(() => expect(svc.setPaymentType).toHaveBeenCalled());
    expect(svc.setPaymentType.mock.calls[0][0]).toMatchObject({
      p_code: 'my-rule', p_method: 'fixed_amount', p_fixed_amount: 321, p_currency: 'USD', p_fixed_cup: null, p_percent: null, p_accept_gaps: false
    });
  });

  it('shows a typed error for an overlapping rule', async () => {
    svc.setPaymentType.mockRejectedValue(Object.assign(new Error('x'), { i18nKey: 'couriers.errors.overlap' }));
    const form = await openForm();
    fireEvent.change(within(form).getByLabelText('couriers.types.code'), { target: { value: 'r' } });
    fireEvent.change(within(form).getByLabelText('couriers.types.name'), { target: { value: 'R' } });
    fireEvent.change(within(form).getByLabelText('couriers.types.fixedAmount'), { target: { value: '1' } });
    fireEvent.click(within(form).getByRole('button', { name: 'couriers.common.save' }));
    expect(await screen.findByText('couriers.errors.overlap')).toBeTruthy();
  });

  it('simulates cost and margin and flags a result below the owner threshold (text, not only colour)', async () => {
    const form = await openForm();
    fireEvent.change(within(form).getByLabelText('couriers.types.code'), { target: { value: 'r' } });
    fireEvent.change(within(form).getByLabelText('couriers.types.name'), { target: { value: 'R' } });
    fireEvent.change(within(form).getByLabelText('couriers.types.currency'), { target: { value: 'CUP' } });
    fireEvent.change(within(form).getByLabelText('couriers.types.fixedAmount'), { target: { value: '120' } });
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

describe('payment type form: currency, range operators, overlaps and gaps (phase A)', () => {
  const row = (o) => ({ id: o.code, version: 1, name: o.code, is_active: true, valid_from: '2026-10-01T00:00:00Z', valid_to: null,
    applies_to: 'remittance', method: 'fixed_amount', fixed_amount: '5.00', fixed_cup: null, cup_per_usd: null, percent: null, base: null,
    currency: 'USD', courier_id: null, shipping_zone_id: null, remittance_type_id: null, amount_from: null, amount_to: null, ...o });
  const LADDER = [row({ code: 'R1', amount_to: '100.00' }), row({ code: 'R3', amount_from: '200.00' })];
  const openForm = async (items = []) => {
    svc.listPaymentTypes.mockResolvedValue({ available: true, items });
    render(<SettingsCouriersTab />);
    await screen.findByRole('tablist');
    goTab('couriers.tabs.types');
    fireEvent.click(await screen.findByRole('button', { name: 'couriers.types.add' }));
    const form = await screen.findByRole('form', { name: 'couriers.types.formTitle' });
    const set = (label, value) => fireEvent.change(within(form).getByLabelText(label), { target: { value } });
    set('couriers.types.code', 'R2');
    set('couriers.types.name', 'R2');
    set('couriers.types.fixedAmount', '5');
    return { form, set, save: () => fireEvent.click(within(form).getByRole('button', { name: 'couriers.common.save' })) };
  };

  it('saves a fixed amount in CUP; the help text names the comparison currency', async () => {
    svc.setPaymentType.mockResolvedValue('id');
    const { form, set, save } = await openForm();
    set('couriers.types.currency', 'CUP');
    expect(within(form).getByText('couriers.types.rangeHelp:{"currency":"CUP"}')).toBeTruthy();
    save();
    await waitFor(() => expect(svc.setPaymentType).toHaveBeenCalled());
    expect(svc.setPaymentType.mock.calls[0][0]).toMatchObject({ p_method: 'fixed_amount', p_fixed_amount: 5, p_currency: 'CUP', p_amount_from: null, p_amount_to: null });
  });

  it('an operator replaces from/to: "more than X and up to Y" needs X < Y and maps to (X, Y]', async () => {
    svc.setPaymentType.mockResolvedValue('id');
    const { form, set, save } = await openForm();
    expect(within(form).queryByLabelText('couriers.types.rangeX')).toBeNull();
    set('couriers.types.rangeOp', 'between');
    set('couriers.types.rangeX', '200');
    set('couriers.types.rangeY', '100');
    save();
    expect(await within(form).findByText('couriers.validation.tierOrder')).toBeTruthy();
    set('couriers.types.rangeY', '100.005');
    save();
    expect(await within(form).findByText('couriers.validation.money')).toBeTruthy();
    expect(svc.setPaymentType).not.toHaveBeenCalled();
    set('couriers.types.rangeX', '100');
    set('couriers.types.rangeY', '200');
    // alone in its scope, (100, 200] leaves [0, 100] and (200, inf) open: confirmed explicitly
    fireEvent.click(within(form).getByRole('checkbox', { name: 'couriers.types.acceptGaps' }));
    save();
    await waitFor(() => expect(svc.setPaymentType).toHaveBeenCalled());
    expect(svc.setPaymentType.mock.calls[0][0]).toMatchObject({ p_amount_from: 100, p_amount_to: 200, p_accept_gaps: true });
  });

  it('a gap needs an explicit confirmation (announced in a live region) before saving with p_accept_gaps', async () => {
    svc.setPaymentType.mockResolvedValue('id');
    const { form, set, save } = await openForm(LADDER);
    set('couriers.types.rangeOp', 'between');
    set('couriers.types.rangeX', '100.01');
    set('couriers.types.rangeY', '200');
    const warning = await within(form).findByTestId('range-gap-warning');
    expect(warning.closest('[aria-live]')).toBeTruthy();
    expect(warning.textContent).toContain('couriers.types.range.between:{"x":"100.00","y":"100.01","currency":"USD"}');
    save();
    expect(await within(form).findByText('couriers.types.acceptGapsRequired')).toBeTruthy();
    expect(svc.setPaymentType).not.toHaveBeenCalled();
    fireEvent.click(within(form).getByRole('checkbox', { name: 'couriers.types.acceptGaps' }));
    save();
    await waitFor(() => expect(svc.setPaymentType).toHaveBeenCalled());
    expect(svc.setPaymentType.mock.calls[0][0]).toMatchObject({ p_amount_from: 100.01, p_amount_to: 200, p_accept_gaps: true });
  });

  it('one live region per message: notices inside an aria-live container carry no role of their own (no double announcement)', async () => {
    const { form, set, save } = await openForm(LADDER);
    set('couriers.types.rangeOp', 'between');
    set('couriers.types.rangeX', '100.01');
    set('couriers.types.rangeY', '200');
    save();
    expect(await within(form).findByText('couriers.types.acceptGapsRequired')).toBeTruthy();
    expect(within(form).getByTestId('range-gap-warning')).toBeTruthy();
    const nested = form.querySelectorAll('[aria-live] [role="status"], [aria-live] [role="alert"], [aria-live] [aria-live]');
    expect(nested).toHaveLength(0);
  });

  it('the reference ladder closes every gap: no warning, saved without confirmation', async () => {
    svc.setPaymentType.mockResolvedValue('id');
    const { form, set, save } = await openForm(LADDER);
    set('couriers.types.rangeOp', 'between');
    set('couriers.types.rangeX', '100');
    set('couriers.types.rangeY', '200');
    expect(within(form).queryByTestId('range-gap-warning')).toBeNull();
    save();
    await waitFor(() => expect(svc.setPaymentType).toHaveBeenCalled());
  });

  it('an overlap or another currency in the ladder is blocked in the form (the RPC is never called)', async () => {
    const { form, set, save } = await openForm(LADDER);
    set('couriers.types.rangeOp', 'between');
    set('couriers.types.rangeX', '99.99');
    set('couriers.types.rangeY', '200');
    save();
    expect(await within(form).findByText('couriers.errors.overlap')).toBeTruthy();
    set('couriers.types.rangeX', '100');
    set('couriers.types.currency', 'CUP');
    save();
    expect(await within(form).findByText('couriers.errors.mixedCurrency')).toBeTruthy();
    expect(svc.setPaymentType).not.toHaveBeenCalled();
  });

  it('a coverage_gap refusal of the server shows its gaps and the confirmation; confirming resends with p_accept_gaps', async () => {
    // the form sees a closed ladder, the server (validity windows) still finds a gap
    const details = '{"currency":"USD","gaps":[{"kind":"remittance","from":200,"to":null}]}';
    svc.setPaymentType.mockRejectedValueOnce(Object.assign(new Error('coverage_gap: x'), { i18nKey: 'couriers.errors.coverageGap', details }))
      .mockResolvedValueOnce('id');
    const { form, set, save } = await openForm(LADDER);
    set('couriers.types.rangeOp', 'between');
    set('couriers.types.rangeX', '100');
    set('couriers.types.rangeY', '200');
    save();
    const warning = await within(form).findByTestId('range-gap-warning');
    expect(warning.textContent).toContain('couriers.types.range.gt:{"x":"200.00","currency":"USD"}');
    expect(within(form).getByText('couriers.errors.coverageGap')).toBeTruthy();
    fireEvent.click(within(form).getByRole('checkbox', { name: 'couriers.types.acceptGaps' }));
    save();
    await waitFor(() => expect(svc.setPaymentType).toHaveBeenCalledTimes(2));
    expect(svc.setPaymentType.mock.calls[0][0].p_accept_gaps).toBe(false);
    expect(svc.setPaymentType.mock.calls[1][0].p_accept_gaps).toBe(true);
  });

  it('a stale_subscribers refusal names the count and needs the explicit confirmation; confirming resends with p_accept_gaps', async () => {
    const details = '{"code":"R2","couriers":["c1","c2"]}';
    svc.setPaymentType.mockRejectedValueOnce(Object.assign(new Error('stale_subscribers: x'), { i18nKey: 'couriers.errors.staleSubscribers', details }))
      .mockResolvedValueOnce('id');
    const { form, save } = await openForm();
    save();
    const warning = await within(form).findByTestId('stale-subscribers-warning');
    expect(warning.closest('[aria-live]')).toBeTruthy();
    expect(warning.textContent).toContain('couriers.types.staleSubscribers:{"count":2}');
    save();
    expect(await within(form).findByText('couriers.types.acceptGapsRequired')).toBeTruthy();
    expect(svc.setPaymentType).toHaveBeenCalledTimes(1);
    fireEvent.click(within(form).getByRole('checkbox', { name: 'couriers.types.acceptGaps' }));
    save();
    await waitFor(() => expect(svc.setPaymentType).toHaveBeenCalledTimes(2));
    expect(svc.setPaymentType.mock.calls[1][0].p_accept_gaps).toBe(true);
  });

  it('percent of the nominal USD is offered for orders (base = order subtotal)', async () => {
    svc.setPaymentType.mockResolvedValue('id');
    const { set, save } = await openForm();
    set('couriers.types.appliesTo', 'order');
    set('couriers.types.method', 'percent_of_base');
    set('couriers.types.percent', '2');
    set('couriers.types.base', 'nominal_usd');
    save();
    await waitFor(() => expect(svc.setPaymentType).toHaveBeenCalled());
    expect(svc.setPaymentType.mock.calls[0][0]).toMatchObject({ p_applies_to: 'order', p_method: 'percent_of_base', p_base: 'nominal_usd', p_percent: 2 });
  });
});

describe('subscribed payment types per courier (phase B)', () => {
  const type = (o) => ({ id: `${o.code}-1`, version: 1, name: o.code.toUpperCase(), is_active: true, valid_from: '2026-10-01T00:00:00Z', valid_to: null,
    applies_to: 'remittance', method: 'fixed_amount', fixed_amount: '5.00', currency: 'USD', courier_id: null, amount_from: null, amount_to: null, ...o });
  const TYPES = [type({ code: 'g' }), type({ code: 'mine', courier_id: 'c1' }), type({ code: 'theirs', courier_id: 'c2' }),
    type({ code: 'old', is_active: false }), type({ code: 'low', amount_to: '100.00' })];
  const open = async ({ subs = [], types = TYPES } = {}) => {
    svc.listPaymentTypes.mockResolvedValue({ available: true, items: types });
    svc.listSubscriptions.mockResolvedValue({ available: true, items: subs });
    render(<SettingsCouriersTab />);
    return screen.findByRole('region', { name: 'couriers.subscriptions.title Ana' });
  };

  it('offers only the current GENERAL types (never its own nor another courier\'s) and subscribes to the chosen one', async () => {
    svc.subscribeCourier.mockResolvedValue('s1');
    const section = await open();
    expect(within(section).getByText('couriers.subscriptions.empty')).toBeTruthy();
    const select = within(section).getByLabelText('couriers.subscriptions.type');
    const codes = [...select.querySelectorAll('option')].map((o) => o.value).filter(Boolean);
    expect(codes).toEqual(['g', 'low']);
    fireEvent.change(select, { target: { value: 'g' } });
    fireEvent.click(within(section).getByRole('button', { name: 'couriers.subscriptions.add' }));
    await waitFor(() => expect(svc.subscribeCourier).toHaveBeenCalledWith('c1', 'g', { acceptGaps: false }));
    expect(await within(section).findByText('couriers.subscriptions.added')).toBeTruthy();
    expect(svc.listSubscriptions).toHaveBeenCalledTimes(2); // reloaded after the change
    await waitFor(() => expect(svc.listPaymentTypes).toHaveBeenCalledTimes(2)); // and the types too
  });

  it('lists the active subscriptions (not offered again) and removes one', async () => {
    svc.unsubscribeCourier.mockResolvedValue(1);
    const section = await open({ subs: [{ id: 's1', courier_id: 'c1', payment_type_code: 'g' }, { id: 's2', courier_id: 'c9', payment_type_code: 'low' }] });
    const items = within(section).getAllByTestId('subscription-row');
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain('G');
    expect(items[0].textContent).toContain('g');
    const codes = [...within(section).getByLabelText('couriers.subscriptions.type').querySelectorAll('option')].map((o) => o.value).filter(Boolean);
    expect(codes).toEqual(['low']);
    fireEvent.click(within(section).getByRole('button', { name: 'couriers.subscriptions.remove G' }));
    // asks first: nothing is sent until the removal is confirmed; cancelling keeps it
    const confirm = await within(section).findByRole('alertdialog');
    expect(confirm.textContent).toContain('couriers.subscriptions.confirmRemove');
    // the dialog takes focus (keyboard / screen reader land on it) and reuses the warn Notice, no hand-written colors
    expect(document.activeElement).toBe(within(confirm).getByRole('button', { name: 'couriers.subscriptions.confirmRemoveYes' }));
    expect(confirm.className).not.toMatch(/amber-/);
    expect(confirm.querySelectorAll('[class*="amber-"]')).toHaveLength(1); // only the shared warn Notice
    expect(svc.unsubscribeCourier).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: 'couriers.common.cancel' }));
    expect(within(section).queryByRole('alertdialog')).toBeNull();
    fireEvent.click(within(section).getByRole('button', { name: 'couriers.subscriptions.remove G' }));
    fireEvent.click(within(await within(section).findByRole('alertdialog')).getByRole('button', { name: 'couriers.subscriptions.confirmRemoveYes' }));
    await waitFor(() => expect(svc.unsubscribeCourier).toHaveBeenCalledWith('c1', 'g'));
    expect(await within(section).findByText('couriers.subscriptions.removed')).toBeTruthy();
  });

  it('a subscription whose type has no current version is shown as inert (code only, never the old name)', async () => {
    svc.unsubscribeCourier.mockResolvedValue(1);
    const section = await open({ subs: [{ id: 's1', courier_id: 'c1', payment_type_code: 'old' }] });
    const row = within(section).getByTestId('subscription-row');
    expect(row.textContent).toContain('couriers.subscriptions.inert');
    expect(row.textContent).toContain('old');
    expect(row.textContent).not.toContain('OLD');
    fireEvent.click(within(section).getByRole('button', { name: 'couriers.subscriptions.remove old' }));
    fireEvent.click(within(await within(section).findByRole('alertdialog')).getByRole('button', { name: 'couriers.subscriptions.confirmRemoveYes' }));
    await waitFor(() => expect(svc.unsubscribeCourier).toHaveBeenCalledWith('c1', 'old'));
  });

  it('a coverage_gap refusal shows the gaps in a live region; confirming resends with acceptGaps', async () => {
    svc.subscribeCourier
      .mockRejectedValueOnce(Object.assign(new Error('coverage_gap: x'), { i18nKey: 'couriers.errors.coverageGap', gaps: [{ kind: 'remittance', from: 10000, to: null }] }))
      .mockResolvedValueOnce('s1');
    const section = await open();
    fireEvent.change(within(section).getByLabelText('couriers.subscriptions.type'), { target: { value: 'low' } });
    const add = within(section).getByRole('button', { name: 'couriers.subscriptions.add' });
    fireEvent.click(add);
    const warning = await within(section).findByTestId('subscription-gap-warning');
    expect(warning.closest('[aria-live]')).toBeTruthy();
    expect(warning.textContent).toContain('couriers.types.range.gt:{"x":"100.00","currency":"USD"}');
    expect(within(section).getByText('couriers.errors.coverageGap')).toBeTruthy();
    fireEvent.click(add);
    expect(await within(section).findByText('couriers.types.acceptGapsRequired')).toBeTruthy();
    expect(svc.subscribeCourier).toHaveBeenCalledTimes(1);
    fireEvent.click(within(section).getByRole('checkbox', { name: 'couriers.subscriptions.acceptGaps' }));
    fireEvent.click(add);
    await waitFor(() => expect(svc.subscribeCourier).toHaveBeenCalledTimes(2));
    expect(svc.subscribeCourier.mock.calls[1]).toEqual(['c1', 'low', { acceptGaps: true }]);
  });

  it('an overlap refusal is shown as a typed error (no gap confirmation)', async () => {
    svc.subscribeCourier.mockRejectedValue(Object.assign(new Error('x'), { i18nKey: 'couriers.errors.overlap', gaps: null }));
    const section = await open();
    fireEvent.change(within(section).getByLabelText('couriers.subscriptions.type'), { target: { value: 'g' } });
    fireEvent.click(within(section).getByRole('button', { name: 'couriers.subscriptions.add' }));
    expect(await within(section).findByText('couriers.errors.overlap')).toBeTruthy();
    expect(within(section).queryByTestId('subscription-gap-warning')).toBeNull();
  });

  it('the add button stays disabled until a type is chosen', async () => {
    const section = await open();
    expect(within(section).getByRole('button', { name: 'couriers.subscriptions.add' }).disabled).toBe(true);
  });

  it('is hidden while its migration is not applied (the rest of the tab works)', async () => {
    svc.listSubscriptions.mockResolvedValue({ available: false, items: [] });
    render(<SettingsCouriersTab />);
    expect(await screen.findByText('Ana')).toBeTruthy();
    expect(screen.queryByText('couriers.subscriptions.title')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
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
