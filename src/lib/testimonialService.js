import { supabase } from './supabase';
import {
  handleError,
  logError,
  createValidationError,
  createNotFoundError,
  parseSupabaseError,
  ERROR_CODES
} from './errorHandler';

/**
 * Testimonials Service
 * Handles CRUD operations for testimonials table
 * Following project standards: UUID-based, bilingual, RLS-secured
 * Uses standardized error handling with AppError class
 */

/**
 * Get all testimonials (public + admin)
 * Public: only visible testimonials
 * Admin: all testimonials
 *
 * SECURITY: Uses secure RPC function get_testimonial_author_profiles()
 * - Only exposes: user_id, full_name, avatar_url
 * - Protected fields (never exposed): email, phone, address, city, birth_date, preferences
 * - Prevents direct table access that would expose sensitive user data
 *
 * @param {boolean} adminView - Show all testimonials (true) or only visible (false)
 * @throws {AppError} If database query fails
 * @returns {Promise<Array>} Array of testimonials with user profiles
 */
export const getTestimonials = async (adminView = false) => {
  try {
    let query = supabase
      .from('testimonials')
      .select('*')
      .order('created_at', { ascending: false });

    // Public view: only show visible testimonials
    if (!adminView) {
      query = query.eq('is_visible', true);
    }

    const { data: testimonials, error } = await query;

    if (error) {
      const appError = parseSupabaseError(error);
      logError(appError, { operation: 'getTestimonials', adminView });
      throw appError;
    }

    // Fetch user profiles using secure RPC function
    if (testimonials && testimonials.length > 0) {
      const userIds = [...new Set(testimonials.map(t => t.user_id))];

      const { data: profiles, error: profileError } = await supabase
        .rpc('get_testimonial_author_profiles', {
          p_user_ids: userIds
        });

      if (profileError) {
        // Log warning but don't fail - graceful fallback
        const appError = parseSupabaseError(profileError);
        logError(appError, { operation: 'getTestimonials - RPC profiles', userCount: userIds.length });
      } else if (profiles) {
        // Create a map and attach profiles to testimonials
        const profileMap = {};
        profiles.forEach(profile => {
          profileMap[profile.user_id] = profile;
        });

        testimonials.forEach(testimonial => {
          const profile = profileMap[testimonial.user_id];
          testimonial.user_name = profile?.full_name || 'Usuario';
          testimonial.user_avatar = profile?.avatar_url || testimonial.user_photo;
        });
      }
    }

    return testimonials;
  } catch (error) {
    if (error.code) throw error; // Already an AppError
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getTestimonials' });
    throw appError;
  }
};

/**
 * Get a single testimonial by ID
 * @param {string} id - Testimonial ID
 * @throws {AppError} If testimonial not found or query fails
 * @returns {Promise<Object>} Testimonial details
 */
export const getTestimonialById = async (id) => {
  try {
    if (!id) {
      throw createValidationError({ id: 'Testimonial ID is required' });
    }

    const { data, error } = await supabase
      .from('testimonials')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      const appError = parseSupabaseError(error);
      if (!data) {
        throw createNotFoundError('Testimonial', id);
      }
      logError(appError, { operation: 'getTestimonialById', testimonialId: id });
      throw appError;
    }

    return data;
  } catch (error) {
    if (error.code) throw error; // Already an AppError
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getTestimonialById', id });
    throw appError;
  }
};

/**
 * Create a new testimonial
 * Testimonials start as non-visible and must be approved by admin
 *
 * @param {Object} testimonialData - Testimonial creation data
 * @throws {AppError} If validation fails or creation fails
 * @returns {Promise<Object>} Created testimonial
 */
export const createTestimonial = async (testimonialData) => {
  try {
    if (!testimonialData.user_id) {
      throw createValidationError({ user_id: 'User ID is required' });
    }

    if (!testimonialData.comment) {
      throw createValidationError({ comment: 'Comment is required' });
    }

    if (!testimonialData.rating || testimonialData.rating < 1 || testimonialData.rating > 5) {
      throw createValidationError({ rating: 'Rating must be between 1 and 5' });
    }

    const { data, error } = await supabase
      .from('testimonials')
      .insert([{
        user_id: testimonialData.user_id,
        order_id: testimonialData.order_id || null,
        rating: testimonialData.rating,
        comment: testimonialData.comment,
        user_photo: testimonialData.user_photo || null,
        is_visible: false,  // Must be approved by admin
        is_featured: false
      }])
      .select()
      .single();

    if (error) {
      const appError = parseSupabaseError(error);
      logError(appError, {
        operation: 'createTestimonial',
        userId: testimonialData.user_id,
        rating: testimonialData.rating
      });
      throw appError;
    }

    return data;
  } catch (error) {
    if (error.code) throw error; // Already an AppError
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'createTestimonial' });
    throw appError;
  }
};

/**
 * Helper function to update a testimonial field
 * @private
 */
const _updateTestimonialField = async (id, updates, operation) => {
  if (!id) {
    throw createValidationError({ id: 'Testimonial ID is required' });
  }

  const { data, error } = await supabase
    .from('testimonials')
    .update({
      ...updates,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    const appError = parseSupabaseError(error);
    if (!data) {
      throw createNotFoundError('Testimonial', id);
    }
    logError(appError, { operation, testimonialId: id, ...updates });
    throw appError;
  }

  return data;
};

/**
 * Update testimonial (admin only - RLS enforced)
 * @param {string} id - Testimonial ID
 * @param {Object} updates - Fields to update
 * @throws {AppError} If update fails
 * @returns {Promise<Object>} Updated testimonial
 */
export const updateTestimonial = async (id, updates) => {
  try {
    return await _updateTestimonialField(id, updates, 'updateTestimonial');
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'updateTestimonial', id });
    throw appError;
  }
};

/**
 * Toggle testimonial visibility
 * @param {string} id - Testimonial ID
 * @param {boolean} isVisible - New visibility status
 * @throws {AppError} If update fails
 * @returns {Promise<Object>} Updated testimonial
 */
export const toggleTestimonialVisibility = async (id, isVisible) => {
  try {
    return await _updateTestimonialField(
      id,
      { is_visible: isVisible },
      'toggleTestimonialVisibility'
    );
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, {
      operation: 'toggleTestimonialVisibility',
      id,
      isVisible
    });
    throw appError;
  }
};

/**
 * Toggle testimonial featured status (admin only)
 * Uses is_featured field (is_verified does not exist in schema)
 *
 * @param {string} id - Testimonial ID
 * @param {boolean} isFeatured - New featured status
 * @throws {AppError} If update fails
 * @returns {Promise<Object>} Updated testimonial
 */
export const toggleTestimonialVerification = async (id, isFeatured) => {
  try {
    return await _updateTestimonialField(
      id,
      { is_featured: isFeatured },
      'toggleTestimonialVerification'
    );
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, {
      operation: 'toggleTestimonialVerification',
      id,
      isFeatured
    });
    throw appError;
  }
};

/**
 * Toggle featured status (admin only) - alias for toggleTestimonialVerification
 * @param {string} id - Testimonial ID
 * @param {boolean} isFeatured - New featured status
 * @throws {AppError} If update fails
 * @returns {Promise<Object>} Updated testimonial
 */
export const toggleTestimonialFeatured = async (id, isFeatured) => {
  return toggleTestimonialVerification(id, isFeatured);
};

/**
 * Update testimonial user photo
 * @param {string} id - Testimonial ID
 * @param {string} photoUrl - New photo URL
 * @throws {AppError} If update fails
 * @returns {Promise<Object>} Updated testimonial
 */
export const updateTestimonialPhoto = async (id, photoUrl) => {
  try {
    if (!photoUrl) {
      throw createValidationError({ photoUrl: 'Photo URL is required' });
    }

    return await _updateTestimonialField(
      id,
      { user_photo: photoUrl },
      'updateTestimonialPhoto'
    );
  } catch (error) {
    if (error.code) throw error;
    const appError = handleError(error, ERROR_CODES.DB_ERROR, {
      operation: 'updateTestimonialPhoto',
      id
    });
    throw appError;
  }
};

/**
 * Delete testimonial (soft delete by setting is_visible to false)
 * @param {string} id - Testimonial ID
 * @throws {AppError} If deletion fails
 * @returns {Promise<boolean>} True if deletion successful
 */
export const deleteTestimonial = async (id) => {
  try {
    if (!id) {
      throw createValidationError({ id: 'Testimonial ID is required' });
    }

    const { error } = await supabase
      .from('testimonials')
      .update({
        is_visible: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (error) {
      const appError = parseSupabaseError(error);
      logError(appError, { operation: 'deleteTestimonial', testimonialId: id });
      throw appError;
    }

    return true;
  } catch (error) {
    if (error.code) throw error; // Already an AppError
    const appError = handleError(error, ERROR_CODES.DB_ERROR, {
      operation: 'deleteTestimonial',
      id
    });
    throw appError;
  }
};

/**
 * Get featured testimonials for homepage (max 6)
 * SECURITY: Uses secure RPC function get_testimonial_author_profiles()
 * - Only exposes: user_id, full_name, avatar_url
 * - Protected fields (never exposed): email, phone, address, city, birth_date, preferences
 *
 * @throws {AppError} If database query fails
 * @returns {Promise<Array>} Array of featured testimonials with user profiles
 */
export const getFeaturedTestimonials = async () => {
  try {
    const { data: testimonials, error } = await supabase
      .from('testimonials')
      .select('*')
      .eq('is_visible', true)
      .eq('is_featured', true)
      .order('created_at', { ascending: false })
      .limit(6);

    if (error) {
      const appError = parseSupabaseError(error);
      logError(appError, { operation: 'getFeaturedTestimonials' });
      throw appError;
    }

    // Fetch user profiles using secure RPC function
    if (testimonials && testimonials.length > 0) {
      const userIds = [...new Set(testimonials.map(t => t.user_id))];

      const { data: profiles, error: profileError } = await supabase
        .rpc('get_testimonial_author_profiles', {
          p_user_ids: userIds
        });

      if (profileError) {
        // Log warning but don't fail - graceful fallback
        const appError = parseSupabaseError(profileError);
        logError(appError, {
          operation: 'getFeaturedTestimonials - RPC profiles',
          userCount: userIds.length
        });
      } else if (profiles) {
        const profileMap = {};
        profiles.forEach(profile => {
          profileMap[profile.user_id] = profile;
        });

        testimonials.forEach(testimonial => {
          const profile = profileMap[testimonial.user_id];
          testimonial.user_name = profile?.full_name || 'Usuario';
          testimonial.user_avatar = profile?.avatar_url || testimonial.user_photo;
        });
      }
    }

    return testimonials;
  } catch (error) {
    if (error.code) throw error; // Already an AppError
    const appError = handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getFeaturedTestimonials' });
    throw appError;
  }
};

/**
 * Get user's own testimonial (if exists)
 * @param {string} userId - User ID
 * @throws {AppError} If database query fails
 * @returns {Promise<Object|null>} User's testimonial or null
 */
export const getUserTestimonial = async (userId) => {
  try {
    if (!userId) {
      throw createValidationError({ userId: 'User ID is required' });
    }

    const { data, error } = await supabase
      .from('testimonials')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      const appError = parseSupabaseError(error);
      logError(appError, { operation: 'getUserTestimonial', userId });
      throw appError;
    }

    return data;
  } catch (error) {
    if (error.code) throw error; // Already an AppError
    const appError = handleError(error, ERROR_CODES.DB_ERROR, {
      operation: 'getUserTestimonial',
      userId
    });
    throw appError;
  }
};

/**
 * Import path:
 * import { getTestimonials, createTestimonial, updateTestimonial, deleteTestimonial, getFeaturedTestimonials, getUserTestimonial } from '@/lib/testimonialService';
 *
 * Usage examples:
 *
 * // Get all testimonials (public view only)
 * try {
 *   const testimonials = await getTestimonials(false);
 * } catch (error) {
 *   if (error.code === 'DB_ERROR') {
 *     // Handle database error
 *   }
 * }
 *
 * // Create testimonial
 * try {
 *   const newTestimonial = await createTestimonial({
 *     user_id: 'user-123',
 *     rating: 5,
 *     comment: 'Great service!',
 *     order_id: 'order-456'
 *   });
 * } catch (error) {
 *   if (error.code === 'VALIDATION_FAILED') {
 *     console.log(error.context.fieldErrors);
 *   }
 * }
 *
 * // Get featured for homepage
 * const featured = await getFeaturedTestimonials();
 */
