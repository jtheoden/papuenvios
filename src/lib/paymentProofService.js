import { supabase } from './supabase';
import { parseSupabaseError, logError } from './errorHandler';
import { FILE_SIZE_LIMITS } from './constants';
import { PAYMENT_PROOF_BUCKET, extractPaymentProofPath } from './paymentProofUrl';

// Keep in sync with allowed_mime_types of the bucket (migration 20261022100000).
export const PAYMENT_PROOF_MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};

export const PAYMENT_PROOF_SIGNED_URL_TTL = 300;

/** @returns {string|null} error message, or null when the file is acceptable */
export const validatePaymentProofFile = (file) => {
  if (!file || !PAYMENT_PROOF_MIME_EXT[file.type]) {
    return 'Invalid file type: only JPG, PNG or WebP images are allowed';
  }
  if (file.size > FILE_SIZE_LIMITS.PAYMENT_PROOF) {
    return 'Invalid file size: the maximum is 5MB';
  }
  return null;
};

/**
 * Short-lived signed URL for an order payment proof (legacy public URL or raw path).
 * @returns {Promise<{success: boolean, signedUrl?: string, error?: string}>}
 */
export const getPaymentProofSignedUrl = async (value, expiresIn = PAYMENT_PROOF_SIGNED_URL_TTL) => {
  const path = extractPaymentProofPath(value);
  if (!path) return { success: false, error: 'Invalid payment proof reference' };

  const { data, error } = await supabase.storage.from(PAYMENT_PROOF_BUCKET).createSignedUrl(path, expiresIn);
  if (error) {
    const appError = parseSupabaseError(error);
    logError(appError, { operation: 'getPaymentProofSignedUrl', path });
    return { success: false, error: appError.message || 'Failed to sign payment proof URL' };
  }
  if (!data?.signedUrl) return { success: false, error: 'No signed URL returned from storage' };
  return { success: true, signedUrl: data.signedUrl };
};
