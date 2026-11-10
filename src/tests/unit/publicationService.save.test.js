import { describe, it, expect, vi, beforeEach } from 'vitest';

// Chainable PostgREST stub: every builder method returns itself; awaiting/single() resolves to the outcome.
const { calls, outcome, removeSpy } = vi.hoisted(() => ({
  calls: [],
  outcome: { error: null, failOps: null, readFails: false, deleteZeroRows: false },
  removeSpy: vi.fn()
}));

vi.mock('@/lib/supabase', () => {
  const builder = (table, op, payload) => {
    calls.push({ table, op, payload });
    const fails = () => outcome.error && (!outcome.failOps || outcome.failOps.includes(`${op}:${payload?.title_es ?? ''}`));
    const res = () => (fails()
      ? { data: null, error: outcome.error }
      : { data: op === 'delete' ? (outcome.deleteZeroRows ? [] : [{ id: 'x' }]) : { id: `real_${payload?.title_es ?? 'x'}`, ...payload }, error: null });
    const b = {
      select: () => b,
      eq: () => b,
      single: () => Promise.resolve(res()),
      then: (ok, ko) => Promise.resolve(res()).then(ok, ko)
    };
    return b;
  };
  return {
    supabase: {
      from: (table) => ({
        select: () => ({ order: () => Promise.resolve(outcome.readFails ? { data: null, error: outcome.error } : { data: [], error: null }) }),
        insert: (p) => builder(table, 'insert', p),
        update: (p) => builder(table, 'update', p),
        delete: () => builder(table, 'delete')
      }),
      storage: { from: () => ({ remove: (...a) => { removeSpy(...a); return Promise.resolve({ error: null }); } }) }
    }
  };
});
vi.mock('@/lib/imageUtils', () => ({ processImage: vi.fn() }));

import { saveAllPublications, deletePublication, deletePublicationImage, mergeAfterPartialSave, applySaveResult, getAllPublications } from '@/lib/publicationService';

const base = { title_es: 'a', title_en: 'b', content_es: 'c', content_en: 'd', cover_image_url: '', video_url: '', category: 'general', is_active: true };

beforeEach(() => {
  calls.length = 0;
  outcome.error = null;
  outcome.failOps = null;
  outcome.readFails = false;
  outcome.deleteZeroRows = false;
  removeSpy.mockClear();
});

describe('saveAllPublications', () => {
  it('creates new rows without the temporary id and updates existing ones', async () => {
    const original = [{ id: 'p1', ...base }];
    const result = await saveAllPublications([{ id: 'p1', ...base }, { id: 'new_1', _isNew: true, ...base }], original);
    expect(result.success).toBe(true);
    expect(calls.map((c) => c.op)).toEqual(['update', 'insert']);
    expect(calls[1].payload.id).toBeUndefined();
    expect(calls[1].payload._isNew).toBeUndefined();
  });

  it('reports failure (does not swallow it) when the database rejects a write', async () => {
    outcome.error = { message: 'new row violates row-level security policy for table "publications"' };
    const result = await saveAllPublications([{ id: 'new_1', _isNew: true, ...base }], []);
    expect(result.success).toBe(false);
    expect(result.failedCount).toBe(1);
  });

  it('counts a failed delete in failedCount', async () => {
    outcome.error = { message: 'permission denied for table publications' };
    const result = await saveAllPublications([], [{ id: 'p1', ...base }]);
    expect(result.success).toBe(false);
    expect(result.failedCount).toBe(1);
  });
});

describe('saveAllPublications partial failures', () => {
  it('reports failed ids/titles', async () => {
    outcome.error = { message: 'rls' };
    outcome.failOps = ['update:Edited', 'insert:Broken'];
    const original = [{ id: 'p1', ...base, title_es: 'Edited' }];
    const result = await saveAllPublications([
      { id: 'p1', ...base, title_es: 'Edited' },
      { id: 'new_1', _isNew: true, ...base, title_es: 'Broken' },
      { id: 'new_2', _isNew: true, ...base, title_es: 'Fine' }
    ], original);
    expect(result.success).toBe(false);
    expect(result.failedCount).toBe(2);
    expect(result.failedIds).toEqual(['p1', 'new_1']);
    expect(result.failedTitles).toEqual(['Edited', 'Broken']);
    expect(Object.keys(result.created)).toEqual(['new_2']);
    expect(result.created.new_2.id).toBe('real_Fine');
  });
});

describe('saveAllPublications: deletes and vanished rows', () => {
  it('includes failed deletes in failedIds/failedTitles', async () => {
    outcome.error = { message: 'denied' };
    const result = await saveAllPublications([], [{ id: 'p1', ...base, title_es: 'Gone' }]);
    expect(result.failedIds).toEqual(['p1']);
    expect(result.failedTitles).toEqual(['Gone']);
  });

  it('flags an update whose row no longer exists on the server (PGRST116)', async () => {
    outcome.error = { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' };
    outcome.failOps = ['update:Edited'];
    const result = await saveAllPublications([{ id: 'p1', ...base, title_es: 'Edited' }], [{ id: 'p1', ...base }]);
    expect(result.missingIds).toEqual(['p1']);
    expect(result.failedIds).toEqual(['p1']);
  });
});

describe('getAllPublications', () => {
  it('returns null (not []) when the read fails so callers do not mistake it for an empty list', async () => {
    outcome.error = { message: 'boom' };
    outcome.readFails = true;
    expect(await getAllPublications()).toBeNull();
    outcome.readFails = false;
  });
});

describe('deletePublicationImage', () => {
  const std = 'https://x.supabase.co/storage/v1/object/public/publications/c%20one.jpg';
  it('extracts the storage path from the standard public url and strips the query', async () => {
    await deletePublicationImage(`${std}?t=123`);
    expect(removeSpy).toHaveBeenCalledWith(['c one.jpg']);
  });
  it.each([['https://cdn.example.com/a.jpg'], ['not a url'], ['https://x.supabase.co/storage/v1/object/public/other/a.jpg']])(
    'skips external or unparseable urls: %s', async (url) => {
      await deletePublicationImage(url);
      expect(removeSpy).not.toHaveBeenCalled();
    });
});

describe('RLS-filtered writes', () => {
  it('treats a delete that removed 0 rows as a failure and keeps the cover image', async () => {
    outcome.deleteZeroRows = true;
    const result = await deletePublication('p1', 'https://x/storage/v1/object/public/publications/c.jpg');
    expect(result.success).toBe(false);
    expect(removeSpy).not.toHaveBeenCalled();
  });
});

describe('cover image replaced or removed on an existing row', () => {
  const OLD = 'https://x/storage/v1/object/public/publications/old.jpg';
  it('deletes the old cover only after the update succeeds', async () => {
    await saveAllPublications([{ id: 'p1', ...base, cover_image_url: '' }], [{ id: 'p1', ...base, cover_image_url: OLD }]);
    expect(removeSpy).toHaveBeenCalledWith(['old.jpg']);
  });
  it('keeps the old cover when the update fails', async () => {
    outcome.error = { message: 'denied' };
    await saveAllPublications([{ id: 'p1', ...base, cover_image_url: '' }], [{ id: 'p1', ...base, cover_image_url: OLD }]);
    expect(removeSpy).not.toHaveBeenCalled();
  });
});

describe('applySaveResult', () => {
  const row = (id, title, extra = {}) => ({ id, ...base, title_es: title, ...extra });
  it('swaps created rows for their real ones, drops deleted originals and re-adds failed deletes', () => {
    const local = [row('p1', 'Typed'), row('new_2', 'Fine', { _isNew: true })];
    const original = [row('p1', 'Old'), row('p3', 'Deleted ok'), row('p4', 'Delete failed')];
    const result = { failedIds: ['p4'], created: { new_2: row('r2', 'Fine') } };
    const { publications, originals } = applySaveResult(local, original, result);
    expect(publications.map((p) => [p.id, p._isNew])).toEqual([['p1', undefined], ['r2', undefined], ['p4', undefined]]);
    expect(originals.map((p) => p.id).sort()).toEqual(['p1', 'p4', 'r2']);
    expect(originals.find((p) => p.id === 'p1').title_es).toBe('Typed');
  });
  it('keeps the old original for rows whose update failed', () => {
    const { originals } = applySaveResult([row('p1', 'Typed')], [row('p1', 'Old')], { failedIds: ['p1'], created: {} });
    expect(originals[0].title_es).toBe('Old');
  });
});

describe('deletePublication', () => {
  it('keeps the cover image when the row delete fails', async () => {
    outcome.error = { message: 'denied' };
    const result = await deletePublication('p1', 'https://x/storage/v1/object/public/publications/c.jpg');
    expect(result.success).toBe(false);
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it('removes the cover image after the row is deleted', async () => {
    await deletePublication('p1', 'https://x/storage/v1/object/public/publications/c.jpg');
    expect(removeSpy).toHaveBeenCalledWith(['c.jpg']);
  });
});

describe('mergeAfterPartialSave', () => {
  const row = (id, title, extra = {}) => ({ id, ...base, title_es: title, ...extra });
  it('puts back a failed existing row that is missing from the fresh read (vanished or read returned less)', () => {
    const merged = mergeAfterPartialSave([], [row('p1', 'Typed')], { failedIds: ['p1'] });
    expect(merged.map((p) => [p.id, p.title_es, p._isNew])).toEqual([['p1', 'Typed', true]]);
  });
  it('keeps typed text of failed rows and does not duplicate rows that were created', () => {
    const fresh = [row('p1', 'Old'), row('r2', 'Fine')];
    const local = [row('p1', 'Typed'), row('new_2', 'Fine', { _isNew: true }), row('new_1', 'Broken', { _isNew: true })];
    const merged = mergeAfterPartialSave(fresh, local, { failedIds: ['p1', 'new_1'] });
    expect(merged.map((p) => [p.id, p.title_es])).toEqual([['p1', 'Typed'], ['r2', 'Fine'], ['new_1', 'Broken']]);
    expect(merged[2]._isNew).toBe(true);
  });
});
