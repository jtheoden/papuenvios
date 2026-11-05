import { describe, it, expect, vi, beforeEach } from 'vitest';

// Public catalog/publication objects get unique names, so they can be cached for a year (egress).
const calls = vi.hoisted(() => []);
vi.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      from: (bucket) => ({
        upload: async (path, file, options) => { calls.push({ bucket, path, file, options }); return { error: null }; },
        getPublicUrl: (path) => ({ data: { publicUrl: `https://cdn.test/${bucket}/${path}` } })
      })
    }
  }
}));
vi.mock('@/lib/imageUtils', () => ({ validateImage: () => ({ valid: true, errors: [] }) }));
vi.mock('@/lib/imageOptimizer', async (importOriginal) => ({
  ...(await importOriginal()),
  optimizeImage: vi.fn(async (file) => new File([new Uint8Array(3)], file.name.replace(/\.\w+$/, '.webp'), { type: 'image/webp' }))
}));

import { uploadProductImage } from '@/lib/storage';
import { uploadPublicationImage } from '@/lib/publicationService';

describe('uploads of public images use a one-year cache', () => {
  beforeEach(() => { calls.length = 0; });

  it('product-images', async () => {
    await uploadProductImage(new Blob([new Uint8Array(2)], { type: 'image/jpeg' }), 'products/p1/1-abc.jpg');
    expect(calls[0].options.cacheControl).toBe('31536000');
  });

  it('publications: optimized to WebP, unique .webp name, one-year cache', async () => {
    const result = await uploadPublicationImage(new File([new Uint8Array(9)], 'cover.png', { type: 'image/png' }));
    expect(result.success).toBe(true);
    expect(calls[0].bucket).toBe('publications');
    expect(calls[0].path).toMatch(/^cover_\d+_[a-z0-9]+\.webp$/);
    expect(calls[0].options).toMatchObject({ cacheControl: '31536000', contentType: 'image/webp', upsert: false });
  });
});
