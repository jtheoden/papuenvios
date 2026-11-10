import { describe, it, expect } from 'vitest';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';

const REQUIRED = [
  'commission', 'adjustedNote', 'adjustButton', 'modalTitle', 'modalIntro', 'standardCommission', 'currentCommission',
  'newCommission', 'reason', 'reasonHelp', 'differenceHigher', 'differenceLower', 'differenceNone', 'deliverNow',
  'deliverAfter', 'higherWarning', 'confirm', 'saving', 'cancel', 'errorCommissionRange', 'errorReasonLength',
  'saveError', 'saved', 'errorInvalidStatus',
];

describe('remittances.admin.commissionOverride translations', () => {
  const es = ES.remittances?.admin?.commissionOverride;
  const en = EN.remittances?.admin?.commissionOverride;

  it('exists in both languages with the same keys', () => {
    expect(es).toBeDefined();
    expect(en).toBeDefined();
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
  });

  it('has the simulator warning shown when a simulation cannot be computed', () => {
    expect(ES.remittances.admin.simulator.calculationUnavailable.trim()).not.toBe('');
    expect(EN.remittances.admin.simulator.calculationUnavailable.trim()).not.toBe('');
  });

  it('has every key the UI uses, non-empty, and the same {placeholders} in both languages', () => {
    const placeholders = (s) => (s.match(/\{\w+\}/g) || []).sort();
    REQUIRED.forEach((key) => {
      expect(typeof es[key], key).toBe('string');
      expect(es[key].trim(), key).not.toBe('');
      expect(en[key].trim(), key).not.toBe('');
      expect(placeholders(es[key]), key).toEqual(placeholders(en[key]));
    });
  });
});
