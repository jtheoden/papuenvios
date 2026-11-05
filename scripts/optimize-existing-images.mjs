#!/usr/bin/env node
/**
 * Optimize the images already stored in the PUBLIC buckets (product-images, incl. its carousel/ and
 * migrated/carousel_slides/ folders, and publications) without ever touching the originals.
 *
 *   node scripts/optimize-existing-images.mjs                 # --dry-run (default): metadata only
 *   node scripts/optimize-existing-images.mjs --apply --confirm-production --i-checked-egress-budget \
 *        [--bucket=product-images] [--limit=20] [--min-kb=100]
 *
 * Dry-run: lists objects with their stored metadata.size (NO object is downloaded: zero egress for
 *   images) and estimates the WebP weight with --ratio (default 0.6). Prints a table per bucket, the
 *   10 heaviest objects and how many rows reference each one. Proof buckets (legal evidence) are only
 *   weighed, never processed.
 * Apply (UPLOAD stage, additive and resumable):
 *   - prints the egress it will spend (sum of the originals it downloads) before doing anything;
 *   - downloads each original, resizes to <= 1200 px, WebP q80; skipped when the result is >= 90 % of
 *     the original;
 *   - uploads a NEW object `<original-without-ext>.opt.<hash8>.webp` (cacheControl 1 year, upsert false).
 *     Originals are never overwritten nor deleted. Re-running skips what already exists (idempotent);
 *   - writes scripts/out/manifest-<date>.json BEFORE each upload and verifies each new URL with a HEAD
 *     (200 + expected Content-Length);
 *   - never writes to the database: it writes scripts/out/update-urls-<date>.sql and
 *     rollback-urls-<date>.sql (PREPARE/EXECUTE, each UPDATE guarded by the current URL) for review.
 *
 * Credentials: environment only (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY). No .env file is read and
 * the key is never printed. Encoder: `sharp`, loaded only by --apply (not a project dependency).
 * Runbook: .claude/docs/runbook_optimizar-imagenes-existentes.md
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PUBLIC_BUCKETS = ['product-images', 'publications'];
export const PROOF_BUCKETS = ['order-documents', 'remittance-proofs', 'order-delivery-proofs', 'remittance-delivery-proofs'];
export const MAX_SIDE = 1200;
export const WEBP_QUALITY = 80;
export const SKIP_IF_AT_LEAST = 0.9; // a result >= 90 % of the original is not worth a new object
export const DEFAULT_RATIO = 0.6;
export const LONG_CACHE_CONTROL = '31536000';
export const OPTIMIZABLE_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
export const REF_COLUMNS = [
  { table: 'products', column: 'image_url' },
  { table: 'combo_products', column: 'image_url' },
  { table: 'carousel_slides', column: 'image_url' },
  { table: 'product_categories', column: 'image_url' },
  { table: 'publications', column: 'cover_image_url' }
];

const MB = 1024 * 1024;

export const parseArgs = (argv) => {
  const opts = { apply: false, confirmProduction: false, checkedEgress: false, bucket: null, limit: Infinity, minKb: 0, ratio: DEFAULT_RATIO, outDir: 'scripts/out' };
  for (const arg of argv) {
    const [key, value] = arg.split('=');
    if (key === '--apply') opts.apply = true;
    else if (key === '--dry-run') opts.apply = false;
    else if (key === '--confirm-production') opts.confirmProduction = true;
    else if (key === '--i-checked-egress-budget') opts.checkedEgress = true;
    else if (key === '--bucket') opts.bucket = value;
    else if (key === '--limit') opts.limit = Number(value);
    else if (key === '--min-kb') opts.minKb = Number(value);
    else if (key === '--ratio') opts.ratio = Number(value);
    else if (key === '--out-dir') opts.outDir = value;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (opts.bucket && !PUBLIC_BUCKETS.includes(opts.bucket)) throw new Error(`--bucket must be one of ${PUBLIC_BUCKETS.join(', ')} (proof buckets are never processed)`);
  if (!(opts.limit > 0)) throw new Error('--limit must be a positive number');
  if (!(opts.ratio > 0 && opts.ratio <= 1)) throw new Error('--ratio must be in (0, 1]');
  if (!(opts.minKb >= 0)) throw new Error('--min-kb must be >= 0');
  return opts;
};

/** Runs before any client exists: apply without both explicit flags aborts. */
export const assertApplyAllowed = (opts) => {
  if (!opts.apply) return;
  if (!opts.confirmProduction) throw new Error('--apply writes to PRODUCTION Storage: add --confirm-production');
  if (!opts.checkedEgress) throw new Error('--apply downloads the originals (egress): check the budget, then add --i-checked-egress-budget');
};

export const fitWithin = (width, height, max = MAX_SIDE) => {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
};

export const isWorthUploading = (originalBytes, newBytes) => newBytes < originalBytes * SKIP_IF_AT_LEAST;

const OPT_SUFFIX = /\.opt\.[0-9a-f]{8}\.webp$/;
export const isOptimizedPath = (path) => OPT_SUFFIX.test(path);

/** Deterministic from metadata (no download needed to know whether it was already uploaded). */
export const optimizedPath = (path, etag = '') => {
  const hash8 = createHash('sha256').update(`${path}|${etag}`).digest('hex').slice(0, 8);
  return `${path.replace(/\.[^./]*$/, '')}.opt.${hash8}.webp`;
};

export const isCandidate = (object, minKb) =>
  !isOptimizedPath(object.path) && OPTIMIZABLE_MIME.has(object.mimetype) && object.size >= minKb * 1024;

/** objects: [{bucket, path, size, mimetype, etag}] ; refs: Map(url -> [{table, column, id}]) */
export const summarize = (objects, { ratio, minKb, publicUrl, refs }) => {
  const byBucket = new Map();
  for (const o of objects) {
    const row = byBucket.get(o.bucket) || { bucket: o.bucket, count: 0, bytes: 0, candidates: 0, estimatedBytes: 0 };
    const proof = PROOF_BUCKETS.includes(o.bucket);
    row.count += 1;
    row.bytes += o.size;
    if (!proof && isCandidate(o, minKb)) {
      row.candidates += 1;
      row.estimatedBytes += Math.round(o.size * ratio);
    } else {
      row.estimatedBytes += o.size;
    }
    byBucket.set(o.bucket, row);
  }
  const rows = [...byBucket.values()].map((r) => ({ ...r, savingPct: r.bytes ? Math.round((1 - r.estimatedBytes / r.bytes) * 100) : 0 }));
  const top = objects
    .filter((o) => !PROOF_BUCKETS.includes(o.bucket))
    .sort((a, b) => b.size - a.size)
    .slice(0, 10)
    .map((o) => ({ ...o, refs: (refs.get(publicUrl(o.bucket, o.path)) || []).length }));
  return { rows, top };
};

export const sqlLiteral = (value) => `'${String(value).replace(/'/g, "''")}'`;

const SQL_TARGETS = REF_COLUMNS.map(({ table, column }) => ({ table, column, stmt: `pe_${table}` }));

const buildSql = (entries, refs, { forward }) => {
  const lines = ['-- Generated by scripts/optimize-existing-images.mjs. Review before running. Each UPDATE only applies', '-- when the row still has the URL it had when this file was generated.', 'BEGIN;'];
  for (const { table, column, stmt } of SQL_TARGETS) {
    lines.push(`PREPARE ${stmt}(text, text, text) AS UPDATE public.${table} SET ${column} = $2 WHERE id::text = $1 AND ${column} = $3;`);
  }
  let count = 0;
  for (const entry of entries.filter((e) => e.status === 'verified')) {
    for (const ref of refs.get(entry.url_original) || []) {
      const target = SQL_TARGETS.find((t) => t.table === ref.table && t.column === ref.column);
      const [to, from] = forward ? [entry.url_nueva, entry.url_original] : [entry.url_original, entry.url_nueva];
      lines.push(`EXECUTE ${target.stmt}(${sqlLiteral(ref.id)}, ${sqlLiteral(to)}, ${sqlLiteral(from)});`);
      count += 1;
    }
  }
  for (const { stmt } of SQL_TARGETS) lines.push(`DEALLOCATE ${stmt};`);
  lines.push('COMMIT;', `-- ${count} row update(s)`);
  return { sql: `${lines.join('\n')}\n`, count };
};

export const buildUpdateSql = (entries, refs) => buildSql(entries, refs, { forward: true });
export const buildRollbackSql = (entries, refs) => buildSql(entries, refs, { forward: false });

const listRecursive = async (storage, bucket, prefix = '') => {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const items = await storage.list(bucket, prefix, offset);
    for (const item of items) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null || !item.metadata) out.push(...await listRecursive(storage, bucket, path));
      else out.push({ bucket, path, size: Number(item.metadata.size) || 0, mimetype: item.metadata.mimetype, etag: item.metadata.eTag || '' });
    }
    if (items.length < 1000) return out;
  }
};

const loadRefs = async (db) => {
  const refs = new Map();
  for (const { table, column } of REF_COLUMNS) {
    for (const row of await db.select(table, column)) {
      const url = row[column];
      if (!url) continue;
      if (!refs.has(url)) refs.set(url, []);
      refs.get(url).push({ table, column, id: row.id });
    }
  }
  return refs;
};

const fmtMb = (bytes) => (bytes / MB).toFixed(2);

export const run = async (opts, deps) => {
  assertApplyAllowed(opts);
  const { storage, db, head, encode, log, now = () => new Date() } = deps;
  const buckets = opts.bucket ? [opts.bucket] : PUBLIC_BUCKETS;
  const objects = [];
  for (const bucket of [...buckets, ...(opts.apply ? [] : PROOF_BUCKETS)]) objects.push(...await listRecursive(storage, bucket));
  const refs = await loadRefs(db);
  const publicUrl = (bucket, path) => storage.publicUrl(bucket, path);

  const { rows, top } = summarize(objects, { ratio: opts.ratio, minKb: opts.minKb, publicUrl, refs });
  log(`\nratio=${opts.ratio} (estimate only, nothing downloaded) min-kb=${opts.minKb}`);
  log('bucket | objects | MB before | MB after (est.) | saving % | candidates');
  for (const r of rows) {
    const proof = PROOF_BUCKETS.includes(r.bucket) ? ' (proofs: reported only, never processed)' : '';
    log(`${r.bucket} | ${r.count} | ${fmtMb(r.bytes)} | ${fmtMb(r.estimatedBytes)} | ${r.savingPct} | ${r.candidates}${proof}`);
  }
  log('\n10 heaviest public objects (kB, rows referencing it):');
  for (const o of top) log(`  ${o.bucket}/${o.path}  ${Math.round(o.size / 1024)} kB  refs=${o.refs}`);

  const existing = new Map(objects.map((o) => [`${o.bucket}/${o.path}`, o]));
  const candidates = objects
    .filter((o) => buckets.includes(o.bucket) && isCandidate(o, opts.minKb))
    .sort((a, b) => b.size - a.size);
  const pending = candidates.filter((o) => !existing.has(`${o.bucket}/${optimizedPath(o.path, o.etag)}`)).slice(0, opts.limit);
  const egressBytes = pending.reduce((sum, o) => sum + o.size, 0);
  log(`\nApply would download ${pending.length} original(s): ~${fmtMb(egressBytes)} MB of egress (${candidates.length - pending.length} already optimized are skipped).`);
  if (!opts.apply) return { mode: 'dry-run', rows, top, pending: pending.length, egressBytes };

  for (const bucket of buckets) {
    const mimes = await storage.allowedMimeTypes(bucket);
    if (mimes && !mimes.includes('image/webp')) throw new Error(`Bucket ${bucket} does not accept image/webp yet: apply migration 20261105100000_product_images_allow_webp.sql first`);
  }

  const stamp = now().toISOString().slice(0, 10);
  await mkdir(opts.outDir, { recursive: true });
  const manifestPath = join(opts.outDir, `manifest-${stamp}.json`);
  const entries = [];
  const saveManifest = () => writeFile(manifestPath, `${JSON.stringify(entries, null, 2)}\n`);

  const verify = async (entry) => {
    const res = await head(entry.url_nueva);
    entry.status = res.status === 200 && Number(res.contentLength) === entry.bytes_nuevo ? 'verified' : 'unverified';
  };

  // Already uploaded by a previous run: re-verify so the SQL covers them too.
  for (const o of candidates) {
    const done = existing.get(`${o.bucket}/${optimizedPath(o.path, o.etag)}`);
    if (!done) continue;
    const entry = { bucket: o.bucket, ruta_original: o.path, url_original: publicUrl(o.bucket, o.path), bytes_original: o.size, ruta_nueva: done.path, url_nueva: publicUrl(o.bucket, done.path), bytes_nuevo: done.size, status: 'pending' };
    await verify(entry);
    entries.push(entry);
  }

  for (const o of pending) {
    const entry = { bucket: o.bucket, ruta_original: o.path, url_original: publicUrl(o.bucket, o.path), bytes_original: o.size, ruta_nueva: optimizedPath(o.path, o.etag), url_nueva: null, bytes_nuevo: null, status: 'pending' };
    entries.push(entry);
    try {
      const original = await storage.download(o.bucket, o.path);
      const webp = await encode(original, { maxSide: MAX_SIDE, quality: WEBP_QUALITY });
      if (!isWorthUploading(o.size, webp.length)) {
        Object.assign(entry, { status: 'skipped_not_lighter', bytes_nuevo: webp.length, ruta_nueva: null });
        await saveManifest();
        continue;
      }
      Object.assign(entry, { url_nueva: publicUrl(o.bucket, entry.ruta_nueva), bytes_nuevo: webp.length });
      await saveManifest(); // backup line written BEFORE the upload
      await storage.upload(o.bucket, entry.ruta_nueva, webp, { contentType: 'image/webp', cacheControl: LONG_CACHE_CONTROL, upsert: false });
      await verify(entry);
    } catch (error) {
      entry.status = 'error';
      entry.error = String(error?.message || error).slice(0, 200);
    }
    await saveManifest();
    log(`  ${entry.status}  ${o.bucket}/${o.path}  ${Math.round(o.size / 1024)} kB -> ${entry.bytes_nuevo ? Math.round(entry.bytes_nuevo / 1024) : '-'} kB`);
  }

  const update = buildUpdateSql(entries, refs);
  const rollback = buildRollbackSql(entries, refs);
  await writeFile(join(opts.outDir, `update-urls-${stamp}.sql`), update.sql);
  await writeFile(join(opts.outDir, `rollback-urls-${stamp}.sql`), rollback.sql);
  const counts = entries.reduce((acc, e) => ({ ...acc, [e.status]: (acc[e.status] || 0) + 1 }), {});
  log(`\nManifest: ${manifestPath}  ${JSON.stringify(counts)}  SQL row updates: ${update.count}`);
  return { mode: 'apply', entries, counts, sqlUpdates: update.count };
};

/* c8 ignore start -- production wiring, exercised by the runbook, not by unit tests */
const productionDeps = async () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment (no .env file is read)');
  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    storage: {
      list: async (bucket, prefix, offset) => {
        const { data, error } = await client.storage.from(bucket).list(prefix, { limit: 1000, offset });
        if (error) throw error;
        return data;
      },
      download: async (bucket, path) => {
        const { data, error } = await client.storage.from(bucket).download(path);
        if (error) throw error;
        return Buffer.from(await data.arrayBuffer());
      },
      upload: async (bucket, path, body, options) => {
        const { error } = await client.storage.from(bucket).upload(path, body, options);
        if (error) throw error;
      },
      publicUrl: (bucket, path) => client.storage.from(bucket).getPublicUrl(path).data.publicUrl,
      allowedMimeTypes: async (bucket) => {
        const { data, error } = await client.storage.getBucket(bucket);
        if (error) throw error;
        return data.allowed_mime_types;
      }
    },
    db: {
      select: async (table, column) => {
        const { data, error } = await client.from(table).select(`id, ${column}`);
        if (error) throw error;
        return data;
      }
    },
    head: async (target) => {
      const res = await fetch(target, { method: 'HEAD' });
      return { status: res.status, contentLength: res.headers.get('content-length') };
    },
    encode: async (buffer, { maxSide, quality }) => {
      let sharp;
      try {
        ({ default: sharp } = await import('sharp'));
      } catch {
        throw new Error('sharp is not installed: run `npm install --no-save sharp` (not a project dependency)');
      }
      return sharp(buffer).rotate().resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true }).webp({ quality }).toBuffer();
    },
    log: (line) => process.stdout.write(`${line}\n`)
  };
};

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    assertApplyAllowed(opts); // before any client is created
    await run(opts, await productionDeps());
  } catch (error) {
    process.stderr.write(`ERROR: ${error.message}\n`);
    process.exit(1);
  }
}
/* c8 ignore stop */
