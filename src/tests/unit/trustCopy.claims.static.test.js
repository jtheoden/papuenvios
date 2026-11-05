import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import ES from '@/translations/ES.json';
import EN from '@/translations/EN.json';

// Customer copy must only promise what can be verified: no "best rates", no fixed delivery window,
// no "fast, secure and reliable" / "your remittances are protected", and no "we notify you at every
// step" (the customer notification helpers only build a message string; nothing is sent).
const FORBIDDEN = [
  /mejores tasas/i,
  /excelentes tasas/i,
  /best (exchange )?rates/i,
  /excellent rates/i,
  /precios competitivos/i,
  /competitive prices/i,
  /r[aá]pida,? (y )?segura/i,
  /segur[oa] y confiable/i,
  /quickly and securely/i,
  /quickly, safely and reliably/i,
  /remesas est[aá]n protegidas/i,
  /remittances are protected/i,
  /24\s*-\s*72/,
  /pr[oó]ximas horas/i,
  /in the next hours/i,
  /le avisamos/i,
  /le avisaremos/i,
  /le confirmamos cada paso/i,
  /we confirm every step/i,
  /keep you updated/i,
  /notify you at every step/i,
];

// Temporary exemptions, listed one by one. They are REMOVED by the Home/Hero branch, which rewrites the
// Home hero and feature cards (keys below and the code default of the cards); delete each entry there.
const ALLOWED_KEYS = new Set(['home.hero.subtitle', 'home.features.remittances.description']);
const ALLOWED_FILES = new Set(['src/lib/businessVisualSettingsService.js']); // DEFAULT_VISUAL_SETTINGS.homeFeatures

const flatten = (node, prefix = '') =>
  Object.entries(node).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === 'object' ? flatten(value, path) : [[path, String(value)]];
  });

const SKIP_DIRS = new Set(['tests', 'translations']);
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : walk(full);
    return /\.(js|jsx)$/.test(entry.name) ? [full] : [];
  });

const violations = (pairs) =>
  pairs.filter(([key, text]) => !ALLOWED_KEYS.has(key) && FORBIDDEN.some((re) => re.test(text)));

describe('customer copy makes no unverifiable claims', () => {
  it.each([['ES', ES], ['EN', EN]])('%s.json has none of the forbidden phrases', (_name, dict) => {
    expect(violations(flatten(dict))).toEqual([]);
  });

  it('no source file under src/ (components, lib, ...) hard-codes a forbidden phrase', () => {
    const files = walk(join(process.cwd(), 'src')).map((file) => relative(process.cwd(), file));
    expect(files).toContain('src/lib/whatsappService.js');
    const hits = files
      .filter((file) => !ALLOWED_FILES.has(file))
      .flatMap((file) => {
        const source = readFileSync(file, 'utf8');
        return FORBIDDEN.filter((re) => re.test(source)).map((re) => `${file}: ${re}`);
      });
    expect(hits).toEqual([]);
  });

  it('keeps the temporary exemptions explicit and still needed', () => {
    expect([...ALLOWED_KEYS]).toEqual(['home.hero.subtitle', 'home.features.remittances.description']);
    const allowedHits = flatten(ES).filter(([key, text]) => ALLOWED_KEYS.has(key) && FORBIDDEN.some((re) => re.test(text)));
    expect(allowedHits.length).toBeGreaterThan(0);
  });
});
