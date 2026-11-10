import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (relative) => readFileSync(resolve(process.cwd(), relative), 'utf8');

describe('self-hosted fonts (no third-party font requests)', () => {
  it('does not reference Google Fonts hosts in the stylesheet or index.html', () => {
    for (const file of ['src/index.css', 'index.html']) {
      expect(read(file)).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
    }
  });

  it('declares Inter weights 400, 500, 600 and 700 from the bundled @fontsource package', () => {
    const css = read('src/index.css');
    for (const weight of [400, 500, 600, 700]) {
      expect(css).toContain(`@fontsource/inter/files/inter-latin-${weight}-normal.woff2`);
    }
    expect(css).toMatch(/font-display:\s*swap/);
  });

  it('keeps @fontsource/inter as a declared dependency', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.dependencies['@fontsource/inter']).toBeDefined();
  });

  it('has the font files installed', () => {
    expect(existsSync(resolve(process.cwd(), 'node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2'))).toBe(true);
  });
});
