import { describe, it, expect } from 'vitest';
import {
  PROPOSAL_COLUMNS,
  isBackendMissingError,
  commissionErrorReason,
  commissionErrorKey,
  groupProposals,
  calcCommissionChange,
  isInformedCurrent,
} from '@/lib/commissionProposalRules';

describe('PROPOSAL_COLUMNS', () => {
  it('lists explicit customer-facing columns only (no *, no admin-side columns)', () => {
    expect(PROPOSAL_COLUMNS).not.toContain('*');
    for (const hidden of ['created_by', 'responded_by', 'override_id']) expect(PROPOSAL_COLUMNS).not.toContain(hidden);
    expect(PROPOSAL_COLUMNS.split(',').map((c) => c.trim())).toEqual([
      'id', 'remittance_id', 'direction', 'baseline_commission', 'new_commission', 'status', 'created_at', 'responded_at',
    ]);
  });
});

describe('isBackendMissingError (the front ships before the migrations)', () => {
  it.each([
    [{ code: '42P01', message: 'relation "x" does not exist' }],
    [{ code: '42883', message: 'function x does not exist' }],
    [{ code: 'PGRST205', message: "Could not find the table 'public.x' in the schema cache" }],
    [{ code: 'PGRST202', message: 'Could not find the function public.x in the schema cache' }],
  ])('treats %j as missing', (error) => expect(isBackendMissingError(error)).toBe(true));

  it.each([
    [null],
    [{ code: '42501', message: 'permission denied' }],
    [{ code: '500', message: 'boom' }],
    [{ code: '42703', message: 'column "x" does not exist' }], // a real bug, must stay visible
    [{ message: 'relation "x" does not exist' }],
  ])(
    'does not hide %j', (error) => expect(isBackendMissingError(error)).toBe(false));
});

describe('commissionErrorReason / commissionErrorKey', () => {
  it.each([
    [{ code: '22023', message: 'commission_pending_acceptance' }, 'commission_pending_acceptance'],
    [{ code: '22023', message: 'proposal_not_open', details: 'superseded' }, 'proposal_not_open'],
    [{ code: '22023', message: 'proposal_stale' }, 'proposal_stale'],
    [{ code: '22023', message: 'invalid_transition' }, 'invalid_transition'],
    [{ code: '42501', message: 'not_authorized' }, 'not_authorized'],
    [{ code: 'P0002', message: 'proposal_not_found' }, 'proposal_not_open'],
  ])('maps %j to %s', (error, reason) => {
    expect(commissionErrorReason(error)).toBe(reason);
    expect(commissionErrorKey(reason)).toMatch(/^remittances\.commissionChange\.errors\./);
  });

  it('returns null / the generic key for unknown errors', () => {
    expect(commissionErrorReason({ code: '500', message: 'x' })).toBeNull();
    expect(commissionErrorKey(null)).toBe('remittances.commissionChange.errors.generic');
  });
});

describe('groupProposals', () => {
  const row = (id, remittance_id, status, created_at) => ({ id, remittance_id, status, created_at });
  it('keeps the pending one and the latest informed per remittance', () => {
    const g = groupProposals([
      row('a', 'r1', 'informed', '2026-01-01'),
      row('b', 'r1', 'informed', '2026-01-03'),
      row('c', 'r1', 'pending', '2026-01-02'),
      row('d', 'r2', 'accepted', '2026-01-02'),
    ]);
    expect(g.pending.r1.id).toBe('c');
    expect(g.informed.r1.id).toBe('b');
    expect(g.pending.r2).toBeUndefined();
    expect(g.informed.r2).toBeUndefined();
  });
  it('handles empty / non-array input', () => {
    expect(groupProposals(null)).toEqual({ pending: {}, informed: {} });
  });
});

describe('calcCommissionChange', () => {
  it('derives what the recipient gets before/after from the live row, using the 4-decimal rate', () => {
    const r = calcCommissionChange(
      { amount_sent: 100, exchange_rate: 800 },
      { baseline_commission: '2.50', new_commission: '6.00' }
    );
    expect(r).toEqual({ oldCommission: 2.5, newCommission: 6, oldReceives: 78000, newReceives: 75200, delta: 3.5 });
  });
});

describe('isInformedCurrent (a decrease notice is only true while the live commission is the one it announced)', () => {
  const informed = { status: 'informed', new_commission: '1.00' };
  it('is true when the live commission equals the announced one', () => {
    expect(isInformedCurrent({ commission_total: 1 }, informed)).toBe(true);
    expect(isInformedCurrent({ commission_total: '1.00' }, informed)).toBe(true);
  });
  it('is false after a later raise (6 -> 1 informed, then 1 -> 8 accepted)', () => {
    expect(isInformedCurrent({ commission_total: 8 }, informed)).toBe(false);
  });
  it('is false without a proposal', () => {
    expect(isInformedCurrent({ commission_total: 1 }, null)).toBe(false);
  });
});
