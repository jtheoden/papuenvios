/**
 * Pure helpers (no DOM, no network) for the image-to-Storage flow.
 */

export const MAX_IMAGE_DIMENSION = 1200;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // bucket limit
export const JPEG_QUALITY = 0.82;
// Fallback qualities tried (in order) when the first encoding exceeds the cap
export const FALLBACK_QUALITIES = [0.7, 0.6, 0.5, 0.4];

export const isDataUri = (value) =>
  typeof value === 'string' && /^data:image\/[a-z0-9.+-]+;base64,/i.test(value);

export const isHttpUrl = (value) =>
  typeof value === 'string' && /^https?:\/\//i.test(value);

/** @returns {{mime: string, bytes: Uint8Array} | null} */
export const parseDataUri = (value) => {
  if (!isDataUri(value)) return null;
  const comma = value.indexOf(',');
  const mime = value.slice(5, value.indexOf(';')).toLowerCase();
  try {
    const binary = atob(value.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return { mime, bytes };
  } catch {
    return null;
  }
};

export const dataUriToBlob = (value) => {
  const parsed = parseDataUri(value);
  return parsed ? new Blob([parsed.bytes], { type: parsed.mime }) : null;
};

const safeSegment = (segment) =>
  String(segment).replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'x';

/** e.g. products/<id>/<timestamp>-<rand>.jpg */
export const buildImagePath = (folder, id, { now = Date.now(), random = Math.random } = {}) => {
  const rand = random().toString(36).slice(2, 8).padEnd(4, '0');
  return `${safeSegment(folder)}/${safeSegment(id)}/${now}-${rand}.jpg`;
};

/** Scale down (never up) so the longest side is at most `max`. */
export const fitWithin = (width, height, max = MAX_IMAGE_DIMENSION) => {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
};

/**
 * Encode with decreasing quality until the result fits the byte cap.
 * `encode(quality)` must resolve to something with a numeric `size`.
 * @returns the first fitting result, or null when none fits
 */
export const encodeWithinLimit = async (encode, maxBytes = MAX_IMAGE_BYTES) => {
  for (const quality of [JPEG_QUALITY, ...FALLBACK_QUALITIES]) {
    const result = await encode(quality);
    if (result && result.size <= maxBytes) return result;
  }
  return null;
};
