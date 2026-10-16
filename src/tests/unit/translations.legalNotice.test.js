import { describe, it, expect } from 'vitest';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';

const KEYS = ['title', 'notBank', 'zelleIrreversible', 'deliveryEstimates', 'ofac', 'seeTerms'];

describe('legal.notice translations', () => {
  it.each([
    ['ES', ES],
    ['EN', EN],
  ])('%s defines every notice key as a non-empty string', (_name, dict) => {
    KEYS.forEach((key) => {
      expect(typeof dict.legal.notice[key]).toBe('string');
      expect(dict.legal.notice[key].length).toBeGreaterThan(0);
    });
  });

  it('uses the short not-a-bank sentence', () => {
    expect(ES.legal.notice.notBank).toBe('PapuEnvios no es un banco.');
    expect(EN.legal.notice.notBank).toBe('PapuEnvios is not a bank.');
  });

  it('keeps the OFAC sentence minimal', () => {
    [ES, EN].forEach((dict) => {
      const text = dict.legal.notice.ofac;
      expect(text).toContain('OFAC');
      expect(text.toLowerCase()).not.toMatch(/responsab|responsib|límites|limits/);
    });
  });

  it('has matching key sets in ES and EN', () => {
    expect(Object.keys(ES.legal.notice).sort()).toEqual(Object.keys(EN.legal.notice).sort());
  });
});
