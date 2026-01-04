import { supabase } from './supabase';

const BUCKET_NAME = 'product-images';

/**
 * Normalize a storage path from a public URL or raw filename.
 * This ensures we can delete files even when the DB stores full public URLs.
 */
export const extractStoragePath = (publicUrl) => {
  if (!publicUrl) return null;

  try {
    const url = new URL(publicUrl);
    const [, path] = url.pathname.split('/object/public/');
    if (path) return decodeURIComponent(path);
  } catch {
    // Ignore parsing errors and fall back to string operations
  }

  const afterObject = publicUrl.split('/object/public/')[1];
  if (afterObject) return afterObject;

  return publicUrl.split('/').pop();
};

export const uploadProductImage = async (file, fileName) => {
  if (!file) {
    throw new Error('A valid file is required to upload an image.');
  }

  try {
    const extensionFromType = file.type?.split('/')[1];
    const extensionFromName = typeof file.name === 'string'
      ? file.name.split('.').pop()
      : null;

    const normalizedName = fileName?.includes('.')
      ? fileName
      : `${fileName}.${extensionFromType || extensionFromName || 'jpg'}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(normalizedName, file, {
        cacheControl: '3600',
        upsert: true,
        contentType: file.type || 'image/jpeg'
      });

    if (uploadError) throw uploadError;

    const { data } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(normalizedName);

    return { publicUrl: data?.publicUrl, path: normalizedName };
  } catch (error) {
    console.error('Error uploading image:', error);
    throw error;
  }
};

export const deleteProductImage = async (filePath) => {
  try {
    const path = extractStoragePath(filePath);
    if (!path) return;

    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([path]);

    if (error) throw error;
  } catch (error) {
    console.error('Error deleting image:', error);
    throw error;
  }
};

export const getImageUrl = (filePath) => {
  if (!filePath) return null;
  const { data: { publicUrl } } = supabase.storage
    .from(BUCKET_NAME)
    .getPublicUrl(filePath);
  return publicUrl;
};
