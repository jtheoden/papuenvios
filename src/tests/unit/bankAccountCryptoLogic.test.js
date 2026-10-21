import { describe, it, expect } from 'vitest';
import {
  resolveEncryptionKey,
  authorizeRequest,
  validatePayload,
  MAX_PLAINTEXT_LENGTH,
  MAX_CIPHERTEXT_LENGTH,
} from '../../../supabase/functions/bank-account-crypto/logic.js';

describe('resolveEncryptionKey (fail closed)', () => {
  it.each([undefined, null, '', '   '])('rejects missing/blank key %j', (raw) => {
    expect(resolveEncryptionKey(raw)).toEqual({
      ok: false,
      status: 500,
      error: 'encryption_not_configured',
    });
  });

  it('accepts a real key', () => {
    expect(resolveEncryptionKey('s3cret-value')).toEqual({ ok: true, key: 's3cret-value' });
  });
});

describe('authorizeRequest', () => {
  it('rejects requests without a session with 401', () => {
    expect(authorizeRequest({ action: 'encrypt', hasSession: false, role: null })).toMatchObject({ ok: false, status: 401 });
  });

  it('allows encrypt for any authenticated user (customers save recipient accounts)', () => {
    expect(authorizeRequest({ action: 'encrypt', hasSession: true, role: 'user' })).toEqual({ ok: true });
  });

  it('requires admin for decrypt', () => {
    expect(authorizeRequest({ action: 'decrypt', hasSession: true, role: 'user' })).toMatchObject({ ok: false, status: 403 });
    expect(authorizeRequest({ action: 'decrypt', hasSession: true, role: null })).toMatchObject({ ok: false, status: 403 });
    expect(authorizeRequest({ action: 'decrypt', hasSession: true, role: 'admin' })).toEqual({ ok: true });
    expect(authorizeRequest({ action: 'decrypt', hasSession: true, role: 'super_admin' })).toEqual({ ok: true });
  });

  it('rejects unknown actions with 400', () => {
    expect(authorizeRequest({ action: 'rotate', hasSession: true, role: 'admin' })).toMatchObject({ ok: false, status: 400 });
  });
});

describe('validatePayload', () => {
  it('requires a non-empty string', () => {
    for (const bad of [undefined, null, '', 42, {}, []]) {
      expect(validatePayload('encrypt', bad)).toMatchObject({ ok: false, status: 400 });
    }
  });

  it('rejects oversized plaintext', () => {
    expect(validatePayload('encrypt', 'a'.repeat(MAX_PLAINTEXT_LENGTH))).toEqual({ ok: true });
    expect(validatePayload('encrypt', 'a'.repeat(MAX_PLAINTEXT_LENGTH + 1))).toMatchObject({ ok: false, status: 413 });
  });

  it('rejects oversized ciphertext on decrypt', () => {
    expect(validatePayload('decrypt', 'a'.repeat(MAX_CIPHERTEXT_LENGTH + 1))).toMatchObject({ ok: false, status: 413 });
  });
});
