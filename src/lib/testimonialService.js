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
 *
 * REVERTED: Back to 2-query approach due to FK relationship issue
 * testimonials.user_id → auth.users(id), not user_profiles directly
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

    if (error) throw error;

    // Fetch user profiles for all testimonials
    if (testimonials && testimonials.length > 0) {
      const userIds = [...new Set(testimonials.map(t => t.user_id))];

      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('user_id, full_name, avatar_url')
        .in('user_id', userIds);

      // Create a map and attach profiles to testimonials
      const profileMap = {};
      if (profiles) {
        profiles.forEach(profile => {
          profileMap[profile.user_id] = profile;
        });
      }

      testimonials.forEach(testimonial => {
        const profile = profileMap[testimonial.user_id];
        testimonial.user_name = profile?.full_name || 'Usuario';
        testimonial.user_avatar = profile?.avatar_url || testimonial.user_photo;
      });
    }

    return { data: testimonials, error: null };
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
    const { data: testimonials, error } = await supabase
      .from('testimonials')
      .select('*')
      .eq('is_visible', true)
      .eq('is_featured', true)
      .order('created_at', { ascending: false })
      .limit(6);

    if (error) throw error;

    // Fetch user profiles for all testimonials
    if (testimonials && testimonials.length > 0) {
      const userIds = [...new Set(testimonials.map(t => t.user_id))];

      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('user_id, full_name, avatar_url')
        .in('user_id', userIds);

      // Create a map and attach profiles to testimonials
      const profileMap = {};
      if (profiles) {
        profiles.forEach(profile => {
          profileMap[profile.user_id] = profile;
        });
      }

      testimonials.forEach(testimonial => {
        const profile = profileMap[testimonial.user_id];
        testimonial.user_name = profile?.full_name || 'Usuario';
        testimonial.user_avatar = profile?.avatar_url || testimonial.user_photo;
      });
    }

    return { data: testimonials, error: null };
  } catch (error) {
    console.error('Error fetching featured testimonials:', error);
    return { data: null, error };
  }
};

/**
 * Get user's own testimonial
 */
export const getUserTestimonial = async (userId) => {
  try {
    const { data, error } = await supabase
      .from('testimonials')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error fetching user testimonial:', error);
    return { data: null, error };
  }
};
