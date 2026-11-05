#!/usr/bin/env node
/**
 * Moves old-palette Tailwind classes (blue/indigo/purple/violet/sky/cyan) to the `theme-*` utilities backed by the
 * --t-* tokens in src/index.css. Only EXACT tone matches are rewritten, so the `classic` look keeps its pixels.
 * Tones without a rule are listed, never guessed.
 *
 *   node scripts/theme-codemod.mjs --dry-run                 report counts per file and rule, write nothing
 *   node scripts/theme-codemod.mjs --check                   dry run that exits 1 while some rule still applies
 *   node scripts/theme-codemod.mjs --write                   rewrite files: DISABLED for now (see WRITE_LIMITATIONS)
 *   node scripts/theme-codemod.mjs --files src/a.jsx src/b.jsx   limit the run to these files
 *
 * Also imported by src/tests/unit/themeCompliance.test.js, which uses the same counter and exemptions for its ratchet.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const COLORS = 'blue|indigo|purple|violet|sky|cyan';
const SHADES = '50|100|200|300|400|500|600|700|800|900|950';
const UTILITIES = 'bg|text|border(?:-[trblxyse])?|ring-offset|ring|from|via|to|outline|divide|fill|stroke|decoration|shadow|accent|caret|placeholder';

// [utility, tone, token, only when the variant chain matches]. `text-*` uses the link tokens (never the accent: brand
// text is charcoal), everything else on the same tone uses the accent tokens.
const FOCUS = /(?:^|:)focus(?:-visible|-within)?:/;
const RULE_TABLE = [
  ['bg', 'blue-600', 'accent'],
  ['bg', 'blue-700', 'accent-hover'],
  ['bg', 'blue-50', 'accent-soft'],
  ['bg', 'blue-100', 'accent-soft-2'],
  ['border', 'blue-200', 'accent-line'],
  ['text', 'blue-600', 'link'],
  ['text', 'blue-700', 'link-strong'],
  ['ring', 'blue-500', 'focus'],
  ['border', 'blue-500', 'focus', FOCUS],
  ['bg', 'purple-600', 'accent-2'],
  ['bg', 'purple-50', 'accent-2-soft'],
  ['bg', 'purple-100', 'accent-2-soft-2'],
  ['from', 'blue-500', 'grad-from'],
  ['to', 'purple-600', 'grad-to'],
];

export const RULES = Object.fromEntries(
  RULE_TABLE.map(([utility, tone, token, variantGuard]) => [`${utility}-${tone}`, { to: `${utility}-theme-${token}`, variantGuard }]),
);

// (variants:)* utility-colour-shade (/alpha)?, never inside a longer word or class.
const CLASS_RE = new RegExp(`(?<![\\w-])((?:[a-z0-9-]+:)*)(${UTILITIES})-(${COLORS})-(${SHADES})(\\/(?:\\d+|\\[[^\\]]+\\]))?(?![\\w-])`, 'g');

// Order / remittance status colour maps keep their own palette: a status is not a brand surface.
const STATUS_LINE_RE = /\b(?:REMITTANCE_STATUS|ORDER_STATUS)\b|\borderStatus\.[a-z]|\b(?:pending|payment_[a-z_]+|processing|dispatched|in_transit|delivered|completed|confirmed|cancelled|canceled|rejected|shipped)\b['"]?\s*:\s*['"`{[]/i;

const EXEMPT_FILES = new Set([
  'src/components/ui/StatusBadge.jsx',
  'src/components/ui/RemittanceTimeline.jsx',
  'src/lib/brandPalette.js',
  'src/lib/colorTokens.js',
  'src/lib/styleUtils.js',
  // The Visual settings screens show the real palette to the admin.
  'src/components/settings/SettingsPageVisual.jsx',
  'src/components/VisualSettingsPanel.jsx',
]);

export const isExempt = (file) => {
  const normalized = file.split(path.sep).join('/');
  return normalized.startsWith('src/tests/') || EXEMPT_FILES.has(normalized) || /^src\/lib\/[^/]*Theme\.js$/.test(normalized);
};

const bump = (map, key) => {
  map[key] = (map[key] || 0) + 1;
};

/** Rewrites one source text. Pure: returns the new text and what it did. */
export const transformSource = (source) => {
  const counts = {};
  const unmapped = {};
  let skippedStatusLines = 0;
  const output = source
    .split('\n')
    .map((line) => {
      if (STATUS_LINE_RE.test(line)) {
        if (new RegExp(CLASS_RE.source).test(line)) skippedStatusLines += 1;
        return line;
      }
      return line.replace(CLASS_RE, (match, variants, utility, color, shade, alpha = '') => {
        const key = `${utility}-${color}-${shade}`;
        const rule = RULES[key];
        if (rule && (!rule.variantGuard || rule.variantGuard.test(variants))) {
          bump(counts, key);
          return `${variants}${rule.to}${alpha}`;
        }
        bump(unmapped, `${variants}${key}`);
        return match;
      });
    })
    .join('\n');
  return { output, counts, unmapped, skippedStatusLines };
};

/** Old-palette classes in a source text (mapped or not), ignoring status map lines and exempt files. */
export const countOldPalette = (source, file) => {
  if (file && isExempt(file)) return 0;
  return source
    .split('\n')
    .filter((line) => !STATUS_LINE_RE.test(line))
    .reduce((sum, line) => sum + (line.match(CLASS_RE)?.length ?? 0), 0);
};

/** .js/.jsx files under `dir`, as posix paths relative to `cwd`. */
export const listSourceFiles = (dir = 'src', cwd = process.cwd()) => {
  const walk = (current) =>
    fs.readdirSync(path.join(cwd, current), { withFileTypes: true }).flatMap((entry) => {
      const relative = `${current}/${entry.name}`;
      if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walk(relative);
      return /\.jsx?$/.test(entry.name) ? [relative] : [];
    });
  return walk(dir).sort();
};

/** Why write mode is off. Remove the guard in `main` only once both are fixed and tested. */
export const WRITE_LIMITATIONS = [
  'Status maps are exempted per LINE only. Multi-line order/remittance status maps are not detected and would be rewritten (e.g. AdminRemittancesTab.jsx:608-621, UserTableConfig.jsx:187-189, ProgressBar.jsx:28-30, CategoryBadge.jsx:24).',
  '`text-white` next to `bg-theme-accent` is not paired with `text-theme-on-accent` (about 40 lines): white text on the brand gold is 1.97:1, below AA.',
];

const parseArgs = (argv) => {
  const options = { dryRun: false, check: false, write: false, files: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--write') options.write = true;
    else if (argv[i] === '--dry-run') options.dryRun = true;
    else if (argv[i] === '--check') options.check = true;
    else if (argv[i] === '--files') {
      options.files = [];
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) options.files.push(argv[(i += 1)]);
    } else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return options;
};

const total = (map) => Object.values(map).reduce((sum, n) => sum + n, 0);

export const main = (argv, cwd = process.cwd()) => {
  const options = parseArgs(argv);
  if (options.write || (!options.dryRun && !options.check)) {
    console.error(`theme-codemod: write mode is disabled until the known limitations are fixed:\n${WRITE_LIMITATIONS.map((text, i) => `  ${i + 1}. ${text}`).join('\n')}\nUse --dry-run or --check.`);
    return 2;
  }
  const candidates = (options.files ?? listSourceFiles('src', cwd)).map((file) => file.split(path.sep).join('/'));
  const files = candidates.filter((file) => !isExempt(file));
  const write = false; // write mode is refused above; kept so the report wording and the guard removal stay local

  const perArea = {};
  const unmappedTotal = {};
  const unmappedFiles = {};
  let rewritten = 0;
  let skippedStatusLines = 0;
  let changedFiles = 0;

  for (const file of files) {
    const source = fs.readFileSync(path.join(cwd, file), 'utf8');
    const result = transformSource(source);
    skippedStatusLines += result.skippedStatusLines;
    for (const [token, n] of Object.entries(result.unmapped)) {
      unmappedTotal[token] = (unmappedTotal[token] || 0) + n;
      (unmappedFiles[token] ||= new Set()).add(file);
    }
    const fileTotal = total(result.counts);
    if (fileTotal === 0) continue;
    changedFiles += 1;
    rewritten += fileTotal;
    const area = path.posix.dirname(file);
    perArea[area] = (perArea[area] || 0) + fileTotal;
    console.log(file);
    for (const [key, n] of Object.entries(result.counts)) console.log(`  ${key} -> ${RULES[key].to} x${n}`);
    if (write) fs.writeFileSync(path.join(cwd, file), result.output);
  }

  console.log(`\n${write ? 'Rewrote' : 'Would rewrite'} ${rewritten} classes in ${changedFiles} files (${candidates.length - files.length} exempt files skipped, ${skippedStatusLines} status map lines left alone).`);
  if (rewritten > 0) {
    console.log('\nBy area:');
    for (const [area, n] of Object.entries(perArea).sort((a, b) => b[1] - a[1])) console.log(`  ${area}: ${n}`);
  }
  const unmappedList = Object.entries(unmappedTotal).sort((a, b) => b[1] - a[1]);
  if (unmappedList.length > 0) {
    console.log(`\nTones with no rule (${total(unmappedTotal)} classes, left untouched; decide each one):`);
    for (const [token, n] of unmappedList) console.log(`  ${token} x${n} (${unmappedFiles[token].size} files)`);
  }
  return options.check && rewritten > 0 ? 1 : 0;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
