/**
 * Image -> Supabase Storage flow.
 *
 * Forms keep producing a data URI (preview) or a File; the services call
 * resolveImageUrl() right before writing, so only a public URL is ever stored.
 * Fails closed: if the upload cannot complete, an ImageUploadError is thrown and
 * the record is NOT saved (no base64 fallback).
 */

import { AppError } from './errorHandler';
import { uploadProductImage } from './storage';
import {
  isDataUri,
  dataUriToBlob,
  buildImagePath,
  encodeWithinLimit,
  MAX_IMAGE_DIMENSION
} from './imageStoragePure';
import { loadBitmap, drawScaled, optimizeImage, IMAGE_PRESETS } from './imageOptimizer';

export const IMAGE_UPLOAD_ERROR_CODE = 'IMAGE_UPLOAD_FAILED';

const MESSAGES = {
  upload_failed: 'No se pudo subir la imagen. Intente de nuevo. / Could not upload the image. Please try again.',
  invalid_image: 'La imagen no es válida. / The image is not valid.',
  too_large: 'La imagen es demasiado grande (máx. 5 MB). / The image is too large (max 5 MB).'
};

const uploadError = (reason, cause) =>
  new AppError(MESSAGES[reason], IMAGE_UPLOAD_ERROR_CODE, 422, {
    reason,
    cause: cause?.message
  });

export const isImageUploadError = (error) => error?.code === IMAGE_UPLOAD_ERROR_CODE;

/** Translation key (ES/EN.json) for a given image upload error. */
export const getImageUploadMessageKey = (error) => {
  const reason = error?.context?.reason;
  if (reason === 'too_large') return 'images.tooLarge';
  if (reason === 'invalid_image') return 'images.invalidImage';
  return 'images.uploadFailed';
};

// product-images rejects image/webp (bucket allowed_mime_types). Flip to 'image/webp' only after the
// migration 20261105100000_product_images_allow_webp.sql is applied to production.
export const PRODUCT_IMAGES_FORMAT = 'image/jpeg';

/**
 * Resize (longest side <= 1200px) and encode as JPEG (~0.82), lowering the
 * quality if needed to stay under the bucket's 5 MB cap.
 * @returns {Promise<Blob|null>} null when nothing fits under the cap
 */
export const resizeToJpeg = async (blob) => {
  const bitmap = await loadBitmap(blob);
  return encodeWithinLimit(drawScaled(bitmap, { maxSide: MAX_IMAGE_DIMENSION, format: 'image/jpeg' }));
};

/** WebP variant (same 1200 px catalog preset); falls back to JPEG when the browser cannot encode WebP. */
export const resizeToWebp = async (blob) => {
  const optimized = await optimizeImage(blob, IMAGE_PRESETS.catalog);
  return optimized.type === 'image/webp' ? optimized : resizeToJpeg(blob);
};

const resizeForProductImages = (blob) => (PRODUCT_IMAGES_FORMAT === 'image/webp' ? resizeToWebp(blob) : resizeToJpeg(blob));

/**
 * @param {string|Blob|null|undefined} value data URI / File / Blob / existing URL / empty
 * @param {{folder: string, id: string, resize?: Function, upload?: Function}} options
 * @returns {Promise<string|null|undefined>} the value to persist in image_url
 * @throws {AppError} IMAGE_UPLOAD_FAILED when a new image cannot be uploaded
 */
export const resolveImageUrl = async (
  value,
  { folder, id, resize = resizeForProductImages, upload = uploadProductImage } = {}
) => {
  const isBlob = typeof Blob !== 'undefined' && value instanceof Blob;
  if (!isBlob && !isDataUri(value)) {
    // Empty values and existing URLs (http/https or any non-data string) are kept as they are
    return value;
  }

  const source = isBlob ? value : dataUriToBlob(value);
  if (!source) throw uploadError('invalid_image');

  let resized;
  try {
    resized = await resize(source);
  } catch (error) {
    throw uploadError('invalid_image', error);
  }
  if (!resized) throw uploadError('too_large');

  try {
    const path = buildImagePath(folder, id, { ext: resized.type === 'image/webp' ? 'webp' : 'jpg' });
    const { publicUrl } = await upload(resized, path);
    if (!publicUrl) throw new Error('Storage returned no public URL');
    return publicUrl;
  } catch (error) {
    throw uploadError('upload_failed', error);
  }
};
