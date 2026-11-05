/**
 * Client-side image optimizer used right before every Storage upload (catalog, carousel, combos,
 * publications, payment/delivery proofs). Resizes so the longest side fits the preset and re-encodes
 * (WebP by default). Never blocks an upload: whenever the browser cannot decode/encode, or the result
 * would not be lighter, the ORIGINAL file is returned. PDFs, GIFs (animation), SVGs and non-images pass
 * through untouched.
 */

import { fitWithin } from './imageStoragePure';

export const IMAGE_PRESETS = {
  catalog: { maxSide: 1200, quality: 0.8 },
  // Legal evidence: stays readable (bigger side, higher quality), never touched when it is a PDF.
  proof: { maxSide: 1600, quality: 0.85 }
};

// One year. Only safe because every optimized upload gets a unique object name.
export const LONG_CACHE_CONTROL = '31536000';

const OPTIMIZABLE = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const EXTENSIONS = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif' };

export const isOptimizableImage = (type) => OPTIMIZABLE.has(type);

export const withExtension = (name, type) => {
  const base = typeof name === 'string' && name ? name.replace(/\.[^./]*$/, '') : 'image';
  return `${base}.${EXTENSIONS[type] || 'bin'}`;
};

export const loadBitmap = async (blob) => {
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
};

/**
 * Draws `bitmap` scaled to fit `maxSide` and returns an `encode(quality) => Promise<Blob|null>` for that canvas.
 * JPEG has no alpha, so transparent pixels are painted white only on the JPEG path.
 */
export const drawScaled = (bitmap, { maxSide, format }) => {
  const { width, height } = fitWithin(bitmap.width, bitmap.height, maxSide);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (format === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  if (typeof bitmap.close === 'function') bitmap.close();
  return (quality) => new Promise((resolve) => canvas.toBlob(resolve, format, quality));
};

/**
 * @param {File|Blob} file
 * @param {{maxSide: number, quality: number}} preset
 * @param {{format?: 'image/webp'|'image/jpeg'}} options
 * @returns {Promise<File|Blob>} the optimized File (named with the new extension) or the original
 */
export const optimizeImage = async (file, preset, { format = 'image/webp' } = {}) => {
  if (!file || !isOptimizableImage(file.type)) return file;
  // shortcut: without createImageBitmap (Safari < 15, jsdom) the original is uploaded; the <img> decode
  // fallback is skipped here because a stuck decode would block a payment proof upload.
  if (typeof createImageBitmap !== 'function') return file;
  try {
    const bitmap = await loadBitmap(file);
    const encode = drawScaled(bitmap, { maxSide: preset.maxSide, format });
    const blob = await encode(preset.quality);
    // Safari (and old browsers) silently return PNG when they cannot encode WebP: keep the original.
    if (!blob || blob.type !== format) return file;
    // Never upload something heavier than what the user picked.
    if (blob.size >= file.size) return file;
    return new File([blob], withExtension(file.name, format), { type: format });
  } catch {
    return file;
  }
};
