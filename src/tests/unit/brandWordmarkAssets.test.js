import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const BRAND_DIR = resolve(__dirname, '../../assets/brand');
const MAX_SVG_BYTES = 20 * 1024;
const SVGS = [
  'papuenvios-wordmark-color.svg',
  'papuenvios-wordmark-white.svg',
  'papuenvios-wordmark-onlight.svg',
];

const readSvg = (name) => readFileSync(resolve(BRAND_DIR, name), 'utf8');
const fills = (svg) => [...svg.matchAll(/fill="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1].toUpperCase());

describe('brand wordmark assets', () => {
  it.each([...SVGS, 'papuenvios-wordmark-color.png'])('%s exists', (name) => {
    expect(existsSync(resolve(BRAND_DIR, name))).toBe(true);
  });

  describe.each(SVGS)('%s', (name) => {
    const svg = readSvg(name);

    it('is a well-formed SVG with a viewBox, role="img" and the brand title', () => {
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      expect(doc.querySelector('parsererror')).toBeNull();
      const root = doc.documentElement;
      expect(root.tagName).toBe('svg');
      expect(root.getAttribute('viewBox')).toMatch(/^0 0 \d+ \d+$/);
      expect(root.getAttribute('role')).toBe('img');
      expect(doc.querySelector('title').textContent).toBe('PapuEnvíos');
    });

    it('has no raster, text, script or external references', () => {
      expect(svg).not.toMatch(/<(image|text|script|foreignObject|style|use)\b/i);
      expect(svg).not.toMatch(/\son\w+\s*=/i);
      expect(svg).not.toMatch(/(href|src)\s*=/i);
      expect(svg).not.toMatch(/data:/i);
    });

    it(`is at most ${MAX_SVG_BYTES} bytes`, () => {
      expect(statSync(resolve(BRAND_DIR, name)).size).toBeLessThanOrEqual(MAX_SVG_BYTES);
    });
  });

  it('uses the measured brand colours per variant', () => {
    expect(new Set(fills(readSvg('papuenvios-wordmark-color.svg')))).toEqual(new Set(['#FFFFFF', '#FFA800']));
    expect(new Set(fills(readSvg('papuenvios-wordmark-white.svg')))).toEqual(new Set(['#FFFFFF']));
    expect(new Set(fills(readSvg('papuenvios-wordmark-onlight.svg')))).toEqual(new Set(['#1F2937', '#FFA800']));
  });

  it('colour PNG is a transparent RGBA image at least 1200 px wide', () => {
    const png = readFileSync(resolve(BRAND_DIR, 'papuenvios-wordmark-color.png'));
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.readUInt32BE(16)).toBeGreaterThanOrEqual(1200); // IHDR width
    expect(png[25]).toBe(6); // IHDR colour type 6 = RGBA
  });
});
