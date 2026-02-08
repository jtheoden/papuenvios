/**
 * Publication Service
 * CRUD operations for platform guide articles stored in the publications table
 */

import { supabase } from '@/lib/supabase';
import { processImage } from '@/lib/imageUtils';

const BUCKET_NAME = 'publications';

/**
 * Get all active publications ordered by display_order
 */
export async function getPublications() {
  const { data, error } = await supabase
    .from('publications')
    .select('*')
    .eq('is_active', true)
    .order('display_order', { ascending: true });

  if (error) {
    console.error('[PublicationService] getPublications error:', error);
    return [];
  }
  return data || [];
}

/**
 * Get all publications (including inactive) for admin management
 */
export async function getAllPublications() {
  const { data, error } = await supabase
    .from('publications')
    .select('*')
    .order('display_order', { ascending: true });

  if (error) {
    console.error('[PublicationService] getAllPublications error:', error);
    return [];
  }
  return data || [];
}

/**
 * Get publications filtered by category
 */
export async function getPublicationsByCategory(category) {
  const query = supabase
    .from('publications')
    .select('*')
    .eq('is_active', true)
    .order('display_order', { ascending: true });

  if (category && category !== 'all') {
    query.eq('category', category);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[PublicationService] getPublicationsByCategory error:', error);
    return [];
  }
  return data || [];
}

/**
 * Create a new publication
 */
export async function createPublication(data) {
  const { data: result, error } = await supabase
    .from('publications')
    .insert(data)
    .select()
    .single();

  if (error) {
    console.error('[PublicationService] createPublication error:', error);
    return { success: false, error: error.message };
  }
  return { success: true, data: result };
}

/**
 * Update an existing publication
 */
export async function updatePublication(id, data) {
  const { data: result, error } = await supabase
    .from('publications')
    .update(data)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('[PublicationService] updatePublication error:', error);
    return { success: false, error: error.message };
  }
  return { success: true, data: result };
}

/**
 * Delete a publication and its cover image
 */
export async function deletePublication(id, coverImageUrl) {
  // Delete cover image from storage if exists
  if (coverImageUrl) {
    await deletePublicationImage(coverImageUrl);
  }

  const { error } = await supabase
    .from('publications')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('[PublicationService] deletePublication error:', error);
    return { success: false, error: error.message };
  }
  return { success: true };
}

/**
 * Upload a publication cover image to Supabase Storage
 * Processes the image first (resize/compress) then uploads
 */
export async function uploadPublicationImage(file) {
  try {
    // Process image (resize + compress)
    const processed = await processImage(file, 'publication');
    if (!processed.success) {
      throw new Error('Image processing failed');
    }

    const fileName = `cover_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.jpg`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(fileName, processed.blob, {
        cacheControl: '3600',
        upsert: false,
        contentType: 'image/jpeg'
      });

    if (uploadError) throw uploadError;

    const { data } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(fileName);

    return { success: true, publicUrl: data?.publicUrl, path: fileName };
  } catch (error) {
    console.error('[PublicationService] uploadImage error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Delete a publication image from storage
 */
export async function deletePublicationImage(publicUrl) {
  if (!publicUrl) return;

  try {
    // Extract path from public URL
    let path = publicUrl;
    const afterPublic = publicUrl.split('/object/public/publications/')[1];
    if (afterPublic) {
      path = decodeURIComponent(afterPublic);
    }

    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([path]);

    if (error) {
      console.error('[PublicationService] deleteImage error:', error);
    }
  } catch (error) {
    console.error('[PublicationService] deleteImage exception:', error);
  }
}

/**
 * Batch save publications (update existing, create new, delete removed)
 * Used by the admin settings form
 */
export async function saveAllPublications(publications, originalPublications) {
  const originalIds = new Set(originalPublications.map(p => p.id));
  const currentIds = new Set(publications.filter(p => p.id && !p._isNew).map(p => p.id));

  // Find deleted publications
  const deletedIds = [...originalIds].filter(id => !currentIds.has(id));

  // Delete removed publications
  for (const id of deletedIds) {
    const original = originalPublications.find(p => p.id === id);
    await deletePublication(id, original?.cover_image_url);
  }

  // Update or create publications
  for (let i = 0; i < publications.length; i++) {
    const pub = { ...publications[i], display_order: i };
    delete pub._isNew;

    if (pub.id && originalIds.has(pub.id)) {
      // Update existing
      await updatePublication(pub.id, {
        title_es: pub.title_es,
        title_en: pub.title_en,
        content_es: pub.content_es,
        content_en: pub.content_en,
        cover_image_url: pub.cover_image_url,
        video_url: pub.video_url,
        category: pub.category,
        is_active: pub.is_active,
        display_order: i
      });
    } else {
      // Create new
      const { id, ...newPub } = pub;
      newPub.display_order = i;
      await createPublication(newPub);
    }
  }

  return { success: true };
}
