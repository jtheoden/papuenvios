import { describe, it, expect } from 'vitest';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';

const flatten = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([key, value]) =>
    value && typeof value === 'object' ? flatten(value, `${prefix}${key}.`) : [`${prefix}${key}`]
  );

const REQUIRED = [
  'tablistLabel',
  'ordersTab',
  'remittancesTab',
  'countSr',
  'filter.toProcess',
  'filter.needsValidation',
  'filter.needsDelivery',
  'filter.awaitingCustomer',
  'filter.all',
  'age.overdue',
  'viewProofAria',
  'emptyToProcess',
  'viewAll',
  'error',
  'retry',
  'liveNew',
  'badgeAria',
  'ordersHeading'
];

describe('adminInbox translation namespace', () => {
  it('exists in both languages with identical keys', () => {
    expect(ES.adminInbox).toBeDefined();
    expect(EN.adminInbox).toBeDefined();
    expect(flatten(ES.adminInbox).sort()).toEqual(flatten(EN.adminInbox).sort());
  });

  it('contains every key the UI needs, with non-empty strings', () => {
    const keys = flatten(EN.adminInbox);
    REQUIRED.forEach((key) => expect(keys).toContain(key));
    [ES, EN].forEach((lang) => flatten(lang.adminInbox).forEach((k) => {
      const value = k.split('.').reduce((acc, part) => acc[part], lang.adminInbox);
      expect(typeof value).toBe('string');
      expect(value.trim()).not.toBe('');
    }));
  });

  it('has col.* labels for the table columns', () => {
    const keys = flatten(EN.adminInbox);
    ['number', 'sender', 'recipient', 'amount', 'method', 'age', 'status', 'actions'].forEach((c) =>
      expect(keys).toContain(`col.${c}`)
    );
  });
});
