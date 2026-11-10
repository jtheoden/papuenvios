import { describe, it, expect } from 'vitest';
import ES from '@/translations/ES.json';

// Customer copy addresses the visitor as «usted»: no informal forms anywhere in the consent banner.
const TUTEO = /(^|[^\p{L}])(tú|tu|tus|ti|te|puedes|tienes|aceptas|visitaste|iniciaste|decides)(?=$|[^\p{L}])/iu;

describe('cookie consent copy (ES) uses «usted»', () => {
  it.each(Object.entries(ES.cookieConsent))('cookieConsent.%s has no tuteo', (_key, text) => {
    expect(text).not.toMatch(TUTEO);
  });
});
