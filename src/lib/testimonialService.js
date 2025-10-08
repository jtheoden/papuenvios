import { supabase } from './supabase';

/**
 * Testimonials Service
 * Handles CRUD operations for testimonials table
 * Following project standards: UUID-based, bilingual, RLS-secured
 */

/**
 * Get all testimonials (public + admin)
 * Public: only visible and verified testimonials
 * Admin: all testimonials
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

    const { data, error } = await query;

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error fetching testimonials:', error);
    return { data: null, error };
  }
};

/**
 * Get a single testimonial by ID
 */
export const getTestimonialById = async (id) => {
  try {
    const { data, error } = await supabase
      .from('testimonials')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error fetching testimonial:', error);
    return { data: null, error };
  }
};

/**
 * Create a new testimonial
 */
export const createTestimonial = async (testimonialData) => {
  try {
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

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error creating testimonial:', error);
    return { data: null, error };
  }
};

/**
 * Update testimonial (admin only - RLS enforced)
 */
export const updateTestimonial = async (id, updates) => {
  try {
    const { data, error } = await supabase
      .from('testimonials')
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
    console.error('Error updating testimonial:', error);
    return { data: null, error };
  }
};

/**
 * Toggle testimonial visibility
 */
export const toggleTestimonialVisibility = async (id, isVisible) => {
  try {
    const { data, error } = await supabase
      .from('testimonials')
      .update({
        is_visible: isVisible,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error toggling testimonial visibility:', error);
    return { data: null, error };
  }
};

/**
 * Toggle testimonial featured status (admin only)
 * Note: Using is_featured since is_verified doesn't exist in schema
 */
export const toggleTestimonialVerification = async (id, isFeatured) => {
  try {
    const { data, error } = await supabase
      .from('testimonials')
      .update({
        is_featured: isFeatured,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error toggling testimonial featured status:', error);
    return { data: null, error };
  }
};

/**
 * Toggle featured status (admin only)
 */
export const toggleTestimonialFeatured = async (id, isFeatured) => {
  try {
    const { data, error } = await supabase
      .from('testimonials')
      .update({
        is_featured: isFeatured,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error toggling testimonial featured status:', error);
    return { data: null, error };
  }
};

/**
 * Update testimonial user photo
 */
export const updateTestimonialPhoto = async (id, photoUrl) => {
  try {
    const { data, error } = await supabase
      .from('testimonials')
      .update({
        user_photo: photoUrl,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error updating testimonial photo:', error);
    return { data: null, error };
  }
};

/**
 * Soft delete testimonial (set is_visible to false)
 */
export const deleteTestimonial = async (id) => {
  try {
    const { error } = await supabase
      .from('testimonials')
      .update({
        is_visible: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (error) throw error;
    return { data: true, error: null };
  } catch (error) {
    console.error('Error deleting testimonial:', error);
    return { data: null, error };
  }
};

/**
 * Get featured testimonials for homepage
 */
export const getFeaturedTestimonials = async () => {
  try {
    const { data, error } = await supabase
      .from('testimonials')
      .select('*')
      .eq('is_visible', true)
      .eq('is_featured', true)
      .order('created_at', { ascending: false })
      .limit(6);

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error fetching featured testimonials:', error);
    return { data: null, error };
  }
};
