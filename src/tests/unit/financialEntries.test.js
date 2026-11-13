import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase', () => ({ supabase: { rpc, from } }));

import { validateFinancialEntry, sumEntriesNet, manualEntriesNetByWindow, businessToday } from '@/lib/financialEntryRules';
import { addFinancialEntry, voidFinancialEntry, listFinancialEntries } from '@/lib/financialEntriesService';

const valid = { kind: 'expense', amount: 25.5, entryDate: '2026-11-10', category: 'hosting', reason: 'Servidor mensual noviembre' };

describe('validateFinancialEntry', () => {
  it('accepts a complete entry', () => {
    expect(validateFinancialEntry(valid, '2026-11-13')).toEqual({});
  });
  it('rejects a bad kind, amount, short reason and future date', () => {
    const errors = validateFinancialEntry({ ...valid, kind: 'x', amount: 0, reason: 'corto', entryDate: '2026-12-01' }, '2026-11-13');
    expect(Object.keys(errors).sort()).toEqual(['amount', 'entryDate', 'kind', 'reason']);
  });
  it('rejects more than 2 decimals', () => {
    expect(validateFinancialEntry({ ...valid, amount: 1.234 }, '2026-11-13')).toHaveProperty('amount');
  });
});

describe('sumEntriesNet', () => {
  const entries = [
    { kind: 'income', amount: '100.00', entry_date: '2026-11-12' },
    { kind: 'expense', amount: '30.50', entry_date: '2026-11-12' },
    { kind: 'expense', amount: '10.00', entry_date: '2026-01-01' }
  ];
  it('adds incomes and subtracts expenses inside the window', () => {
    expect(sumEntriesNet(entries, '2026-11-01')).toBe(69.5);
  });
  it('a void (opposite entry) cancels the original', () => {
    const withVoid = [...entries, { kind: 'income', amount: '30.50', entry_date: '2026-11-13' }];
    expect(sumEntriesNet(withVoid, '2026-11-01')).toBe(100);
  });
  it('returns 0 without entries', () => {
    expect(sumEntriesNet([], '2026-11-01')).toBe(0);
    expect(sumEntriesNet(undefined, '2026-11-01')).toBe(0);
  });
});

describe('manualEntriesNetByWindow (same calendar windows as the rest of the Dashboard)', () => {
  const entry = (kind, amount, entry_date) => ({ kind, amount, entry_date });
  // 2026-11-13T15:00Z = Nov 13 10:00 ET: today Nov 13, month from Nov 1, year from Jan 1.
  const now = new Date('2026-11-13T15:00:00Z');
  const entries = [
    entry('expense', '10.00', '2026-11-13'), // today
    entry('expense', '20.00', '2026-11-12'), // yesterday: month and year, NOT today
    entry('income', '5.00', '2026-11-01'), // first of the month: month and year
    entry('expense', '40.00', '2026-10-31'), // previous month: year only (a rolling 30 days would wrongly include it)
    entry('income', '80.00', '2025-12-31') // previous year: nowhere
  ];

  it('counts only today in the daily window', () => {
    expect(manualEntriesNetByWindow(entries, now).daily).toBe(-10);
  });
  it('counts the calendar month, not the last 30 days', () => {
    expect(manualEntriesNetByWindow(entries, now).monthly).toBe(-25);
  });
  it('counts the calendar year, not the last 365 days', () => {
    expect(manualEntriesNetByWindow(entries, now).yearly).toBe(-65);
  });
  it('uses the business calendar near midnight: 21:00 ET Nov 12 is still Nov 12', () => {
    const late = new Date('2026-11-13T02:00:00Z');
    const w = manualEntriesNetByWindow([entry('expense', '7.00', '2026-11-12'), entry('expense', '3.00', '2026-11-11')], late);
    expect(w.daily).toBe(-7);
  });
  it('returns zeros without entries', () => {
    expect(manualEntriesNetByWindow(undefined, now)).toEqual({ daily: 0, monthly: 0, yearly: 0 });
  });
});

describe('businessToday', () => {
  it('is the New York calendar date, not the UTC one', () => {
    expect(businessToday(new Date('2026-11-13T02:00:00Z'))).toBe('2026-11-12');
    expect(businessToday(new Date('2026-11-13T15:00:00Z'))).toBe('2026-11-13');
  });
});

describe('financialEntriesService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('addFinancialEntry maps to the RPC params', async () => {
    rpc.mockResolvedValue({ data: { id: 'e1' }, error: null });
    await addFinancialEntry(valid);
    expect(rpc).toHaveBeenCalledWith('superadmin_add_financial_entry', {
      p_kind: 'expense', p_amount: 25.5, p_entry_date: '2026-11-10', p_category: 'hosting', p_reason: valid.reason
    });
  });

  it('addFinancialEntry rejects invalid input without calling the server', async () => {
    await expect(addFinancialEntry({ ...valid, amount: -1 })).rejects.toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('voidFinancialEntry needs an id and a reason', async () => {
    await expect(voidFinancialEntry('', 'motivo largo valido')).rejects.toBeTruthy();
    await expect(voidFinancialEntry('e1', 'corto')).rejects.toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: { id: 'e2' }, error: null });
    await voidFinancialEntry('e1', 'Error de carga del monto');
    expect(rpc).toHaveBeenCalledWith('superadmin_void_financial_entry', { p_entry_id: 'e1', p_reason: 'Error de carga del monto' });
  });

  const pagedFrom = (pages) => {
    const range = vi.fn();
    pages.forEach((page) => range.mockResolvedValueOnce(page));
    from.mockReturnValue({ select: () => ({ order: () => ({ order: () => ({ order: () => ({ range }) }) }) }) });
    return range;
  };

  it('listFinancialEntries pages through every row (PostgREST cuts at 1000)', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => ({ id: `a${i}` }));
    const range = pagedFrom([{ data: full, error: null }, { data: [{ id: 'last' }], error: null }]);
    const rows = await listFinancialEntries();
    expect(rows).toHaveLength(1001);
    expect(range).toHaveBeenNthCalledWith(1, 0, 999);
    expect(range).toHaveBeenNthCalledWith(2, 1000, 1999);
    expect(from).toHaveBeenCalledWith('financial_entries');
  });

  it('listFinancialEntries surfaces a read error instead of an empty list', async () => {
    pagedFrom([{ data: null, error: { message: 'boom', code: '42501' } }]);
    await expect(listFinancialEntries()).rejects.toBeTruthy();
  });

  it('addFinancialEntry validates the date against the business day, not UTC', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 2026-11-13T02:00Z is still 2026-11-12 21:00 in New York: 2026-11-13 is a future date there.
    vi.setSystemTime(new Date('2026-11-13T02:00:00Z'));
    try {
      await expect(addFinancialEntry({ ...valid, entryDate: '2026-11-13' })).rejects.toBeTruthy();
      expect(rpc).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
