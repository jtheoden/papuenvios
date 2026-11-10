import { describe, it, expect, vi } from 'vitest';
import {
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_BYTES,
  JPEG_QUALITY,
  isDataUri,
  isHttpUrl,
  parseDataUri,
  dataUriToBlob,
  buildImagePath,
  fitWithin,
  encodeWithinLimit
} from '@/lib/imageStoragePure';

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('imageStoragePure', () => {
  it('exposes the agreed limits', () => {
    expect(MAX_IMAGE_DIMENSION).toBe(1200);
    expect(MAX_IMAGE_BYTES).toBe(5 * 1024 * 1024);
    expect(JPEG_QUALITY).toBe(0.82);
  });

  it('detects data URIs and http(s) URLs', () => {
    expect(isDataUri(PNG_1PX)).toBe(true);
    expect(isDataUri('https://x.co/a.jpg')).toBe(false);
    expect(isDataUri('')).toBe(false);
    expect(isDataUri(null)).toBe(false);
    expect(isHttpUrl('https://x.co/a.jpg')).toBe(true);
    expect(isHttpUrl('http://x.co/a.jpg')).toBe(true);
    expect(isHttpUrl(PNG_1PX)).toBe(false);
    expect(isHttpUrl(undefined)).toBe(false);
  });

  it('parses a base64 data URI into mime and bytes', () => {
    const parsed = parseDataUri(PNG_1PX);
    expect(parsed.mime).toBe('image/png');
    expect(parsed.bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(parsed.bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('returns null for malformed or non-image data URIs', () => {
    expect(parseDataUri('data:text/plain;base64,aGk=')).toBeNull();
    expect(parseDataUri('data:image/png;utf8,abc')).toBeNull();
    expect(parseDataUri('not a data uri')).toBeNull();
  });

  it('builds a Blob with the parsed mime', () => {
    const blob = dataUriToBlob(PNG_1PX);
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(parseDataUri(PNG_1PX).bytes.length);
    expect(dataUriToBlob('nope')).toBeNull();
  });

  it('builds unique, well-formed storage paths', () => {
    const path = buildImagePath('products', 'abc-123', { now: 1700000000000, random: () => 0.123456789 });
    expect(path).toMatch(/^products\/abc-123\/1700000000000-[a-z0-9]{4,}\.jpg$/);
    const other = buildImagePath('products', 'abc-123', { now: 1700000000000, random: () => 0.987654321 });
    expect(other).not.toBe(path);
  });

  it('sanitizes folder and id segments', () => {
    const path = buildImagePath('carousel', '../evil id', { now: 1, random: () => 0.5 });
    expect(path.startsWith('carousel/')).toBe(true);
    expect(path).not.toContain('..');
    expect(path).not.toContain(' ');
  });

  it('fitWithin keeps small images and scales the longest side down to the max', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(2400, 1200)).toEqual({ width: 1200, height: 600 });
    expect(fitWithin(1000, 3000)).toEqual({ width: 400, height: 1200 });
    expect(fitWithin(1201, 1201)).toEqual({ width: 1200, height: 1200 });
  });

  it('encodeWithinLimit returns the first encoding under the cap', async () => {
    const encode = vi.fn(async (q) => ({ size: q > 0.8 ? 6 * 1024 * 1024 : 1024, q }));
    const result = await encodeWithinLimit(encode);
    expect(result.q).toBeLessThan(0.82);
    expect(result.size).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
    expect(encode.mock.calls[0][0]).toBe(JPEG_QUALITY);
  });

  it('encodeWithinLimit returns null when nothing fits under the cap', async () => {
    const encode = vi.fn(async () => ({ size: MAX_IMAGE_BYTES + 1 }));
    expect(await encodeWithinLimit(encode)).toBeNull();
  });
});
