// Pure decision logic for bank-account-crypto (no Deno APIs, testable with Vitest).

export const MAX_PLAINTEXT_LENGTH = 512;
// AES-GCM adds a 12-byte IV and a 16-byte tag; base64 inflates by ~4/3.
export const MAX_CIPHERTEXT_LENGTH = 2048;

const ADMIN_ROLES = ['admin', 'super_admin'];
const ACTIONS = ['encrypt', 'decrypt'];

/** Fail closed: a missing/blank secret must never fall back to a derivable key. */
export function resolveEncryptionKey(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, status: 500, error: 'encryption_not_configured' };
  }
  return { ok: true, key: raw };
}

/**
 * encrypt: any authenticated user (customers save their own recipient accounts
 * via recipientService.js). decrypt: admin / super_admin only.
 */
export function authorizeRequest({ action, hasSession, role }) {
  if (!hasSession) return { ok: false, status: 401, error: 'Unauthorized' };
  if (!ACTIONS.includes(action)) return { ok: false, status: 400, error: 'Invalid action' };
  if (action === 'decrypt' && !ADMIN_ROLES.includes(role)) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }
  return { ok: true };
}

export function validatePayload(action, data) {
  if (typeof data !== 'string' || data.length === 0) {
    return { ok: false, status: 400, error: 'Missing data' };
  }
  const max = action === 'decrypt' ? MAX_CIPHERTEXT_LENGTH : MAX_PLAINTEXT_LENGTH;
  if (data.length > max) return { ok: false, status: 413, error: 'Payload too large' };
  return { ok: true };
}
