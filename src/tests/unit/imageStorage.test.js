import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import {
  resolveImageUrl,
  resizeToJpeg,
  isImageUploadError,
  IMAGE_UPLOAD_ERROR_CODE
} from '@/lib/imageStorage';
import { MAX_IMAGE_BYTES } from '@/lib/imageStoragePure';

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const jpegBlob = new Blob([new Uint8Array(10)], { type: 'image/jpeg' });

describe('resolveImageUrl', () => {
  let resize;
  let upload;

  beforeEach(() => {
    resize = vi.fn(async () => jpegBlob);
    upload = vi.fn(async (file, path) => ({ publicUrl: `https://cdn.test/${path}`, path }));
  });

  it('uploads a data URI and returns only the public URL', async () => {
    const url = await resolveImageUrl(PNG_1PX, { folder: 'products', id: 'p1', resize, upload });

    expect(resize).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledTimes(1);
    const [file, path] = upload.mock.calls[0];
    expect(file).toBe(jpegBlob);
    expect(path).toMatch(/^products\/p1\/\d+-[a-z0-9]+\.jpg$/);
    expect(url).toBe(`https://cdn.test/${path}`);
    expect(url.startsWith('data:')).toBe(false);
  });

  it('uploads a new File/Blob as well', async () => {
    const file = new File([new Uint8Array(5)], 'a.png', { type: 'image/png' });
    const url = await resolveImageUrl(file, { folder: 'combos', id: 'c1', resize, upload });
    expect(url).toMatch(/^https:\/\/cdn\.test\/combos\/c1\//);
  });

  it('does not re-upload an existing http(s) URL', async () => {
    const existing = 'https://x.supabase.co/storage/v1/object/public/product-images/products/p1/a.jpg';
    expect(await resolveImageUrl(existing, { folder: 'products', id: 'p1', resize, upload })).toBe(existing);
    expect(resize).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('passes empty values through untouched', async () => {
    expect(await resolveImageUrl('', { folder: 'products', id: 'p1', resize, upload })).toBe('');
    expect(await resolveImageUrl(null, { folder: 'products', id: 'p1', resize, upload })).toBeNull();
    expect(upload).not.toHaveBeenCalled();
  });

  it('fails closed when the upload fails (never falls back to base64)', async () => {
    upload.mockRejectedValue(new Error('storage down'));
    const error = await resolveImageUrl(PNG_1PX, { folder: 'products', id: 'p1', resize, upload }).catch((e) => e);
    expect(isImageUploadError(error)).toBe(true);
    expect(error.code).toBe(IMAGE_UPLOAD_ERROR_CODE);
    expect(error.message).toMatch(/imagen/i);
    expect(error.message).toMatch(/image/i);
  });

  it('fails closed when the upload returns no public URL', async () => {
    upload.mockResolvedValue({ publicUrl: undefined });
    const error = await resolveImageUrl(PNG_1PX, { folder: 'products', id: 'p1', resize, upload }).catch((e) => e);
    expect(isImageUploadError(error)).toBe(true);
  });

  it('fails closed on a malformed data URI without uploading', async () => {
    const error = await resolveImageUrl('data:image/png;base64,@@@', { folder: 'products', id: 'p1', resize, upload }).catch((e) => e);
    expect(isImageUploadError(error)).toBe(true);
    expect(upload).not.toHaveBeenCalled();
  });

  it('fails closed when the resized image cannot fit the size cap', async () => {
    resize.mockResolvedValue(null);
    const error = await resolveImageUrl(PNG_1PX, { folder: 'products', id: 'p1', resize, upload }).catch((e) => e);
    expect(isImageUploadError(error)).toBe(true);
    expect(error.context.reason).toBe('too_large');
    expect(upload).not.toHaveBeenCalled();
  });
});

describe('resizeToJpeg', () => {
  const realCreate = document.createElement.bind(document);
  let canvas;
  let sizeForQuality;

  beforeEach(() => {
    canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ fillRect: vi.fn(), drawImage: vi.fn(), fillStyle: '' }),
      toBlob: vi.fn((cb, type, quality) => cb(new Blob([new Uint8Array(sizeForQuality(quality))], { type })))
    };
    sizeForQuality = () => 1024;
    vi.spyOn(document, 'createElement').mockImplementation((tag) => (tag === 'canvas' ? canvas : realCreate(tag)));
    globalThis.createImageBitmap = vi.fn(async () => ({ width: 3000, height: 1500, close: vi.fn() }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete globalThis.createImageBitmap;
  });

  it('scales the longest side to 1200px and encodes JPEG at quality 0.82', async () => {
    const out = await resizeToJpeg(new Blob(['x'], { type: 'image/png' }));
    expect(canvas.width).toBe(1200);
    expect(canvas.height).toBe(600);
    expect(canvas.toBlob.mock.calls[0][1]).toBe('image/jpeg');
    expect(canvas.toBlob.mock.calls[0][2]).toBe(0.82);
    expect(out.size).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
  });

  it('lowers the quality until the result respects the 5 MB cap', async () => {
    sizeForQuality = (q) => (q > 0.65 ? MAX_IMAGE_BYTES + 1 : 2048);
    const out = await resizeToJpeg(new Blob(['x'], { type: 'image/png' }));
    expect(out.size).toBe(2048);
  });

  it('returns null when no quality fits under the cap', async () => {
    sizeForQuality = () => MAX_IMAGE_BYTES + 1;
    expect(await resizeToJpeg(new Blob(['x'], { type: 'image/png' }))).toBeNull();
  });
});
