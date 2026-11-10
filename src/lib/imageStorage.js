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
  fitWithin,
  encodeWithinLimit
} from './imageStoragePure';

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

const loadBitmap = async (blob) => {
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
 * Resize (longest side <= 1200px) and encode as JPEG (~0.82), lowering the
 * quality if needed to stay under the bucket's 5 MB cap.
 * @returns {Promise<Blob|null>} null when nothing fits under the cap
 */
export const resizeToJpeg = async (blob) => {
  const bitmap = await loadBitmap(blob);
  const { width, height } = fitWithin(bitmap.width, bitmap.height);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  // JPEG has no alpha: paint white under transparent PNGs
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  if (typeof bitmap.close === 'function') bitmap.close();

  return encodeWithinLimit(
    (quality) => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  );
};

/**
 * @param {string|Blob|null|undefined} value data URI / File / Blob / existing URL / empty
 * @param {{folder: string, id: string, resize?: Function, upload?: Function}} options
 * @returns {Promise<string|null|undefined>} the value to persist in image_url
 * @throws {AppError} IMAGE_UPLOAD_FAILED when a new image cannot be uploaded
 */
export const resolveImageUrl = async (
  value,
  { folder, id, resize = resizeToJpeg, upload = uploadProductImage } = {}
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
    const path = buildImagePath(folder, id);
    const { publicUrl } = await upload(resized, path);
    if (!publicUrl) throw new Error('Storage returned no public URL');
    return publicUrl;
  } catch (error) {
    throw uploadError('upload_failed', error);
  }
};
