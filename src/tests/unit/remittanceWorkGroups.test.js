import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { calls: [] };

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table) => {
      const q = {
        select: (cols, opts) => {
          state.calls.push({ table, cols, opts });
          return q;
        },
        in: (col, values) => {
          state.calls.push({ in: col, values });
          return Promise.resolve({ count: 0, error: null });
        }
      };
      return q;
    })
  }
}));
vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn(async () => ({ success: true })) }));
vi.mock('@/lib/orderDiscountService', () => ({ recordOfferUsage: vi.fn() }));
vi.mock('@/lib/currencyService', () => ({ getExchangeRate: vi.fn() }));
vi.mock('@/lib/notificationSettingsService', () => ({
  getFreshWhatsappRecipient: vi.fn(async () => '+15551234567')
}));

import {
  REMITTANCE_STATUS,
  REMITTANCE_WORK_GROUPS,
  TO_PROCESS_STATUSES,
  groupRemittancesByWork,
  getPendingRemittancesCount
} from '@/lib/remittanceService';

const ALL_STATUSES = Object.values(REMITTANCE_STATUS);
const build = (status) => ({ id: status, status });

describe('REMITTANCE_WORK_GROUPS', () => {
  it('defines the three work groups with their statuses', () => {
    expect(REMITTANCE_WORK_GROUPS).toEqual({
      needs_validation: ['payment_proof_uploaded'],
      needs_delivery: ['payment_validated', 'processing'],
      awaiting_customer: ['payment_pending']
    });
  });

  it('never assigns one status to two groups', () => {
    const flat = Object.values(REMITTANCE_WORK_GROUPS).flat();
    expect(new Set(flat).size).toBe(flat.length);
  });
});

describe('groupRemittancesByWork', () => {
  it('places every status in the right group and drops terminal ones', () => {
    const grouped = groupRemittancesByWork(ALL_STATUSES.map(build));

    expect(grouped.needs_validation.map((r) => r.status)).toEqual(['payment_proof_uploaded']);
    expect(grouped.needs_delivery.map((r) => r.status).sort()).toEqual(['payment_validated', 'processing']);
    expect(grouped.awaiting_customer.map((r) => r.status)).toEqual(['payment_pending']);
    const grouped_statuses = Object.values(grouped).flat().map((r) => r.status);
    ['payment_rejected', 'delivered', 'completed', 'cancelled'].forEach((s) => {
      expect(grouped_statuses).not.toContain(s);
    });
  });

  it('returns empty groups for empty or invalid input', () => {
    const empty = { needs_validation: [], needs_delivery: [], awaiting_customer: [] };
    expect(groupRemittancesByWork([])).toEqual(empty);
    expect(groupRemittancesByWork(undefined)).toEqual(empty);
    expect(groupRemittancesByWork(null)).toEqual(empty);
  });
});

describe('TO_PROCESS_STATUSES / badge parity', () => {
  beforeEach(() => {
    state.calls = [];
  });

  it('is the union of the statuses the admin can act on: needs_validation + needs_delivery', () => {
    expect([...TO_PROCESS_STATUSES].sort()).toEqual(
      [...REMITTANCE_WORK_GROUPS.needs_validation, ...REMITTANCE_WORK_GROUPS.needs_delivery].sort()
    );
  });

  it('excludes payment_pending (the customer has not paid yet) and contains every delivery status', () => {
    expect(TO_PROCESS_STATUSES).not.toContain('payment_pending');
    REMITTANCE_WORK_GROUPS.needs_delivery.forEach((s) => expect(TO_PROCESS_STATUSES).toContain(s));
  });

  it('is exactly what getPendingRemittancesCount queries, so badge number equals tab count', async () => {
    await getPendingRemittancesCount();
    const inCall = state.calls.find((c) => c.in === 'status');
    expect(inCall.values).toEqual(TO_PROCESS_STATUSES);
  });
});
