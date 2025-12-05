import { supabase } from './supabase';
import {
  handleError, logError, createValidationError,
  createNotFoundError, parseSupabaseError, ERROR_CODES
} from './errorHandler';

/**
 * Carousel Slides Service
 * Handles CRUD operations for carousel_slides table
 * Following project standards: UUID-based, bilingual, RLS-secured
 */

/**
 * Get all carousel slides
 * @param {boolean} [activeOnly=false] - Filter by active status
 * @returns {Promise<Array>} Carousel slides ordered by display_order
 * @throws {AppError} DB_ERROR if query fails
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

    if (error) {
      throw parseSupabaseError(error);
    }

    return data || [];
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getCarouselSlides', activeOnly });
    logError(appError, { operation: 'getCarouselSlides', activeOnly });
    throw appError;
  }
};

/**
 * Get a single carousel slide by ID
 * @param {string} id - Slide ID
 * @returns {Promise<Object>} Carousel slide
 * @throws {AppError} VALIDATION_FAILED if id missing, NOT_FOUND if not found, DB_ERROR on failure
 */
export const getCarouselSlideById = async (id) => {
  try {
    if (!id) {
      throw createValidationError({ id: 'Slide ID is required' }, 'Missing slide ID');
    }

    const { data, error } = await supabase
      .from('carousel_slides')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw createNotFoundError('Carousel slide', id);
      }
      throw parseSupabaseError(error);
    }

    return data;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getCarouselSlideById', id });
    logError(appError, { operation: 'getCarouselSlideById', id });
    throw appError;
  }
};

/**
 * Create a new carousel slide
 * @param {Object} slideData - Slide information
 * @param {string} slideData.title_es - Spanish title
 * @param {string} slideData.title_en - English title
 * @param {string} [slideData.subtitle_es] - Spanish subtitle
 * @param {string} [slideData.subtitle_en] - English subtitle
 * @param {string} [slideData.image_url] - Image URL
 * @param {string} [slideData.image_file] - Image file reference
 * @param {string} [slideData.link_url] - Link URL
 * @param {number} [slideData.display_order] - Display order (auto-assigned if omitted)
 * @param {boolean} [slideData.is_active] - Active status (default: true)
 * @returns {Promise<Object>} Created carousel slide
 * @throws {AppError} VALIDATION_FAILED if required fields missing, DB_ERROR on failure
 */
export const createCarouselSlide = async (slideData) => {
  try {
    if (!slideData.title_es && !slideData.title_en) {
      throw createValidationError({ title: 'At least one language title is required' }, 'Missing required field');
    }

    // Get max display_order to add new slide at the end
    const { data: slides, error: orderError } = await supabase
      .from('carousel_slides')
      .select('display_order')
      .order('display_order', { ascending: false })
      .limit(1);

    if (orderError) {
      // Graceful fallback: use 0 if order fetch fails
      logError({ code: 'DB_ERROR', message: orderError.message }, { operation: 'createCarouselSlide - order fetch' });
    }

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

    if (error) {
      throw parseSupabaseError(error);
    }

    return data;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'createCarouselSlide' });
    logError(appError, { operation: 'createCarouselSlide' });
    throw appError;
  }
};

/**
 * Update carousel slide
 * @param {string} id - Slide ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated carousel slide
 * @throws {AppError} VALIDATION_FAILED if id missing, NOT_FOUND if not found, DB_ERROR on failure
 */
export const updateCarouselSlide = async (id, updates) => {
  try {
    if (!id) {
      throw createValidationError({ id: 'Slide ID is required' }, 'Missing slide ID');
    }

    const { data, error } = await supabase
      .from('carousel_slides')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw createNotFoundError('Carousel slide', id);
      }
      throw parseSupabaseError(error);
    }

    return data;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'updateCarouselSlide', id });
    logError(appError, { operation: 'updateCarouselSlide', id });
    throw appError;
  }
};

/**
 * Toggle carousel slide active status
 * @param {string} id - Slide ID
 * @param {boolean} isActive - Active status
 * @returns {Promise<Object>} Updated carousel slide
 * @throws {AppError} VALIDATION_FAILED if id missing, NOT_FOUND if not found, DB_ERROR on failure
 */
export const toggleCarouselSlideActive = async (id, isActive) => {
  try {
    if (!id) {
      throw createValidationError({ id: 'Slide ID is required' }, 'Missing slide ID');
    }

    const { data, error } = await supabase
      .from('carousel_slides')
      .update({
        is_active: isActive,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw createNotFoundError('Carousel slide', id);
      }
      throw parseSupabaseError(error);
    }

    return data;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'toggleCarouselSlideActive', id });
    logError(appError, { operation: 'toggleCarouselSlideActive', id });
    throw appError;
  }
};

/**
 * Update slide display order
 * @param {string} id - Slide ID
 * @param {number} newOrder - New display order
 * @returns {Promise<Object>} Updated carousel slide
 * @throws {AppError} VALIDATION_FAILED if id/order invalid, NOT_FOUND if not found, DB_ERROR on failure
 */
export const updateSlideOrder = async (id, newOrder) => {
  try {
    if (!id) {
      throw createValidationError({ id: 'Slide ID is required' }, 'Missing slide ID');
    }
    if (newOrder === undefined || newOrder === null) {
      throw createValidationError({ display_order: 'Display order is required' }, 'Missing display order');
    }

    const { data, error } = await supabase
      .from('carousel_slides')
      .update({
        display_order: newOrder,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw createNotFoundError('Carousel slide', id);
      }
      throw parseSupabaseError(error);
    }

    return data;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'updateSlideOrder', id });
    logError(appError, { operation: 'updateSlideOrder', id });
    throw appError;
  }
};

/**
 * Reorder all slides (bulk update)
 * @param {Array} slideOrderArray - Array of {id, display_order} objects
 * @param {string} slideOrderArray[].id - Slide ID
 * @param {number} slideOrderArray[].display_order - Display order
 * @returns {Promise<boolean>} Success indicator
 * @throws {AppError} VALIDATION_FAILED if array invalid, DB_ERROR on failure
 */
export const reorderSlides = async (slideOrderArray) => {
  try {
    if (!Array.isArray(slideOrderArray) || slideOrderArray.length === 0) {
      throw createValidationError({ slideOrderArray: 'Array of slides with IDs and orders is required' }, 'Invalid slides array');
    }

    // slideOrderArray should be: [{ id: uuid, display_order: number }, ...]
    const promises = slideOrderArray.map(({ id, display_order }) => {
      if (!id) {
        throw createValidationError({ id: 'Slide ID is required for all items' }, 'Missing slide ID');
      }
      if (display_order === undefined || display_order === null) {
        throw createValidationError({ display_order: 'Display order is required for all items' }, 'Missing display order');
      }
      return supabase
        .from('carousel_slides')
        .update({
          display_order,
          updated_at: new Date().toISOString()
        })
        .eq('id', id);
    });

    const results = await Promise.all(promises);
    const errors = results.filter(r => r.error);

    if (errors.length > 0) {
      throw parseSupabaseError(errors[0].error);
    }

    return true;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'reorderSlides', count: slideOrderArray?.length });
    logError(appError, { operation: 'reorderSlides', count: slideOrderArray?.length });
    throw appError;
  }
};

/**
 * Delete carousel slide (soft delete via is_active = false)
 * @param {string} id - Slide ID
 * @returns {Promise<boolean>} Success indicator
 * @throws {AppError} VALIDATION_FAILED if id missing, NOT_FOUND if not found, DB_ERROR on failure
 */
export const deleteCarouselSlide = async (id) => {
  try {
    if (!id) {
      throw createValidationError({ id: 'Slide ID is required' }, 'Missing slide ID');
    }

    // Check existence first
    const { data: exists, error: checkError } = await supabase
      .from('carousel_slides')
      .select('id')
      .eq('id', id)
      .single();

    if (checkError) {
      if (checkError.code === 'PGRST116') {
        throw createNotFoundError('Carousel slide', id);
      }
      throw parseSupabaseError(checkError);
    }

    const { error } = await supabase
      .from('carousel_slides')
      .update({
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (error) {
      throw parseSupabaseError(error);
    }

    return true;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'deleteCarouselSlide', id });
    logError(appError, { operation: 'deleteCarouselSlide', id });
    throw appError;
  }
};

/**
 * Hard delete carousel slide (permanent removal)
 * ⚠️ Use with caution! This permanently removes the record.
 * @param {string} id - Slide ID
 * @returns {Promise<boolean>} Success indicator
 * @throws {AppError} VALIDATION_FAILED if id missing, NOT_FOUND if not found, DB_ERROR on failure
 */
export const hardDeleteCarouselSlide = async (id) => {
  try {
    if (!id) {
      throw createValidationError({ id: 'Slide ID is required' }, 'Missing slide ID');
    }

    // Check existence first
    const { data: exists, error: checkError } = await supabase
      .from('carousel_slides')
      .select('id')
      .eq('id', id)
      .single();

    if (checkError) {
      if (checkError.code === 'PGRST116') {
        throw createNotFoundError('Carousel slide', id);
      }
      throw parseSupabaseError(checkError);
    }

    const { error } = await supabase
      .from('carousel_slides')
      .delete()
      .eq('id', id);

    if (error) {
      throw parseSupabaseError(error);
    }

    return true;
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'hardDeleteCarouselSlide', id });
    logError(appError, { operation: 'hardDeleteCarouselSlide', id });
    throw appError;
  }
};

/**
 * Get active slides for public display
 * Respects active status and returns ordered by display_order
 * @returns {Promise<Array>} Active carousel slides ordered by display_order
 * @throws {AppError} DB_ERROR if query fails
 */
export const getActiveCarouselSlides = async () => {
  try {
    const { data, error } = await supabase
      .from('carousel_slides')
      .select('*')
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    if (error) {
      throw parseSupabaseError(error);
    }

    return data || [];
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getActiveCarouselSlides' });
    logError(appError, { operation: 'getActiveCarouselSlides' });
    throw appError;
  }
};
