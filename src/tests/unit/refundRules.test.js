import { describe, it, expect } from 'vitest';
import {
  REFUND_FILTERS,
  withQueueState,
  filterRefunds,
  countByFilter,
  summarizeRefunds,
  searchRefunds,
  sortRefunds,
  buildRefundCopyText,
  refundedAtFromDate,
  isRefundDateClamped,
  REFUND_PROOF_MAX_BYTES,
  validateRefundProofFile,
  refundProofExtension
} from '@/lib/refundRules';

const NOW = new Date('2026-10-30T12:00:00.000Z');
const iso = (hours) => new Date(NOW.getTime() + hours * 3600 * 1000).toISOString();

const row = (over = {}) => ({
  id: 'r',
  operation_type: 'order',
  operation_number: 'ORD-1',
  status: 'pending',
  payment_evidence: 'validated',
  amount: '10.00',
  currency: 'USD',
  eligible_at: iso(-10),
  due_at: iso(100),
  customer_name: 'Ana Pérez',
  customer_email: 'ana@example.test',
  resolution_reason: null,
  resolved_at: null,
  ...over
});

const hold = row({ id: 'hold', eligible_at: iso(12), due_at: iso(130) });
const onTime = row({ id: 'onTime' });
const soon = row({ id: 'soon', payment_evidence: 'proof_unverified', due_at: iso(5) });
const over = row({ id: 'over', operation_type: 'remittance', operation_number: 'REM-9', due_at: iso(-1) });
const done = row({ id: 'done', status: 'refunded', resolved_at: iso(-3) });
const reopened = row({ id: 'reopened', status: 'not_applicable', resolution_reason: 'reopened', resolved_at: iso(-2) });
const na = row({ id: 'na', status: 'not_applicable', resolution_reason: 'never arrived', resolved_at: iso(-5) });
const all = [hold, onTime, soon, over, done, reopened, na].map((r) => withQueueState(r, NOW));

describe('refundRules', () => {
  it('derives the queue state from the clock, not from the server snapshot', () => {
    expect(all.map((r) => r.queueState)).toEqual(['on_hold', 'on_time', 'due_soon', 'overdue', null, null, null]);
  });

  it('exposes the filter ids in the agreed order', () => {
    expect(REFUND_FILTERS).toEqual(['toRefund', 'verify', 'onHold', 'overdue', 'refunded', 'notApplicable', 'all']);
  });

  it('filters: toRefund is the actionable pending ones (what the badge counts), onHold separately', () => {
    const ids = (f) => filterRefunds(all, f).map((r) => r.id).sort();
    expect(ids('toRefund')).toEqual(['onTime', 'over', 'soon']);
    expect(ids('verify')).toEqual(['soon']);
    expect(ids('onHold')).toEqual(['hold']);
    expect(ids('overdue')).toEqual(['over']);
    expect(ids('refunded')).toEqual(['done']);
    expect(ids('notApplicable')).toEqual(['na', 'reopened']);
    expect(ids('all')).toHaveLength(7);
  });

  it('counts every filter', () => {
    expect(countByFilter(all)).toEqual({ toRefund: 3, verify: 1, onHold: 1, overdue: 1, refunded: 1, notApplicable: 2, all: 7 });
  });

  it('summarizes pending, USD-only amount, due soon and overdue', () => {
    const mixed = [...all, withQueueState(row({ id: 'eur', currency: 'EUR', amount: '99.00' }), NOW)];
    expect(summarizeRefunds(mixed)).toEqual({ pending: 5, pendingAmountUsd: 40, dueSoon: 1, overdue: 1, actionable: 4, onHold: 1 });
  });

  it('searches by operation number, customer name and email, ignoring case and accents', () => {
    expect(searchRefunds(all, 'rem-9').map((r) => r.id)).toEqual(['over']);
    expect(searchRefunds(all, 'ANA PEREZ')).toHaveLength(7);
    expect(searchRefunds(all, 'nobody@x')).toHaveLength(0);
    expect(searchRefunds(all, '  ')).toHaveLength(7);
  });

  it('sorts overdue, due_soon, on_time, on_hold, then resolved by most recent', () => {
    const sorted = sortRefunds([...all].reverse()).map((r) => r.id);
    expect(sorted).toEqual(['over', 'soon', 'onTime', 'hold', 'reopened', 'done', 'na']);
  });

  it('builds one copyable block with the data needed to send the Zelle', () => {
    const text = buildRefundCopyText(
      row({ amount: '107.50', payer_phone: '+13055550100', payment_reference: 'ABC123', operation_number: 'REM-0311', operation_type: 'remittance' }),
      { t: (key) => key }
    );
    expect(text).toContain('107.50 USD');
    expect(text).toContain('Ana Pérez');
    expect(text).toContain('ana@example.test');
    expect(text).toContain('+13055550100');
    expect(text).toContain('ABC123');
    expect(text).toContain('REM-0311');
    expect(text.split('\n').length).toBeGreaterThan(3);
  });

  describe('refundedAtFromDate', () => {
    const eligibleAt = '2026-10-28T14:00:00.000Z';
    const localDay = (d) => {
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };
    it('returns null for today (or no date) so the server stamps now()', () => {
      expect(refundedAtFromDate(localDay(NOW), eligibleAt, NOW)).toBeNull();
      expect(refundedAtFromDate('', eligibleAt, NOW)).toBeNull();
    });
    it('uses local noon of a past day', () => {
      const yesterday = new Date(NOW.getTime() - 86400000);
      expect(refundedAtFromDate(localDay(yesterday), eligibleAt, NOW)).toBe(
        new Date(`${localDay(yesterday)}T12:00:00`).toISOString()
      );
    });
    it('reports when the chosen day had to be raised to eligible_at', () => {
      const eligible = new Date(eligibleAt);
      const sameDay = localDay(eligible);
      const noon = new Date(`${sameDay}T12:00:00`);
      expect(isRefundDateClamped(sameDay, eligibleAt, NOW)).toBe(noon < eligible);
      const yesterday = new Date(NOW.getTime() - 86400000);
      expect(isRefundDateClamped(localDay(yesterday), eligibleAt, NOW)).toBe(false);
      expect(isRefundDateClamped(localDay(NOW), eligibleAt, NOW)).toBe(false);
      expect(isRefundDateClamped('', eligibleAt, NOW)).toBe(false);
    });
    it('never goes before eligible_at', () => {
      const eligible = new Date(eligibleAt);
      const sameDay = localDay(eligible);
      const noon = new Date(`${sameDay}T12:00:00`);
      const expected = noon < eligible ? eligibleAt : noon.toISOString();
      expect(refundedAtFromDate(sameDay, eligibleAt, NOW)).toBe(expected);
    });
  });
});

describe('refund proof file rules', () => {
  const file = (name, type, size = 10) => ({ name, type, size });

  it('accepts jpeg, png, webp and pdf up to 5 MB', () => {
    expect(REFUND_PROOF_MAX_BYTES).toBe(5 * 1024 * 1024);
    for (const [name, type] of [['a.jpg', 'image/jpeg'], ['a.png', 'image/png'], ['a.webp', 'image/webp'], ['a.pdf', 'application/pdf']]) {
      expect(validateRefundProofFile(file(name, type))).toBeNull();
    }
    expect(validateRefundProofFile(file('a.png', 'image/png', REFUND_PROOF_MAX_BYTES))).toBeNull();
  });

  it('refuses a missing file, other types, an empty file and a file over 5 MB', () => {
    expect(validateRefundProofFile(null)).toBe('missing');
    expect(validateRefundProofFile(file('a.txt', 'text/plain'))).toBe('type');
    expect(validateRefundProofFile(file('a.gif', 'image/gif'))).toBe('type');
    expect(validateRefundProofFile(file('a.png', 'image/png', 0))).toBe('size');
    expect(validateRefundProofFile(file('a.png', 'image/png', REFUND_PROOF_MAX_BYTES + 1))).toBe('size');
  });

  it('derives the storage extension from the MIME type, never from the file name', () => {
    expect(refundProofExtension('image/jpeg')).toBe('jpg');
    expect(refundProofExtension('image/png')).toBe('png');
    expect(refundProofExtension('image/webp')).toBe('webp');
    expect(refundProofExtension('application/pdf')).toBe('pdf');
    expect(refundProofExtension('text/html')).toBeNull();
  });
});
