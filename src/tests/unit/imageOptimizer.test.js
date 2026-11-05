import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  IMAGE_PRESETS,
  LONG_CACHE_CONTROL,
  isOptimizableImage,
  withExtension,
  optimizeImage
} from '@/lib/imageOptimizer';

// Canvas simulated: jsdom has no encoder. toBlob returns `encodedSize` bytes of the requested type
// (or of `encodedType` to mimic Safari, which silently answers PNG when it cannot encode WebP).
describe('optimizeImage', () => {
  const realCreate = document.createElement.bind(document);
  let canvas;
  let ctx;
  let encodedSize;
  let encodedType;
  let bitmap;

  beforeEach(() => {
    encodedSize = 1000;
    encodedType = null;
    bitmap = { width: 3000, height: 1500, close: vi.fn() };
    ctx = { fillRect: vi.fn(), drawImage: vi.fn(), fillStyle: '' };
    canvas = {
      width: 0,
      height: 0,
      getContext: () => ctx,
      toBlob: vi.fn((cb, type) => cb(new Blob([new Uint8Array(encodedSize)], { type: encodedType || type })))
    };
    vi.spyOn(document, 'createElement').mockImplementation((tag) => (tag === 'canvas' ? canvas : realCreate(tag)));
    globalThis.createImageBitmap = vi.fn(async () => bitmap);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete globalThis.createImageBitmap;
  });

  const photo = (size = 500_000, type = 'image/jpeg', name = 'foto.JPG') => new File([new Uint8Array(size)], name, { type });

  it('scales the longest side to 1200 px (catalog), keeps the ratio and encodes WebP at 0.8', async () => {
    const out = await optimizeImage(photo(), IMAGE_PRESETS.catalog);
    expect([canvas.width, canvas.height]).toEqual([1200, 600]);
    expect(canvas.toBlob.mock.calls[0][1]).toBe('image/webp');
    expect(canvas.toBlob.mock.calls[0][2]).toBe(0.8);
    expect(out.type).toBe('image/webp');
    expect(out.name).toBe('foto.webp');
    expect(out.size).toBe(1000);
  });

  it('proof preset: at most 1600 px and quality 0.85', async () => {
    bitmap = { width: 1000, height: 4000 };
    await optimizeImage(photo(), IMAGE_PRESETS.proof);
    expect([canvas.width, canvas.height]).toEqual([400, 1600]);
    expect(canvas.toBlob.mock.calls[0][2]).toBe(0.85);
  });

  it('does not paint a background for WebP (keeps PNG transparency) but does for JPEG', async () => {
    await optimizeImage(photo(500_000, 'image/png', 'logo.png'), IMAGE_PRESETS.catalog);
    expect(ctx.fillRect).not.toHaveBeenCalled();
    await optimizeImage(photo(500_000, 'image/png', 'logo.png'), IMAGE_PRESETS.catalog, { format: 'image/jpeg' });
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
  });

  it('returns the original when the browser cannot encode the format (Safari answers PNG)', async () => {
    encodedType = 'image/png';
    const original = photo();
    expect(await optimizeImage(original, IMAGE_PRESETS.catalog)).toBe(original);
  });

  it('returns the original when canvas/decoding fails', async () => {
    globalThis.createImageBitmap = vi.fn(async () => { throw new Error('decode'); });
    const original = photo();
    expect(await optimizeImage(original, IMAGE_PRESETS.catalog)).toBe(original);
  });

  it('keeps a small original that the re-encode would make heavier', async () => {
    bitmap = { width: 800, height: 600 };
    encodedSize = 600;
    const original = photo(500);
    expect(await optimizeImage(original, IMAGE_PRESETS.catalog)).toBe(original);
  });

  it('passes PDFs, GIFs, SVGs and non-images through untouched', async () => {
    for (const [type, name] of [['application/pdf', 'a.pdf'], ['image/gif', 'a.gif'], ['image/svg+xml', 'a.svg'], ['text/plain', 'a.txt']]) {
      const file = photo(10, type, name);
      expect(await optimizeImage(file, IMAGE_PRESETS.proof)).toBe(file);
    }
    expect(canvas.toBlob).not.toHaveBeenCalled();
  });
});

describe('pure helpers', () => {
  it('only raster formats the canvas can re-encode are optimizable', () => {
    expect(['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].every(isOptimizableImage)).toBe(true);
    expect(['image/gif', 'image/svg+xml', 'application/pdf', 'image/heic', undefined].some(isOptimizableImage)).toBe(false);
  });

  it('withExtension swaps (or adds) the extension for the output type', () => {
    expect(withExtension('a.b.png', 'image/webp')).toBe('a.b.webp');
    expect(withExtension('scan', 'image/jpeg')).toBe('scan.jpg');
    expect(withExtension(undefined, 'image/webp')).toBe('image.webp');
  });

  it('long cache is one year (safe only with unique object names)', () => {
    expect(LONG_CACHE_CONTROL).toBe('31536000');
  });
});
