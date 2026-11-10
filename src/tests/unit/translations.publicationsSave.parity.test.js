import { describe, it, expect } from 'vitest';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';

describe('translations parity: settings.content.pubSaveFailed', () => {
  const es = ES.settings.content.pubSaveFailed;
  const en = EN.settings.content.pubSaveFailed;
  it('exists in both languages with the {n} placeholder', () => {
    expect(es).toContain('{n}');
    expect(en).toContain('{n}');
  });
  it.each(['pubSaveFailedList', 'pubMissingOnServer'])('%s exists in both languages with {titles}', (key) => {
    expect(ES.settings.content[key]).toContain('{titles}');
    expect(EN.settings.content[key]).toContain('{titles}');
  });
  it('pubMissingOnServer is ambiguous-safe: mentions permission, not only deletion', () => {
    expect(ES.settings.content.pubMissingOnServer).toMatch(/permiso/);
    expect(EN.settings.content.pubMissingOnServer).toMatch(/permission/i);
  });
  it('does not expose raw database wording', () => {
    expect(es).not.toMatch(/row-level|policy|violates/i);
    expect(en).not.toMatch(/row-level|policy|violates/i);
  });
});
