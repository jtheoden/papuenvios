import { describe, it, expect } from 'vitest';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';

const get = (obj, path) => path.split('.').reduce((acc, k) => acc?.[k], obj);
const placeholders = (s) => (String(s).match(/\{\w+\}/g) || []).sort();
const flatten = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]);

const NAMESPACES = [
  'remittances.commissionChange',
  'remittances.admin.commissionProposal',
];
const EXTRA = [
  'remittances.admin.commissionOverride.savedAwaitingCustomer',
  'remittances.admin.commissionOverride.savedCustomerInformed',
];
const GONE = [
  'remittances.admin.commissionOverride.lowerOnlyHint',
  'remittances.admin.commissionOverride.errorLowerOnly',
];

describe('commission acceptance translations', () => {
  it.each(NAMESPACES)('%s has the same keys and {placeholders} in ES and EN, none empty', (ns) => {
    const es = get(ES, ns);
    const en = get(EN, ns);
    expect(es, ns).toBeDefined();
    expect(en, ns).toBeDefined();
    expect(flatten(es).sort()).toEqual(flatten(en).sort());
    flatten(es).forEach((key) => {
      expect(String(get(es, key)).trim(), key).not.toBe('');
      expect(String(get(en, key)).trim(), key).not.toBe('');
      expect(placeholders(get(es, key)), key).toEqual(placeholders(get(en, key)));
    });
  });

  it.each(EXTRA)('%s exists in both languages', (key) => {
    expect(String(get(ES, key)).trim()).not.toBe('');
    expect(String(get(EN, key)).trim()).not.toBe('');
  });

  it.each(GONE)('%s (dead lower-only copy) was removed', (key) => {
    expect(get(ES, key)).toBeUndefined();
    expect(get(EN, key)).toBeUndefined();
  });

  it('every error reason the code can produce has a message', () => {
    for (const k of ['pendingAcceptance', 'notOpen', 'stale', 'invalidTransition', 'notAuthorized', 'generic']) {
      expect(get(ES, `remittances.commissionChange.errors.${k}`), k).toBeTruthy();
      expect(get(EN, `remittances.commissionChange.errors.${k}`), k).toBeTruthy();
    }
  });

  it('new customer copy addresses the user formally in ES (usted) and avoids the word Zelle', () => {
    const es = JSON.stringify(get(ES, 'remittances.commissionChange'));
    const en = JSON.stringify(get(EN, 'remittances.commissionChange'));
    expect(es).not.toMatch(/Zelle/i);
    expect(en).not.toMatch(/Zelle/i);
    expect(es).not.toMatch(/\b(tu|tus|tienes|puedes|acepta|pagas)\b/i);
  });

  it('disabledReason no longer claims the window is "before delivery starts" (it freezes at the proof upload)', () => {
    expect(get(ES, 'remittances.admin.commissionOverride.disabledReason')).not.toMatch(/entrega/i);
    expect(get(EN, 'remittances.admin.commissionOverride.disabledReason')).not.toMatch(/delivery/i);
  });

  it('keeps the neutral saved message (used when no proposal was created)', () => {
    expect(get(ES, 'remittances.admin.commissionOverride.saved')).toBeTruthy();
    expect(get(EN, 'remittances.admin.commissionOverride.saved')).toBeTruthy();
  });

  it('the stale "once validated, only lower it" copy of the modal was corrected', () => {
    expect(get(ES, 'remittances.admin.commissionOverride.errorInvalidStatus')).not.toMatch(/solo bajarla/);
    expect(get(EN, 'remittances.admin.commissionOverride.errorInvalidStatus')).not.toMatch(/only lower/i);
  });
});
