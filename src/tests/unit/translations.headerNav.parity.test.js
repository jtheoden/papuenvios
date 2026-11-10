import { describe, it, expect } from 'vitest';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';

const KEYS = ['openMenu', 'closeMenu', 'userMenu', 'cart'];

describe('nav accessible-name translations', () => {
  it.each(KEYS)('has a non-empty nav.%s in ES and EN', (key) => {
    expect(ES.nav[key]?.trim()).toBeTruthy();
    expect(EN.nav[key]?.trim()).toBeTruthy();
  });
});
