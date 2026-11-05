import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';

// Customer copy must only promise what can be verified: no "best rates", no fixed delivery window,
// no "fast, secure and reliable" / "your remittances are protected" without facts behind them.
const FORBIDDEN = [
  /mejores tasas/i,
  /excelentes tasas/i,
  /best (exchange )?rates/i,
  /excellent rates/i,
  /r[aá]pida,? (y )?segura/i,
  /segur[oa] y confiable/i,
  /quickly and securely/i,
  /quickly, safely and reliably/i,
  /remesas est[aá]n protegidas/i,
  /remittances are protected/i,
  /24\s*-\s*72/,
];

// Owned by the pending HomePage/Hero work (another branch): only "España" was removed there.
const ALLOWED_KEYS = new Set(['home.hero.subtitle', 'home.features.remittances.description']);

const flatten = (node, prefix = '') =>
  Object.entries(node).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === 'object' ? flatten(value, path) : [[path, String(value)]];
  });

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith('.jsx') ? [full] : [];
  });

const violations = (pairs) =>
  pairs.filter(([key, text]) => !ALLOWED_KEYS.has(key) && FORBIDDEN.some((re) => re.test(text)));

describe('customer copy makes no unverifiable claims', () => {
  it.each([['ES', ES], ['EN', EN]])('%s.json has none of the forbidden phrases', (_name, dict) => {
    expect(violations(flatten(dict))).toEqual([]);
  });

  it('no component hard-codes a forbidden phrase', () => {
    const files = walk(join(process.cwd(), 'src/components'));
    const hits = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return FORBIDDEN.filter((re) => re.test(source)).map((re) => `${file.replace(process.cwd(), '')}: ${re}`);
    });
    expect(hits).toEqual([]);
  });
});
