import { describe, it, expect } from 'vitest';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';

describe('common.statusConflict (shown when another actor already moved the order or remittance)', () => {
  it('exists in both languages and is not the generic error', () => {
    expect(typeof ES.common.statusConflict).toBe('string');
    expect(typeof EN.common.statusConflict).toBe('string');
    expect(ES.common.statusConflict.length).toBeGreaterThan(20);
    expect(EN.common.statusConflict.length).toBeGreaterThan(20);
    expect(ES.common.statusConflict).not.toBe(ES.common.error);
    expect(EN.common.statusConflict).not.toBe(EN.common.error);
  });
});

describe.each(['statusNotAuthorized', 'statusUserDisabled'])('common.%s (mapped from the 42501 codes of the transition RPCs)', (key) => {
  it('exists in both languages and is not the generic error', () => {
    for (const dict of [ES, EN]) {
      expect(typeof dict.common[key]).toBe('string');
      expect(dict.common[key].length).toBeGreaterThan(15);
      expect(dict.common[key]).not.toBe(dict.common.error);
    }
    expect(ES.common[key]).not.toBe(EN.common[key]);
  });
});
