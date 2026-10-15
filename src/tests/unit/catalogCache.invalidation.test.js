import { describe, it, expect, vi, beforeEach } from 'vitest';

// Every DB call fails: invalidation must still happen (it runs in `finally`),
// which keeps this test independent from each mutation's internals.
const { boom } = vi.hoisted(() => ({
  boom: () => {
    throw new Error('db down');
  }
}));
vi.mock('@/lib/supabase', () => ({
  supabase: { from: boom, rpc: boom, auth: { getUser: boom } }
}));
vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));

import { loadCached, clearCatalogCache } from '@/lib/catalogCache';
import * as productService from '@/lib/productService';
import * as comboService from '@/lib/comboService';
import * as carouselService from '@/lib/carouselService';
import * as bulkDeleteService from '@/lib/bulkDeleteService';

const mutations = [
  ['setProductActiveState', productService, ['p1', true]],
  ['setProductImageUrl', productService, ['p1', 'https://example.com/a.png']],
  ['createProduct', productService, [{ name_es: 'x', name_en: 'x' }]],
  ['updateProduct', productService, ['p1', { name_es: 'x', name_en: 'x' }]],
  ['deleteProduct', productService, ['p1']],
  ['createCategory', productService, [{ name_es: 'x', name_en: 'x' }]],
  ['updateCategory', productService, ['c1', { name_es: 'x', name_en: 'x' }]],
  ['deleteCategory', productService, ['c1']],
  ['createCombo', comboService, [{}]],
  ['updateCombo', comboService, ['c1', {}]],
  ['setComboActiveState', comboService, ['c1', true]],
  ['deleteCombo', comboService, ['c1']],
  ['createCarouselSlide', carouselService, [{}]],
  ['updateCarouselSlide', carouselService, ['s1', {}]],
  ['toggleCarouselSlideActive', carouselService, ['s1', true]],
  ['updateSlideOrder', carouselService, ['s1', 2]],
  ['reorderSlides', carouselService, [[{ id: 's1', display_order: 1 }]]],
  ['deleteCarouselSlide', carouselService, ['s1']],
  ['hardDeleteCarouselSlide', carouselService, ['s1']],
  ['bulkDeleteProducts', bulkDeleteService, [['p1']]],
  ['bulkDeleteCategories', bulkDeleteService, [['c1']]]
];

describe('catalog mutations invalidate the in-memory cache', () => {
  beforeEach(() => clearCatalogCache());

  it.each(mutations)('%s', async (name, mod, args) => {
    const fetcher = vi.fn().mockResolvedValue(['cached']);
    await loadCached('products:public', fetcher);

    await Promise.resolve(mod[name](...args)).catch(() => {});

    const next = await loadCached('products:public', fetcher);
    expect(next.fromCache).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
