import { describe, it, expect } from 'vitest';
import {
  ALLOWED_TABLES,
  isImageDataUri,
  parseDataUri,
  buildMigratedPath,
  buildPublicUrl,
  sha256Hex,
  hashesMatch,
  tokenMatches,
  decideAction,
  newCounters,
  isObjectMissingError
} from '../../../supabase/functions/migrate-product-images/logic.js';

// 1x1 JPEG
const JPEG_B64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const JPEG_URI = `data:image/jpeg;base64,${JPEG_B64}`;

describe('migrate-product-images logic', () => {
  it('only knows the three catalog tables', () => {
    expect([...ALLOWED_TABLES].sort()).toEqual(['carousel_slides', 'combo_products', 'products']);
  });

  it('detects image data URIs only', () => {
    expect(isImageDataUri(JPEG_URI)).toBe(true);
    expect(isImageDataUri('https://x/y.jpg')).toBe(false);
    expect(isImageDataUri('data:text/plain;base64,aGk=')).toBe(false);
    expect(isImageDataUri(null)).toBe(false);
  });

  it('parses mime and decoded bytes', () => {
    const { mime, bytes } = parseDataUri(JPEG_URI);
    expect(mime).toBe('image/jpeg');
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
    expect(parseDataUri('data:image/jpeg;base64,@@@')).toBeNull();
  });

  it('builds migrated/<table>/<id>.jpg and rejects unknown tables or unsafe ids', () => {
    expect(buildMigratedPath('products', '3f2c1a9e-0000-4000-8000-000000000001'))
      .toBe('migrated/products/3f2c1a9e-0000-4000-8000-000000000001.jpg');
    expect(() => buildMigratedPath('users', 'abc')).toThrow();
    expect(() => buildMigratedPath('products', '../etc/passwd')).toThrow();
    expect(() => buildMigratedPath('products', '')).toThrow();
  });

  it('builds the public URL of the bucket', () => {
    expect(buildPublicUrl('https://p.supabase.co/', 'migrated/products/a.jpg'))
      .toBe('https://p.supabase.co/storage/v1/object/public/product-images/migrated/products/a.jpg');
  });

  it('computes a stable sha256 hex digest', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc')))
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('compares hashes case-insensitively and rejects different/invalid ones', () => {
    const h = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    expect(hashesMatch(h, h.toUpperCase())).toBe(true);
    expect(hashesMatch(h, h.replace('b', 'c'))).toBe(false);
    expect(hashesMatch(h, 'short')).toBe(false);
    expect(hashesMatch(null, h)).toBe(false);
  });

  it('authorizes a token only when its sha256 equals the stored hash', async () => {
    const stored = await sha256Hex(new TextEncoder().encode('s3cret'));
    expect(await tokenMatches('s3cret', stored)).toBe(true);
    expect(await tokenMatches('wrong', stored)).toBe(false);
    expect(await tokenMatches('', stored)).toBe(false);
    expect(await tokenMatches(null, stored)).toBe(false);
    expect(await tokenMatches('s3cret', null)).toBe(false);
  });

  describe('decideAction (idempotency)', () => {
    const sha = 'a'.repeat(64);

    it('dry run never writes', () => {
      expect(decideAction({ dryRun: true, existing: null, sha256: sha })).toBe('dry_run');
      expect(decideAction({ dryRun: true, existing: { sha256: sha }, sha256: sha })).toBe('dry_run');
    });

    it('uploads when the object does not exist', () => {
      expect(decideAction({ dryRun: false, existing: null, sha256: sha })).toBe('upload');
    });

    it('reuses an existing object with the same sha256', () => {
      expect(decideAction({ dryRun: false, existing: { sha256: sha }, sha256: sha })).toBe('reuse');
    });

    it('flags a conflict when the existing object differs (never overwrites)', () => {
      expect(decideAction({ dryRun: false, existing: { sha256: 'b'.repeat(64) }, sha256: sha })).toBe('conflict');
    });
  });

  it('starts counters at zero', () => {
    expect(newCounters()).toEqual({ found: 0, migrated: 0, skipped: 0, failed: 0, bytes_before: 0, bytes_after: 0 });
  });

  describe('isObjectMissingError', () => {
    it('is false when there is no error', () => {
      expect(isObjectMissingError(null)).toBe(false);
    });

    it('recognises the storage-js download error (message "{}", status in originalError)', () => {
      expect(isObjectMissingError({ message: '{}', originalError: { status: 400 } })).toBe(true);
      expect(isObjectMissingError({ message: '{}', originalError: { status: 404 } })).toBe(true);
    });

    it('recognises parsed API errors', () => {
      expect(isObjectMissingError({ message: 'Object not found', status: 400 })).toBe(true);
      expect(isObjectMissingError({ message: 'x', statusCode: '404' })).toBe(true);
    });

    it('does not hide real failures (auth, server, network)', () => {
      expect(isObjectMissingError({ message: '{}', originalError: { status: 401 } })).toBe(false);
      expect(isObjectMissingError({ message: '{}', originalError: { status: 403 } })).toBe(false);
      expect(isObjectMissingError({ message: '{}', originalError: { status: 500 } })).toBe(false);
      expect(isObjectMissingError({ message: 'fetch failed' })).toBe(false);
    });
  });
});
