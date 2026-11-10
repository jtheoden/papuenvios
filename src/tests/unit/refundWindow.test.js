import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vectors from '../fixtures/refund-window-vectors.json';
import { REFUND_BUSINESS_DAYS, REFUND_HOLD_HOURS } from '@/lib/legalConfig';
import { addBusinessDays, refundEligibleAt, refundDueAt, refundQueueState } from '@/lib/refundWindow';

describe('refundWindow (JS mirror of the SQL window)', () => {
  it('uses the constants the shared vectors were written for', () => {
    expect(REFUND_HOLD_HOURS).toBe(vectors.constants.holdHours);
    expect(REFUND_BUSINESS_DAYS).toBe(vectors.constants.businessDays);
  });

  it.each(vectors.windows)('$name', ({ cancelled_at, eligible_at, due_at }) => {
    expect(refundEligibleAt(cancelled_at).toISOString()).toBe(eligible_at);
    expect(addBusinessDays(eligible_at, REFUND_BUSINESS_DAYS).toISOString()).toBe(due_at);
    expect(refundDueAt(cancelled_at).toISOString()).toBe(due_at);
  });

  it.each(vectors.states)('queue state: $name', ({ eligible_at, due_at, now, state }) => {
    expect(refundQueueState({ eligibleAt: eligible_at, dueAt: due_at }, now)).toBe(state);
  });

  it('accepts Date instances as well as ISO strings', () => {
    const w = vectors.windows[0];
    expect(refundDueAt(new Date(w.cancelled_at)).toISOString()).toBe(w.due_at);
  });

  it('REFUND_HOLD_HOURS is a literal, not derived from CLAIM_WINDOW_HOURS', () => {
    const src = readFileSync('src/lib/legalConfig.js', 'utf8');
    expect(src).toMatch(/export const REFUND_HOLD_HOURS = \d+;/);
  });

  it('matches the SQL constants of the migration', () => {
    const sql = readFileSync('supabase/migrations/20261029100100_add_business_days.sql', 'utf8');
    expect(sql).toMatch(new RegExp(`refund_hold_hours\\(\\)[\\s\\S]*?SELECT ${REFUND_HOLD_HOURS}\\b`));
    expect(sql).toMatch(new RegExp(`refund_business_days\\(\\)[\\s\\S]*?SELECT ${REFUND_BUSINESS_DAYS}\\b`));
  });
});
