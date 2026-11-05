// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseArgs,
  assertApplyAllowed,
  fitWithin,
  isWorthUploading,
  optimizedPath,
  isOptimizedPath,
  buildUpdateSql,
  buildRollbackSql,
  run
} from '../../../scripts/optimize-existing-images.mjs';

const BASE = 'https://proj.supabase.co/storage/v1/object/public';
const url = (bucket, path) => `${BASE}/${bucket}/${path}`;

describe('pure rules', () => {
  it('fits the longest side to 1200 px and never upscales', () => {
    expect(fitWithin(3000, 1500)).toEqual({ width: 1200, height: 600 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('skips results that are >= 90 % of the original', () => {
    expect(isWorthUploading(100_000, 89_999)).toBe(true);
    expect(isWorthUploading(100_000, 90_000)).toBe(false);
    expect(isWorthUploading(100_000, 120_000)).toBe(false);
  });

  it('new object name is unique, deterministic from metadata and recognisable', () => {
    const a = optimizedPath('migrated/products/x.jpg', 'e1');
    expect(a).toMatch(/^migrated\/products\/x\.opt\.[0-9a-f]{8}\.webp$/);
    expect(optimizedPath('migrated/products/x.jpg', 'e1')).toBe(a);
    expect(optimizedPath('migrated/products/x.jpg', 'e2')).not.toBe(a);
    expect(isOptimizedPath(a)).toBe(true);
    expect(isOptimizedPath('migrated/products/x.jpg')).toBe(false);
  });

  it('proof buckets can never be selected', () => {
    expect(() => parseArgs(['--bucket=order-documents'])).toThrow(/never processed/);
  });
});

describe('apply guard (aborts before any client exists)', () => {
  it('dry-run is the default and needs no flag', () => {
    expect(parseArgs([]).apply).toBe(false);
    expect(() => assertApplyAllowed(parseArgs([]))).not.toThrow();
  });

  it('--apply without --confirm-production or without --i-checked-egress-budget aborts', () => {
    expect(() => assertApplyAllowed(parseArgs(['--apply', '--i-checked-egress-budget']))).toThrow(/--confirm-production/);
    expect(() => assertApplyAllowed(parseArgs(['--apply', '--confirm-production']))).toThrow(/--i-checked-egress-budget/);
    expect(() => assertApplyAllowed(parseArgs(['--apply', '--confirm-production', '--i-checked-egress-budget']))).not.toThrow();
  });

  it('run() refuses apply without the flags and touches nothing', async () => {
    const storage = { list: vi.fn() };
    await expect(run(parseArgs(['--apply']), { storage })).rejects.toThrow(/--confirm-production/);
    expect(storage.list).not.toHaveBeenCalled();
  });
});

describe('SQL generation', () => {
  const entries = [
    { status: 'verified', url_original: url('product-images', "a'b.jpg"), url_nueva: url('product-images', "a'b.opt.12345678.webp") },
    { status: 'unverified', url_original: url('product-images', 'c.jpg'), url_nueva: url('product-images', 'c.opt.87654321.webp') }
  ];
  const refs = new Map([
    [entries[0].url_original, [{ table: 'products', column: 'image_url', id: 'p1' }, { table: 'carousel_slides', column: 'image_url', id: 's1' }]],
    [entries[1].url_original, [{ table: 'products', column: 'image_url', id: 'p2' }]]
  ]);

  it('only verified URLs, prepared statements guarded by the current URL, quotes escaped', () => {
    const { sql, count } = buildUpdateSql(entries, refs);
    expect(count).toBe(2);
    expect(sql).toMatch(/PREPARE pe_products\(text, text, text\) AS UPDATE public\.products SET image_url = \$2 WHERE id::text = \$1 AND image_url = \$3;/);
    expect(sql).toContain(`EXECUTE pe_products('p1', '${BASE}/product-images/a''b.opt.12345678.webp', '${BASE}/product-images/a''b.jpg');`);
    expect(sql).toContain("EXECUTE pe_carousel_slides('s1',");
    expect(sql).not.toContain("'p2'");
    expect(sql.trim().startsWith('--')).toBe(true);
    expect(sql).toMatch(/BEGIN;[\s\S]*COMMIT;/);
  });

  it('rollback is the exact mirror (swaps new and original)', () => {
    const forward = buildUpdateSql(entries, refs).sql.split('\n').filter((l) => l.startsWith('EXECUTE'));
    const back = buildRollbackSql(entries, refs).sql.split('\n').filter((l) => l.startsWith('EXECUTE'));
    expect(back).toHaveLength(forward.length);
    back.forEach((line, i) => {
      const [, id, to, from] = forward[i].match(/^EXECUTE (\w+)\((.*?), ('.*?'), ('.*?')\);$/).slice(1);
      expect(line).toBe(`EXECUTE ${forward[i].match(/^EXECUTE (\w+)/)[1]}(${id}, ${from}, ${to});`);
    });
  });
});

describe('run', () => {
  let outDir;
  const realFetch = globalThis.fetch;

  const objects = {
    'product-images': [
      { name: 'migrated', id: null, metadata: null },
      { name: 'big.jpg', id: '1', metadata: { size: 400_000, mimetype: 'image/jpeg', eTag: 'e-big' } }
    ],
    'product-images/migrated': [
      { name: 'p1.jpg', id: '2', metadata: { size: 200_000, mimetype: 'image/jpeg', eTag: 'e-p1' } },
      { name: 'small.png', id: '3', metadata: { size: 50_000, mimetype: 'image/png', eTag: 'e-s' } }
    ],
    publications: [{ name: 'anim.gif', id: '4', metadata: { size: 300_000, mimetype: 'image/gif', eTag: 'e-g' } }],
    'order-documents': [{ name: 'proof.jpg', id: '5', metadata: { size: 2_900_000, mimetype: 'image/jpeg', eTag: 'e-pr' } }]
  };

  const makeDeps = ({ extra = {} } = {}) => {
    const uploaded = new Map();
    const listing = (bucket, prefix) => {
      const key = prefix ? `${bucket}/${prefix}` : bucket;
      const base = objects[key] || [];
      const added = [...uploaded.entries()]
        .filter(([k]) => k.startsWith(`${bucket}/`) && k.slice(bucket.length + 1).split('/').slice(0, -1).join('/') === prefix)
        .map(([k, size]) => ({ name: k.split('/').pop(), id: k, metadata: { size, mimetype: 'image/webp', eTag: 'n' } }));
      return [...base, ...added];
    };
    const deps = {
      storage: {
        list: vi.fn(async (bucket, prefix) => listing(bucket, prefix)),
        download: vi.fn(async () => Buffer.alloc(10)),
        upload: vi.fn(async (bucket, path, body) => { uploaded.set(`${bucket}/${path}`, body.length); }),
        publicUrl: (bucket, path) => url(bucket, path),
        allowedMimeTypes: vi.fn(async () => ['image/jpeg', 'image/webp'])
      },
      db: { select: vi.fn(async (table, column) => (table === 'products' ? [{ id: 'p1', [column]: url('product-images', 'migrated/p1.jpg') }] : [])) },
      head: vi.fn(async (target) => ({ status: 200, contentLength: uploaded.get(target.slice(BASE.length + 1)) })),
      encode: vi.fn(async (_buf, { maxSide }) => { expect(maxSide).toBe(1200); return Buffer.alloc(100_000); }),
      log: vi.fn(),
      now: () => new Date('2026-11-09T10:00:00Z'),
      ...extra
    };
    return { deps, uploaded };
  };

  beforeEach(async () => { outDir = await mkdtemp(join(tmpdir(), 'opt-img-')); });
  afterEach(async () => {
    globalThis.fetch = realFetch;
    await rm(outDir, { recursive: true, force: true });
  });

  it('dry-run never downloads an object (metadata only) and reports proofs without processing them', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('dry-run must not fetch'); });
    const { deps } = makeDeps();
    deps.storage.download = vi.fn(async () => { throw new Error('dry-run must not download'); });
    deps.head = vi.fn(async () => { throw new Error('dry-run must not HEAD'); });

    const result = await run(parseArgs(['--ratio=0.5', `--out-dir=${outDir}`]), deps);
    expect(result.mode).toBe('dry-run');
    expect(deps.storage.download).not.toHaveBeenCalled();
    expect(deps.head).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(deps.storage.upload).not.toHaveBeenCalled();

    const pi = result.rows.find((r) => r.bucket === 'product-images');
    expect(pi).toMatchObject({ count: 3, bytes: 650_000, candidates: 3, estimatedBytes: 325_000, savingPct: 50 });
    const proofs = result.rows.find((r) => r.bucket === 'order-documents');
    expect(proofs).toMatchObject({ count: 1, candidates: 0, savingPct: 0 });
    expect(result.top[0].path).toBe('big.jpg');
    expect(result.top.find((o) => o.path === 'migrated/p1.jpg').refs).toBe(1);
    expect(result.egressBytes).toBe(650_000);
  });

  it('apply uploads new objects only, verifies them, writes manifest + SQL, and is idempotent', async () => {
    const { deps, uploaded } = makeDeps();
    const opts = parseArgs(['--apply', '--confirm-production', '--i-checked-egress-budget', '--bucket=product-images', `--out-dir=${outDir}`]);
    const first = await run(opts, deps);

    // small.png encodes to 100 kB >= 90 % of 50 kB: skipped. Originals are never written.
    expect(first.counts).toEqual({ verified: 2, skipped_not_lighter: 1 });
    expect([...uploaded.keys()].every((k) => /\.opt\.[0-9a-f]{8}\.webp$/.test(k))).toBe(true);
    deps.storage.upload.mock.calls.forEach(([, , , options]) => expect(options).toEqual({ contentType: 'image/webp', cacheControl: '31536000', upsert: false }));

    const manifest = JSON.parse(await readFile(join(outDir, 'manifest-2026-11-09.json'), 'utf8'));
    expect(manifest[0]).toEqual(expect.objectContaining({ bucket: 'product-images', ruta_original: 'big.jpg', bytes_original: 400_000, bytes_nuevo: 100_000, status: 'verified' }));
    const update = await readFile(join(outDir, 'update-urls-2026-11-09.sql'), 'utf8');
    expect(update).toContain(`EXECUTE pe_products('p1', '${url('product-images', optimizedPath('migrated/p1.jpg', 'e-p1'))}', '${url('product-images', 'migrated/p1.jpg')}');`);
    expect(await readFile(join(outDir, 'rollback-urls-2026-11-09.sql'), 'utf8')).toContain(`EXECUTE pe_products('p1', '${url('product-images', 'migrated/p1.jpg')}', '${url('product-images', optimizedPath('migrated/p1.jpg', 'e-p1'))}');`);

    // Second run: nothing new to download or upload, and the SQL still covers the verified objects.
    deps.storage.download.mockClear();
    deps.storage.upload.mockClear();
    const second = await run(opts, deps);
    expect(deps.storage.download).toHaveBeenCalledTimes(1); // only small.png, which was never uploaded
    expect(deps.storage.upload).not.toHaveBeenCalled();
    expect(second.counts).toEqual({ verified: 2, skipped_not_lighter: 1 });
    expect(second.sqlUpdates).toBe(1);
  });

  it('marks an upload whose HEAD does not match as unverified and leaves it out of the SQL', async () => {
    const { deps } = makeDeps();
    deps.head = vi.fn(async () => ({ status: 200, contentLength: '1' }));
    const result = await run(parseArgs(['--apply', '--confirm-production', '--i-checked-egress-budget', '--bucket=product-images', `--out-dir=${outDir}`]), deps);
    expect(result.counts.unverified).toBe(2);
    expect(result.sqlUpdates).toBe(0);
  });

  it('refuses a bucket that does not accept image/webp yet', async () => {
    const { deps } = makeDeps();
    deps.storage.allowedMimeTypes = vi.fn(async () => ['image/jpeg', 'image/png']);
    await expect(run(parseArgs(['--apply', '--confirm-production', '--i-checked-egress-budget', '--bucket=product-images', `--out-dir=${outDir}`]), deps)).rejects.toThrow(/20261105100000/);
    expect(deps.storage.download).not.toHaveBeenCalled();
  });

  it('--limit processes the heaviest first, in batches', async () => {
    const { deps } = makeDeps();
    const result = await run(parseArgs(['--apply', '--confirm-production', '--i-checked-egress-budget', '--bucket=product-images', '--limit=1', `--out-dir=${outDir}`]), deps);
    expect(deps.storage.download).toHaveBeenCalledTimes(1);
    expect(deps.storage.download.mock.calls[0][1]).toBe('big.jpg');
    expect(result.counts).toEqual({ verified: 1 });
  });
});
