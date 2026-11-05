import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSource, isExempt, countOldPalette } from '../../../scripts/theme-codemod.mjs';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../scripts/theme-codemod.mjs');

describe('transformSource', () => {
  it('maps the exact rules of the table', () => {
    const input = [
      'bg-blue-600 hover:bg-blue-700 bg-blue-50 bg-blue-100 border-blue-200',
      'text-blue-600 text-blue-700 ring-blue-500 focus:border-blue-500',
      'bg-purple-600 from-blue-500 to-purple-600',
    ].join(' ');
    const { output } = transformSource(input);
    expect(output).toBe([
      'bg-theme-accent hover:bg-theme-accent-hover bg-theme-accent-soft bg-theme-accent-soft-2 border-theme-accent-line',
      'text-theme-link text-theme-link-strong ring-theme-focus focus:border-theme-focus',
      'bg-theme-accent-2 from-theme-grad-from to-theme-grad-to',
    ].join(' '));
  });

  it('keeps every variant chain and the alpha suffix', () => {
    const input = '"hover:bg-blue-600/30 focus-visible:ring-blue-500 disabled:bg-blue-600 group-hover:text-blue-600 md:hover:bg-blue-50/50 focus:ring-blue-500/20"';
    expect(transformSource(input).output).toBe(
      '"hover:bg-theme-accent/30 focus-visible:ring-theme-focus disabled:bg-theme-accent group-hover:text-theme-link md:hover:bg-theme-accent-soft/50 focus:ring-theme-focus/20"',
    );
  });

  it('only maps border-blue-500 when it is a focus state, otherwise lists it as unmapped', () => {
    const { output, unmapped } = transformSource('border-blue-500 focus-within:border-blue-500');
    expect(output).toBe('border-blue-500 focus-within:border-theme-focus');
    expect(unmapped).toEqual({ 'border-blue-500': 1 });
  });

  it('lists tones without a rule instead of guessing, with variants', () => {
    const { output, unmapped } = transformSource('text-purple-600 hover:bg-indigo-100 bg-sky-50 text-purple-600');
    expect(output).toBe('text-purple-600 hover:bg-indigo-100 bg-sky-50 text-purple-600');
    expect(unmapped).toEqual({ 'text-purple-600': 2, 'hover:bg-indigo-100': 1, 'bg-sky-50': 1 });
  });

  it('does not match inside longer words or other colours', () => {
    const input = 'xbg-blue-600 bg-blue-6000 bg-blue-600x bg-gray-600 text-blue-600-foo';
    const { output, counts, unmapped } = transformSource(input);
    expect(output).toBe(input);
    expect(counts).toEqual({});
    expect(unmapped).toEqual({});
  });

  it('is idempotent', () => {
    const once = transformSource('bg-blue-600 hover:bg-blue-700 text-purple-600').output;
    const twice = transformSource(once);
    expect(twice.output).toBe(once);
    expect(twice.counts).toEqual({});
  });

  it('reports the count per rule', () => {
    const { counts } = transformSource('bg-blue-600 bg-blue-600 hover:bg-blue-700');
    expect(counts).toEqual({ 'bg-blue-600': 2, 'bg-blue-700': 1 });
  });

  it('leaves order and remittance status maps alone', () => {
    const input = [
      "  payment_validated: 'bg-blue-100 text-blue-800',",
      "  [REMITTANCE_STATUS.PROCESSING]: 'text-purple-600',",
      '  <div className="bg-blue-600">',
    ].join('\n');
    const { output, counts, skippedStatusLines } = transformSource(input);
    expect(output).toBe([
      "  payment_validated: 'bg-blue-100 text-blue-800',",
      "  [REMITTANCE_STATUS.PROCESSING]: 'text-purple-600',",
      '  <div className="bg-theme-accent">',
    ].join('\n'));
    expect(counts).toEqual({ 'bg-blue-600': 1 });
    expect(skippedStatusLines).toBe(2);
  });
});

describe('countOldPalette', () => {
  it('counts old palette classes, with variants and alpha, ignoring status map lines', () => {
    const source = [
      'className="bg-blue-600 hover:text-indigo-700 border-purple-200/50 text-gray-900"',
      "processing: 'bg-purple-100',",
      'className="ring-sky-500 from-cyan-400 via-violet-500"',
    ].join('\n');
    expect(countOldPalette(source)).toBe(6);
  });

  it('does not count the theme tokens', () => {
    expect(countOldPalette('bg-theme-accent text-theme-link')).toBe(0);
  });
});

describe('isExempt', () => {
  it.each([
    'src/tests/unit/x.test.jsx',
    'src/components/ui/StatusBadge.jsx',
    'src/components/ui/RemittanceTimeline.jsx',
    'src/lib/headerTheme.js',
    'src/lib/brandPalette.js',
    'src/lib/colorTokens.js',
    'src/lib/styleUtils.js',
    'src/components/settings/SettingsPageVisual.jsx',
  ])('exempts %s', (file) => expect(isExempt(file)).toBe(true));

  it.each(['src/components/CartPage.jsx', 'src/components/ui/button.jsx', 'src/lib/orderService.js'])('does not exempt %s', (file) => expect(isExempt(file)).toBe(false));
});

describe('CLI', () => {
  let dir;
  const file = () => path.join(dir, 'src/components/A.jsx');
  const run = (...args) => spawnSync('node', [SCRIPT, ...args], { cwd: dir, encoding: 'utf8' });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codemod-'));
    fs.mkdirSync(path.join(dir, 'src/components'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src/tests'), { recursive: true });
    fs.writeFileSync(file(), '<b className="bg-blue-600 text-purple-600" />');
    fs.writeFileSync(path.join(dir, 'src/tests/t.jsx'), '<b className="bg-blue-600" />');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('--dry-run reports per file and rule and writes nothing', () => {
    const result = run('--dry-run');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('src/components/A.jsx');
    expect(result.stdout).toMatch(/bg-blue-600\s*->\s*bg-theme-accent\s*x1/);
    expect(result.stdout).toContain('text-purple-600');
    expect(result.stdout).not.toContain('src/tests/t.jsx');
    expect(fs.readFileSync(file(), 'utf8')).toContain('bg-blue-600');
  });

  it('--check exits 1 while some rule still applies, 0 when none does, and never writes', () => {
    expect(run('--check').status).toBe(1);
    expect(fs.readFileSync(file(), 'utf8')).toBe('<b className="bg-blue-600 text-purple-600" />');
    fs.writeFileSync(file(), '<b className="text-purple-600" />');
    expect(run('--check').status).toBe(0);
  });

  describe.each([['no flag', []], ['--write', ['--write']]])('write mode (%s) is disabled until the known limitations are fixed', (_label, args) => {
    it('fails with a clear message listing the limitations and writes nothing', () => {
      const result = run(...args);
      expect(result.status).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('write mode is disabled');
      // multi-line status maps are exempted per line only
      for (const where of ['AdminRemittancesTab.jsx:608-621', 'UserTableConfig.jsx:187-189', 'ProgressBar.jsx:28-30', 'CategoryBadge.jsx:24']) expect(result.stderr).toContain(where);
      // text-white next to bg-theme-accent is not paired with on-accent
      expect(result.stderr).toContain('text-white');
      expect(result.stderr).toContain('text-theme-on-accent');
      expect(result.stderr).toContain('1.97:1');
      expect(fs.readFileSync(file(), 'utf8')).toBe('<b className="bg-blue-600 text-purple-600" />');
    });

    it('also refuses together with --files', () => {
      expect(run(...args, '--files', 'src/components/A.jsx').status).toBe(2);
    });
  });

  it('--write is refused even when combined with --dry-run', () => {
    expect(run('--write', '--dry-run').status).toBe(2);
  });

  it('--files limits the run to the given files', () => {
    fs.writeFileSync(path.join(dir, 'src/components/B.jsx'), '<b className="bg-blue-600" />');
    const result = run('--dry-run', '--files', 'src/components/B.jsx');
    expect(result.stdout).toContain('src/components/B.jsx');
    expect(result.stdout).not.toContain('src/components/A.jsx');
  });
});
