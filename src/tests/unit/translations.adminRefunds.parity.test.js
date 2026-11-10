import { describe, it, expect } from 'vitest';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';

const flatten = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([key, value]) =>
    value && typeof value === 'object' ? flatten(value, `${prefix}${key}.`) : [[`${prefix}${key}`, value]]
  );

const REQUIRED = [
  'tab',
  'tabCountSr',
  'tabCountOverdueSr',
  'filter.toRefund',
  'filter.verify',
  'filter.onHold',
  'filter.overdue',
  'filter.refunded',
  'filter.notApplicable',
  'filter.all',
  'level.validated',
  'level.proof_unverified',
  'deadline.onTime',
  'deadline.dueSoon',
  'deadline.overdue',
  'deadline.onHold',
  'actions.markRefunded',
  'actions.notApplicable',
  'actions.copy',
  'modal.refunded.confirmArrived',
  'modal.notApplicable.reasonLabel',
  'states.emptyPending',
  'states.conflict',
  'errors.onHold',
  'errors.alreadyResolved',
  'dashboard.cta',
  'copy.amount'
];

const placeholders = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('adminRefunds translation namespace', () => {
  const es = Object.fromEntries(flatten(ES.adminRefunds || {}));
  const en = Object.fromEntries(flatten(EN.adminRefunds || {}));

  it('exists in both languages with identical keys', () => {
    expect(ES.adminRefunds).toBeDefined();
    expect(EN.adminRefunds).toBeDefined();
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
  });

  it('contains every key the UI needs, with non-empty strings', () => {
    REQUIRED.forEach((key) => {
      expect(typeof es[key], key).toBe('string');
      expect(es[key].trim().length, key).toBeGreaterThan(0);
      expect(en[key].trim().length, key).toBeGreaterThan(0);
    });
  });

  it('uses the same interpolation placeholders in both languages', () => {
    Object.keys(es).forEach((key) => expect(placeholders(es[key]), key).toEqual(placeholders(en[key])));
  });

  it('addresses the reader formally in Spanish (usted), never as tu', () => {
    Object.entries(es).forEach(([key, text]) => {
      expect(text, key).not.toMatch(/\b(tienes|puedes|eres|quieres|necesitas|tu cuenta)\b/i);
    });
  });
});
