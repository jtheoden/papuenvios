import { supabase } from './supabase';

/**
 * Carousel Slides Service
 * Handles CRUD operations for carousel_slides table
 * Following project standards: UUID-based, bilingual, RLS-secured
 */

/**
 * Get all carousel slides
 * Can filter by active status and check date validity
 */
export const getCarouselSlides = async (activeOnly = false) => {
  try {
    let query = supabase
      .from('carousel_slides')
      .select('*')
      .order('display_order', { ascending: true });

    if (activeOnly) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error fetching carousel slides:', error);
    return { data: null, error };
  }
};

/**
 * Get a single carousel slide by ID
 */
export const getCarouselSlideById = async (id) => {
  try {
    const { data, error } = await supabase
      .from('carousel_slides')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error fetching carousel slide:', error);
    return { data: null, error };
  }
};

/**
 * Create a new carousel slide
 */
export const createCarouselSlide = async (slideData) => {
  try {
    // Get max display_order to add new slide at the end
    const { data: slides } = await supabase
      .from('carousel_slides')
      .select('display_order')
      .order('display_order', { ascending: false })
      .limit(1);

    const nextOrder = slides && slides.length > 0 ? slides[0].display_order + 1 : 0;

    const { data, error } = await supabase
      .from('carousel_slides')
      .insert([{
        title_es: slideData.title_es || '',
        title_en: slideData.title_en || '',
        subtitle_es: slideData.subtitle_es || null,
        subtitle_en: slideData.subtitle_en || null,
        image_url: slideData.image_url || null,
        image_file: slideData.image_file || null,
        link_url: slideData.link_url || null,
        display_order: slideData.display_order ?? nextOrder,
        is_active: slideData.is_active ?? true
      }])
      .select()
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error creating carousel slide:', error);
    return { data: null, error };
  }
};

/**
 * Update carousel slide
 */
export const updateCarouselSlide = async (id, updates) => {
  try {
    const { data, error } = await supabase
      .from('carousel_slides')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error updating carousel slide:', error);
    return { data: null, error };
  }
};

/**
 * Toggle carousel slide active status
 */
export const toggleCarouselSlideActive = async (id, isActive) => {
  try {
    const { data, error } = await supabase
      .from('carousel_slides')
      .update({
        is_active: isActive,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error toggling carousel slide:', error);
    return { data: null, error };
  }
};

/**
 * Update slide display order
 */
export const updateSlideOrder = async (id, newOrder) => {
  try {
    const { data, error } = await supabase
      .from('carousel_slides')
      .update({
        display_order: newOrder,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error updating slide order:', error);
    return { data: null, error };
  }
};

/**
 * Reorder all slides (bulk update)
 */
export const reorderSlides = async (slideOrderArray) => {
  try {
    // slideOrderArray should be: [{ id: uuid, display_order: number }, ...]
    const promises = slideOrderArray.map(({ id, display_order }) =>
      supabase
        .from('carousel_slides')
        .update({
          display_order,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
    );

    const results = await Promise.all(promises);
    const errors = results.filter(r => r.error);

    if (errors.length > 0) {
      throw errors[0].error;
    }

    return { data: true, error: null };
  } catch (error) {
    console.error('Error reordering slides:', error);
    return { data: null, error };
  }
};

/**
 * Delete carousel slide (soft delete via is_active = false)
 */
export const deleteCarouselSlide = async (id) => {
  try {
    const { error } = await supabase
      .from('carousel_slides')
      .update({
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (error) throw error;
    return { data: true, error: null };
  } catch (error) {
    console.error('Error deleting carousel slide:', error);
    return { data: null, error };
  }
};

/**
 * Hard delete carousel slide (permanent removal)
 * Use with caution!
 */
export const hardDeleteCarouselSlide = async (id) => {
  try {
    const { error } = await supabase
      .from('carousel_slides')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return { data: true, error: null };
  } catch (error) {
    console.error('Error hard deleting carousel slide:', error);
    return { data: null, error };
  }
};

/**
 * Get active slides for public display
 * Respects active status
 */
export const getActiveCarouselSlides = async () => {
  try {
    const { data, error } = await supabase
      .from('carousel_slides')
      .select('*')
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error fetching active carousel slides:', error);
    return { data: null, error };
  }
};
