/**
 * Encryption utilities for sensitive data
 * Uses Web Crypto API for secure encryption/decryption
 */

// Encryption key - In production, this should come from environment variables
const ENCRYPTION_KEY = import.meta.env.VITE_ENCRYPTION_KEY || 'papuenvios-2025-secure-key-change-in-prod';

/**
 * Derive a crypto key from the encryption key string
 */
async function getDerivedKey() {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(ENCRYPTION_KEY),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode('papuenvios-salt'),
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt a string value
 * @param {string} plaintext - The text to encrypt
 * @returns {Promise<string>} Base64 encoded encrypted string with IV
 */
export async function encryptData(plaintext) {
  try {
    const encoder = new TextEncoder();
    const key = await getDerivedKey();

    // Generate a random IV for each encryption
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const encrypted = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv
      },
      key,
      encoder.encode(plaintext)
    );

    // Combine IV and encrypted data
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);

    // Convert to base64 for storage
    return btoa(String.fromCharCode(...combined));
  } catch (error) {
    console.error('[encryptData] Error:', error);
    throw new Error('Failed to encrypt data');
  }
}

/**
 * Decrypt an encrypted string
 * @param {string} encryptedBase64 - Base64 encoded encrypted string
 * @returns {Promise<string>} Decrypted plaintext
 */
export async function decryptData(encryptedBase64) {
  try {
    const decoder = new TextDecoder();
    const key = await getDerivedKey();

    // Decode from base64
    const combined = new Uint8Array(
      atob(encryptedBase64).split('').map(char => char.charCodeAt(0))
    );

    // Extract IV and encrypted data
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv
      },
      key,
      encrypted
    );

    return decoder.decode(decrypted);
  } catch (error) {
    console.error('[decryptData] Error:', error);
    throw new Error('Failed to decrypt data');
  }
}

/**
 * Hash a value using SHA-256 (for legacy compatibility)
 * @param {string} value - Value to hash
 * @returns {Promise<string>} Hex string of hash
 */
export async function hashValue(value) {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
