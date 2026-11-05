/**
 * A3 - every financial window uses the business time zone (America/New_York), whatever the browser time zone is.
 * Vector: 2026-12-01T04:30Z is 2026-11-30 23:30 in New York. Its month is November in New York
 * (starts 2026-11-01 00:00 EDT = 04:00Z, because DST ends later that day) and ends 2026-12-01 00:00 EST = 05:00Z.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const db = vi.hoisted(() => ({ rpc: vi.fn(), tables: {}, usageRows: null, usageError: null, historyGte: [] }));
vi.mock('@/lib/supabase', () => {
  const chain = (table) => {
    const c = {};
    ['select', 'eq', 'in', 'order', 'limit', 'lt', 'is'].forEach((m) => {
      c[m] = () => c;
    });
    c.gte = (column, value) => {
      if (table === 'zelle_transaction_history') db.historyGte.push([column, value]);
      return c;
    };
    c.then = (resolve) => resolve(db.tables[table] ?? { data: [], error: null });
    return c;
  };
  return {
    supabase: {
      from: (table) => chain(table),
      rpc: (...args) => db.rpc(...args)
    }
  };
});
vi.mock('@/lib/errorHandler', async (orig) => ({ ...(await orig()), logError: vi.fn() }));

import * as courier from '@/lib/courierService';
import { getZelleAccountUsageSummary } from '@/lib/zelleService';
import { getBusinessMonthRange } from '@/lib/dashboardMetrics';

const originalTz = process.env.TZ;
const NOW = new Date('2026-12-01T04:30:00Z');
const ZONES = ['Asia/Tokyo', 'Europe/Madrid', 'America/Los_Angeles', 'UTC'];

beforeEach(() => {
  db.rpc.mockReset();
  db.tables = {};
  db.historyGte = [];
  courier.resetCourierBackendForTests();
});
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe('getBusinessMonthRange', () => {
  it('the zone matrix really changes the process zone (guards against a vacuous pass)', () => {
    process.env.TZ = 'Asia/Tokyo';
    const tokyo = new Date(NOW).getTimezoneOffset();
    process.env.TZ = 'America/Los_Angeles';
    expect(new Date(NOW).getTimezoneOffset()).not.toBe(tokyo);
  });

  it.each(ZONES)('is November in New York regardless of the browser zone (%s)', (zone) => {
    process.env.TZ = zone;
    expect(getBusinessMonthRange(NOW)).toEqual({
      from: '2026-11-01T04:00:00.000Z',
      to: '2026-12-01T05:00:00.000Z'
    });
  });

  it('rolls December over to January of the next year', () => {
    expect(getBusinessMonthRange(new Date('2026-12-15T12:00:00Z'))).toEqual({
      from: '2026-12-01T05:00:00.000Z',
      to: '2027-01-01T05:00:00.000Z'
    });
  });
});

describe('getMarginSummary month window', () => {
  it.each(ZONES)('asks the report for the New York month under %s', async (zone) => {
    process.env.TZ = zone;
    db.tables.courier_margin_settings = {
      data: [{ kind: 'remittance', target_pct: null, warning_pct: '3.0000', critical_pct: '0.0000' }],
      error: null
    };
    db.rpc.mockResolvedValue({ data: [], error: null });

    await courier.getMarginSummary(NOW);

    expect(db.rpc).toHaveBeenCalledWith(
      'admin_courier_report',
      expect.objectContaining({ p_from: '2026-11-01T04:00:00.000Z', p_to: '2026-12-01T05:00:00.000Z' })
    );
  });
});

describe('getZelleAccountUsageSummary legacy fallback', () => {
  it.each(ZONES)('windows the history from the New York month start under %s', async (zone) => {
    process.env.TZ = zone;
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      db.rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'rpc down' } });
      db.tables.zelle_transaction_history = {
        data: [
          // 30-nov 22:00 NY: this month and today (today starts 30-nov 00:00 NY = 05:00Z)
          { zelle_account_id: 'a1', amount: '10', status: 'validated', transaction_date: '2026-12-01T03:00:00Z', created_at: '2026-12-01T03:00:00Z' },
          // 30-nov 01:00 NY: this month and today
          { zelle_account_id: 'a1', amount: '5', status: 'validated', transaction_date: '2026-11-30T06:00:00Z', created_at: '2026-11-30T06:00:00Z' },
          // 29-nov 23:00 NY: this month, not today
          { zelle_account_id: 'a1', amount: '1', status: 'validated', transaction_date: '2026-11-30T04:00:00Z', created_at: '2026-11-30T04:00:00Z' },
          // 31-oct 23:00 NY (EDT): previous month
          { zelle_account_id: 'a1', amount: '100', status: 'validated', transaction_date: '2026-11-01T03:00:00Z', created_at: '2026-11-01T03:00:00Z' }
        ],
        error: null
      };

      const summary = await getZelleAccountUsageSummary();

      expect(db.historyGte[0][1]).toBe('2026-11-01T04:00:00.000Z');
      expect(summary.a1).toEqual({ dailyAmount: 15, monthlyAmount: 16 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not touch the legacy table when the computed RPC works', async () => {
    db.rpc.mockResolvedValue({ data: [{ id: 'a1', daily_usage: '3', monthly_usage: '7' }], error: null });
    await expect(getZelleAccountUsageSummary()).resolves.toEqual({ a1: { dailyAmount: 3, monthlyAmount: 7 } });
    expect(db.historyGte).toHaveLength(0);
  });
});
