import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const db = vi.hoisted(() => ({ inserts: [], updates: [], uploadError: null }));

vi.mock('@/lib/supabase', () => {
  const builder = (table) => {
    const b = {};
    b.insert = vi.fn((rows) => { db.inserts.push({ table, row: rows[0] }); return b; });
    b.update = vi.fn((row) => { db.updates.push({ table, row }); return b; });
    b.select = vi.fn(() => b);
    b.eq = vi.fn(() => b);
    b.in = vi.fn(() => b);
    b.delete = vi.fn(() => b);
    b.order = vi.fn(() => b);
    b.limit = vi.fn(async () => ({ data: [], error: null }));
    b.single = vi.fn(async () => ({ data: { id: 'new-id', ...(db.inserts.at(-1)?.row || {}) }, error: null }));
    b.then = (resolve) => resolve({ data: null, error: null });
    return b;
  };
  return { supabase: { from: builder, rpc: vi.fn(async () => ({ data: null, error: null })) } };
});
vi.mock('@/lib/activityLogger', () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/storage', () => ({
  uploadProductImage: vi.fn(async (file, path) => {
    if (db.uploadError) throw db.uploadError;
    return { publicUrl: `https://cdn.test/${path}`, path };
  })
}));
import { createProduct, updateProduct } from '@/lib/productService';
import { createCombo, updateCombo } from '@/lib/comboService';
import { createCarouselSlide, updateCarouselSlide } from '@/lib/carouselService';
import { uploadProductImage } from '@/lib/storage';
import { isImageUploadError } from '@/lib/imageStorage';

const productForm = {
  name_es: 'P', name_en: 'P', category_id: 'cat', basePrice: '1', base_currency_id: 'usd', image: PNG_1PX
};

describe('services upload images to Storage instead of storing base64', () => {
  beforeEach(() => {
    db.inserts.length = 0;
    db.updates.length = 0;
    db.uploadError = null;
    vi.clearAllMocks();
    // jsdom has no canvas: stub just enough for the real resize step
    const realCreate = document.createElement.bind(document);
    const canvas = {
      getContext: () => ({ fillRect: vi.fn(), drawImage: vi.fn() }),
      toBlob: (cb, type) => cb(new Blob([new Uint8Array(8)], { type }))
    };
    vi.spyOn(document, 'createElement').mockImplementation((tag) => (tag === 'canvas' ? canvas : realCreate(tag)));
    globalThis.createImageBitmap = vi.fn(async () => ({ width: 10, height: 10, close: vi.fn() }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete globalThis.createImageBitmap;
  });

  it('createProduct stores only the public URL and no longer writes image_file', async () => {
    await createProduct(productForm);
    const row = db.inserts.find((i) => i.table === 'products').row;
    expect(row.image_url).toMatch(/^https:\/\/cdn\.test\/products\/[^/]+\/\d+-[a-z0-9]+\.jpg$/);
    expect('image_file' in row).toBe(false);
  });

  it('updateProduct uploads under the product folder and does not write image_file', async () => {
    await updateProduct('p1', productForm);
    const row = db.updates.find((u) => u.table === 'products').row;
    expect(row.image_url).toMatch(/^https:\/\/cdn\.test\/products\/p1\//);
    expect('image_file' in row).toBe(false);
  });

  it('updateProduct keeps an existing URL without uploading again', async () => {
    const url = 'https://cdn.test/products/p1/old.jpg';
    await updateProduct('p1', { ...productForm, image: url });
    expect(uploadProductImage).not.toHaveBeenCalled();
    expect(db.updates.find((u) => u.table === 'products').row.image_url).toBe(url);
  });

  it('createProduct fails closed: upload error means nothing is inserted', async () => {
    db.uploadError = new Error('storage down');
    const error = await createProduct(productForm).catch((e) => e);
    expect(isImageUploadError(error)).toBe(true);
    expect(db.inserts.some((i) => i.table === 'products')).toBe(false);
  });

  it('updateProduct fails closed: upload error means no update', async () => {
    db.uploadError = new Error('storage down');
    const error = await updateProduct('p1', productForm).catch((e) => e);
    expect(isImageUploadError(error)).toBe(true);
    expect(db.updates.some((u) => u.table === 'products')).toBe(false);
  });

  it('createCombo / updateCombo store the public URL under combos/', async () => {
    const comboData = { name: 'C', image: PNG_1PX, productsWithQuantities: [{ productId: 'p1', quantity: 1 }] };
    await createCombo(comboData).catch(() => {});
    expect(db.inserts.find((i) => i.table === 'combo_products').row.image_url).toMatch(/^https:\/\/cdn\.test\/combos\//);

    await updateCombo('c1', comboData).catch(() => {});
    expect(db.updates.find((u) => u.table === 'combo_products').row.image_url).toMatch(/^https:\/\/cdn\.test\/combos\/c1\//);
  });

  it('createCombo fails closed on upload error', async () => {
    db.uploadError = new Error('storage down');
    const error = await createCombo({ name: 'C', image: PNG_1PX, productsWithQuantities: [{ productId: 'p1', quantity: 1 }] }).catch((e) => e);
    expect(isImageUploadError(error)).toBe(true);
    expect(db.inserts.some((i) => i.table === 'combo_products')).toBe(false);
  });

  it('carousel create/update store the public URL under carousel/ and never image_file', async () => {
    await createCarouselSlide({ title_es: 'x', image_url: PNG_1PX, image_file: PNG_1PX });
    const insert = db.inserts.find((i) => i.table === 'carousel_slides').row;
    expect(insert.image_url).toMatch(/^https:\/\/cdn\.test\/carousel\//);
    expect('image_file' in insert).toBe(false);

    await updateCarouselSlide('s1', { image_url: PNG_1PX });
    expect(db.updates.find((u) => u.table === 'carousel_slides').row.image_url).toMatch(/^https:\/\/cdn\.test\/carousel\/s1\//);
  });

  it('updateCarouselSlide leaves non-image updates alone and fails closed on upload error', async () => {
    await updateCarouselSlide('s1', { title_es: 'hola' });
    expect(uploadProductImage).not.toHaveBeenCalled();

    db.updates.length = 0;
    db.uploadError = new Error('storage down');
    const error = await updateCarouselSlide('s1', { image_url: PNG_1PX }).catch((e) => e);
    expect(isImageUploadError(error)).toBe(true);
    expect(db.updates.length).toBe(0);
  });
});
