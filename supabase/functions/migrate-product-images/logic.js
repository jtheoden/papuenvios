// Pure logic for the TEMPORARY migrate-product-images edge function.
// No Deno or Node specific APIs: it runs unchanged under Deno (index.ts) and vitest.
// Uses only standard globals (atob, TextEncoder, crypto.subtle).

export const BUCKET = 'product-images';
export const ALLOWED_TABLES = ['products', 'combo_products', 'carousel_slides'];

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const DATA_URI_PATTERN = /^data:image\/[a-z0-9.+-]+;base64,/i;

export const isImageDataUri = (value) =>
  typeof value === 'string' && DATA_URI_PATTERN.test(value);

/** @returns {{mime: string, bytes: Uint8Array} | null} */
export const parseDataUri = (value) => {
  if (!isImageDataUri(value)) return null;
  const mime = value.slice(5, value.indexOf(';')).toLowerCase();
  try {
    const binary = atob(value.slice(value.indexOf(',') + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return { mime, bytes };
  } catch {
    return null;
  }
};

export const buildMigratedPath = (table, id) => {
  if (!ALLOWED_TABLES.includes(table)) throw new Error(`Table not allowed: ${table}`);
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new Error('Unsafe row id');
  return `migrated/${table}/${id}.jpg`;
};

export const buildPublicUrl = (supabaseUrl, path) =>
  `${String(supabaseUrl).replace(/\/+$/, '')}/storage/v1/object/public/${BUCKET}/${path}`;

export const sha256Hex = async (bytes) => {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

/** Constant-time comparison of two sha256 hex digests (case-insensitive). */
export const hashesMatch = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== 64 || b.length !== 64) return false;
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  let diff = 0;
  for (let i = 0; i < 64; i += 1) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
};

/** The request token is valid when sha256(token) equals the stored hash. */
export const tokenMatches = async (token, storedHashHex) => {
  if (typeof token !== 'string' || token.length === 0) return false;
  if (typeof storedHashHex !== 'string') return false;
  const digest = await sha256Hex(new TextEncoder().encode(token));
  return hashesMatch(digest, storedHashHex);
};

/**
 * True when a storage error means "the object does not exist".
 * storage-js download() does not parse the error body: the message is "{}" and the
 * HTTP status lives in error.originalError.status. Auth/server/network errors are NOT
 * treated as missing, so they surface instead of looking like a fresh upload.
 */
export const isObjectMissingError = (error) => {
  if (!error) return false;
  const message = String(error.message || '').toLowerCase();
  const status = Number(error.status ?? error.statusCode ?? error.originalError?.status);
  return message.includes('not found') || status === 400 || status === 404;
};

/**
 * What to do with one row.
 * - dry_run : report only, never write
 * - upload  : object absent -> upload (upsert false)
 * - reuse   : object already there with identical sha256 -> skip the upload
 * - conflict: object there with different content -> never overwrite, count as failed
 */
export const decideAction = ({ dryRun, existing, sha256 }) => {
  if (dryRun) return 'dry_run';
  if (!existing) return 'upload';
  return hashesMatch(existing.sha256, sha256) ? 'reuse' : 'conflict';
};

export const newCounters = () => ({
  found: 0,
  migrated: 0,
  skipped: 0,
  failed: 0,
  bytes_before: 0,
  bytes_after: 0
});
