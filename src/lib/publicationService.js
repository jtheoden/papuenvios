/**
 * Publication Service
 * CRUD operations for platform guide articles stored in the publications table
 */

import { supabase } from '@/lib/supabase';
import { validateImage } from '@/lib/imageUtils';
import { optimizeImage, withExtension, IMAGE_PRESETS, LONG_CACHE_CONTROL } from '@/lib/imageOptimizer';

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
 * Get all publications (including inactive) for admin management.
 * Returns null (not []) when the read fails, so callers can tell "failed" from "empty".
 */
export async function getAllPublications() {
  const { data, error } = await supabase
    .from('publications')
    .select('*')
    .order('display_order', { ascending: true });

  if (error) {
    console.error('[PublicationService] getAllPublications error:', error);
    return null;
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
    // PGRST116: the row no longer exists (e.g. another admin deleted it)
    return { success: false, error: error.message, notFound: error.code === 'PGRST116' };
  }
  return { success: true, data: result };
}

/**
 * Delete a publication and then its cover image (the image is kept if the row delete fails)
 */
export async function deletePublication(id, coverImageUrl) {
  const { data, error } = await supabase
    .from('publications')
    .delete()
    .eq('id', id)
    .select('id');

  if (error) {
    console.error('[PublicationService] deletePublication error:', error);
    return { success: false, error: error.message };
  }
  // RLS can filter the delete to 0 rows without an error: that is not a success
  if (!data || data.length === 0) {
    return { success: false, error: 'No rows deleted (not found or no permission)' };
  }

  if (coverImageUrl) {
    await deletePublicationImage(coverImageUrl);
  }
  return { success: true };
}

/**
 * Upload a publication cover image to Supabase Storage
 * Processes the image first (resize/compress) then uploads
 */
export async function uploadPublicationImage(file) {
  try {
    const validation = validateImage(file, 'publication');
    if (!validation.valid) throw new Error(validation.errors.join('\n'));

    // Resize + WebP (GIFs keep their animation and are uploaded as they are)
    const optimized = await optimizeImage(file, IMAGE_PRESETS.catalog);
    const ext = withExtension('', optimized.type).split('.').pop();
    const fileName = `cover_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(fileName, optimized, {
        cacheControl: LONG_CACHE_CONTROL, // unique name per upload
        upsert: false,
        contentType: optimized.type
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
    const marker = '/object/public/publications/';
    const { pathname } = new URL(publicUrl);
    const idx = pathname.indexOf(marker);
    if (idx === -1) {
      // External or non-storage url: never call remove() with a full url
      console.warn('[PublicationService] deleteImage skipped, not a publications storage url:', publicUrl);
      return;
    }
    const path = decodeURIComponent(pathname.slice(idx + marker.length));

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

  const failedIds = [];
  const failedTitles = [];
  const missingIds = [];
  const created = {};
  let failedCount = 0;

  // Delete removed publications
  for (const id of deletedIds) {
    const original = originalPublications.find(p => p.id === id);
    const result = await deletePublication(id, original?.cover_image_url);
    if (!result.success) {
      failedCount += 1;
      failedIds.push(id);
      failedTitles.push(original?.title_es || original?.title_en || '');
    }
  }

  // Update or create publications
  for (let i = 0; i < publications.length; i++) {
    const pub = { ...publications[i], display_order: i };
    delete pub._isNew;
    const localId = publications[i].id;

    let result;
    if (pub.id && originalIds.has(pub.id)) {
      result = await updatePublication(pub.id, {
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
      // The replaced/removed cover is deleted only once the row update has succeeded
      const oldCover = originalPublications.find(o => o.id === pub.id)?.cover_image_url;
      if (result.success && oldCover && oldCover !== pub.cover_image_url) {
        await deletePublicationImage(oldCover);
      }
    } else {
      const { id, ...newPub } = pub;
      result = await createPublication(newPub);
      if (result.success) created[localId] = result.data;
    }

    if (!result.success) {
      failedCount += 1;
      failedIds.push(localId);
      failedTitles.push(pub.title_es || pub.title_en || '');
      if (result.notFound) missingIds.push(localId);
    }
  }

  return failedCount
    ? { success: false, failedCount, failedIds, failedTitles, missingIds, created }
    : { success: true, failedCount: 0, failedIds, failedTitles, missingIds, created };
}

/**
 * After a partial save: take the fresh DB rows and re-apply the local (unsaved) version of the rows
 * that failed, so the user keeps what was typed. A failed local row that is not in the fresh read
 * (never created, or deleted by someone else) is put back flagged _isNew so a retry creates it.
 * Rows that were created come back from the DB with their real id, so a retry does not duplicate them.
 */
export function mergeAfterPartialSave(freshRows, localRows, result) {
  const failed = new Set(result?.failedIds || []);
  const localById = new Map(localRows.map(p => [p.id, p]));
  const freshIds = new Set(freshRows.map(p => p.id));
  const merged = freshRows.map(p => (failed.has(p.id) && localById.has(p.id) ? localById.get(p.id) : p));
  const missing = localRows
    .filter(p => failed.has(p.id) && !freshIds.has(p.id))
    .map(p => (p._isNew ? p : { ...p, _isNew: true }));
  return [...merged, ...missing];
}

/**
 * Apply a save result to the local state without re-reading the server: created rows replace their
 * temporary ones (real id, no _isNew), deleted originals are dropped and failed deletes come back.
 * Returns the new list and the new "original" snapshot used to compute the next diff.
 */
export function applySaveResult(localRows, originalRows, result) {
  const failed = new Set(result?.failedIds || []);
  const created = result?.created || {};
  const publications = localRows.map(p => created[p.id] || p);
  const localIds = new Set(localRows.map(p => p.id));
  const origById = new Map(originalRows.map(p => [p.id, p]));
  const readded = originalRows.filter(o => !localIds.has(o.id) && failed.has(o.id));
  const originals = [];
  for (const p of publications) {
    if (failed.has(p.id)) {
      if (origById.has(p.id)) originals.push(origById.get(p.id));
    } else if (!p._isNew) {
      originals.push(p);
    }
  }
  return { publications: [...publications, ...readded], originals: [...originals, ...readded] };
}
