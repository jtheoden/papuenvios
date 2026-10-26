import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const db = vi.hoisted(() => ({ rpc: vi.fn(), tables: {}, calls: [] }));
vi.mock('@/lib/supabase', () => {
  const chain = (table) => {
    const c = {};
    ['select', 'eq', 'in', 'order', 'limit', 'gte', 'lt', 'is'].forEach((m) => {
      c[m] = (...args) => { db.calls.push([table, m, ...args]); return c; };
    });
    c.then = (resolve) => resolve(db.tables[table] ?? { data: [], error: null });
    return c;
  };
  return { supabase: { from: (table) => chain(table), rpc: (...args) => db.rpc(...args) } };
});
const logError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/errorHandler', async (orig) => ({ ...(await orig()), logError }));

import * as svc from '@/lib/courierService';

const missing = (code) => ({ data: null, error: { code, message: 'nope' } });
let errSpy;
let warnSpy;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-26T12:00:00Z'));
  db.rpc.mockReset();
  db.tables = {};
  db.calls = [];
  logError.mockReset();
  svc.resetCourierBackendForTests();
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  errSpy.mockRestore();
  warnSpy.mockRestore();
});

describe('reads degrade silently while the migrations are not applied', () => {
  it.each(['42P01', '42883', 'PGRST205', 'PGRST202'])('table read with %s => unavailable, no log, no console noise', async (code) => {
    db.tables.couriers = missing(code);
    expect(await svc.listCouriers()).toEqual({ available: false, items: [] });
    expect(logError).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
  it.each(['42883', 'PGRST202'])('rpc read with %s => unavailable, no log', async (code) => {
    db.rpc.mockResolvedValue(missing(code));
    expect(await svc.getCourierReport({ from: null, to: null })).toEqual({ available: false, rows: [] });
    expect(logError).not.toHaveBeenCalled();
  });
  it('stops asking for 5 minutes after a miss, then tries again (applying the migrations is picked up without a reload)', async () => {
    db.tables.couriers = missing('42P01');
    await svc.listCouriers();
    await svc.listPaymentTypes();
    expect(db.calls.filter((c) => c[1] === 'select')).toHaveLength(1);
    db.tables.couriers = { data: [{ id: 'c1', name: 'Pedro', is_active: true }], error: null };
    vi.advanceTimersByTime(4 * 60 * 1000);
    expect((await svc.listCouriers()).available).toBe(false);
    vi.advanceTimersByTime(61 * 1000);
    const res = await svc.listCouriers();
    expect(res.available).toBe(true);
    expect(res.items).toHaveLength(1);
  });
  it('a real failure of a read is thrown (the screen shows an error), not hidden', async () => {
    db.tables.couriers = { data: null, error: { code: '57014', message: 'timeout' } };
    await expect(svc.listCouriers()).rejects.toBeTruthy();
  });
  it('the delivery selector options and the margin summary never throw', async () => {
    db.tables.couriers = { data: null, error: { code: 'XX000', message: 'boom' } };
    expect(await svc.listDeliveryCouriers()).toEqual([]);
    db.tables.courier_margin_settings = { data: null, error: { code: 'XX000', message: 'boom' } };
    expect(await svc.getMarginSummary(new Date())).toEqual({ available: false, thresholdsSet: false, counts: null });
  });
});

describe('margin summary', () => {
  it('has no alerts while the owner has not set any threshold', async () => {
    db.tables.courier_margin_settings = { data: [{ kind: 'remittance', target_pct: null, warning_pct: null, critical_pct: null }, { kind: 'order', target_pct: null, warning_pct: null, critical_pct: null }], error: null };
    const s = await svc.getMarginSummary(new Date());
    expect(s).toEqual({ available: true, thresholdsSet: false, counts: null });
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it('sums the report flags of the month when a threshold exists', async () => {
    db.tables.courier_margin_settings = { data: [{ kind: 'remittance', target_pct: null, warning_pct: '3.0000', critical_pct: '0.0000' }], error: null };
    db.rpc.mockResolvedValue({ data: [
      { margin_warning_count: 1, margin_critical_count: 2, margin_unknown_count: 3, unknown_amount_count: 1 },
      { margin_warning_count: 0, margin_critical_count: 1, margin_unknown_count: 0, unknown_amount_count: 0 }
    ], error: null });
    const s = await svc.getMarginSummary(new Date('2026-10-26T12:00:00Z'));
    expect(s).toEqual({ available: true, thresholdsSet: true, counts: { warning: 1, critical: 3, unknown: 3, unknownAmount: 1 } });
    expect(db.rpc).toHaveBeenCalledWith('admin_courier_report', expect.objectContaining({ p_courier_id: null }));
  });
});

describe('writes never degrade and carry a typed error', () => {
  it('maps the RPC refusal to an i18n key on the thrown error', async () => {
    db.rpc.mockResolvedValue({ data: null, error: { code: '23P01', message: 'overlapping_rule: x' } });
    await expect(svc.setPaymentType({ p_code: 'a' })).rejects.toMatchObject({ i18nKey: 'couriers.errors.overlap' });
  });
  it('a missing backend on a write is reported as unavailable, never as success', async () => {
    db.rpc.mockResolvedValue(missing('42883'));
    await expect(svc.upsertCourier({ name: 'x' })).rejects.toMatchObject({ i18nKey: 'couriers.errors.unavailable' });
  });
  it('passes the exact RPC argument names', async () => {
    db.rpc.mockResolvedValue({ data: 'id-1', error: null });
    await svc.upsertCourier({ id: null, name: ' Pedro ', phone: '', notes: '', isActive: true });
    expect(db.rpc).toHaveBeenLastCalledWith('admin_upsert_courier', { p_id: null, p_name: 'Pedro', p_phone: null, p_notes: null, p_is_active: true });
    await svc.registerPayment({ courierId: null, accrualIds: ['a'], method: ' cash ', reference: '', paidAt: '2026-10-25T00:00:00Z', notes: '' });
    expect(db.rpc).toHaveBeenLastCalledWith('admin_register_courier_payment', {
      p_courier_id: null, p_accrual_ids: ['a'], p_method: 'cash', p_reference: null, p_paid_at: '2026-10-25T00:00:00Z', p_notes: null
    });
    await svc.setMarginThresholds('remittance', { targetPct: '', warningPct: '3', criticalPct: '0' });
    expect(db.rpc).toHaveBeenLastCalledWith('admin_set_margin_thresholds', { p_kind: 'remittance', p_target: null, p_warning: 3, p_critical: 0 });
  });
});

describe('assignDeliveryCourier (called BEFORE the delivery transition)', () => {
  it('does nothing without a selection', async () => {
    await svc.assignDeliveryCourier('remittance', 'r1', '');
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it('calls the RPC with the selected courier', async () => {
    db.rpc.mockResolvedValue({ data: null, error: null });
    await svc.assignDeliveryCourier('order', 'o1', 'c1');
    expect(db.rpc).toHaveBeenCalledWith('admin_assign_delivery_courier', { p_kind: 'order', p_id: 'o1', p_courier_id: 'c1' });
  });
  it('a missing backend does not block the delivery (the courier cannot have been chosen, but never fail the flow)', async () => {
    db.rpc.mockResolvedValue(missing('42883'));
    await expect(svc.assignDeliveryCourier('order', 'o1', 'c1')).resolves.toBeUndefined();
  });
  it('any other failure is thrown so the delivery is NOT confirmed', async () => {
    db.rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'invalid_status: the courier cannot be changed once the operation is delivered' } });
    await expect(svc.assignDeliveryCourier('order', 'o1', 'c1')).rejects.toMatchObject({ i18nKey: 'couriers.errors.alreadyDelivered' });
  });
});
