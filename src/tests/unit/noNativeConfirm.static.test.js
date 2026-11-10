import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';

// The native browser dialog is replaced by useConfirm(): no window.confirm / bare confirm( may come back.
const files = globSync('src/**/*.{js,jsx}').filter((f) => !f.includes('/tests/'));

describe('no native confirm() in src', () => {
  it('scans the source tree', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(files)('%s', (file) => {
    const source = readFileSync(file, 'utf8');
    expect(source).not.toMatch(/window\.confirm\s*\(/);
    // bare confirm( that is not a method call, an identifier suffix (onConfirm() etc.) or the awaited hook result
    expect(source.replace(/await confirm\(/g, '')).not.toMatch(/(^|[^.\w])confirm\s*\(/m);
  });
});
