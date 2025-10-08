import { supabase } from './supabase';

export const userService = {
  async getAllUsers() {
    // Fixed: email is now denormalized in user_profiles
    // No need to query auth.users (which is not accessible from client anyway)
    const { data: profiles, error: profilesError } = await supabase
      .from('user_profiles')
      .select(`
        id,
        email,
        role,
        is_enabled,
        full_name,
        avatar_url,
        created_at,
        updated_at
      `)
      .order('created_at', { ascending: false });

    if (profilesError) {
      console.error('Error fetching profiles:', profilesError);
      throw profilesError;
    }

    // Note: last_sign_in_at is not available from client SDK
    // If needed, create a database function or Edge Function to fetch it
    return profiles;
  },

  async getUserById(userId) {
    // Fixed: email is now in user_profiles, no join needed
    const { data, error } = await supabase
      .from('user_profiles')
      .select(`
        id,
        email,
        role,
        is_enabled,
        full_name,
        avatar_url,
        phone,
        address,
        preferences,
        metadata,
        created_at,
        updated_at
      `)
      .eq('id', userId)
      .single();

    if (error) throw error;
    return data;
  },

  async updateUserRole(userId, role) {
    const { error } = await supabase
      .from('user_profiles')
      .update({ role })
      .eq('id', userId);
    
    if (error) throw error;
  },

  async updateUserStatus(userId, isEnabled) {
    const { error } = await supabase
      .from('user_profiles')
      .update({ is_enabled: isEnabled })
      .eq('id', userId);
    
    if (error) throw error;
  },

  async getUserStats() {
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('role, is_enabled');

      if (error) throw error;

      return {
        total: data.length,
        active: data.filter(user => user.is_enabled).length,
        admins: data.filter(user => user.role === 'admin').length,
        users: data.filter(user => user.role === 'user').length,
        super_admins: data.filter(user => user.role === 'super_admin').length
      };
    } catch (error) {
      console.error('Error fetching user stats:', error);
      throw error;
    }
  }
};

// Middleware to check user permissions
export const checkPermissions = async (user, requiredRole = 'user') => {
  if (!user) return false;

  const roles = {
    user: 0,
    admin: 1,
    super_admin: 2
  };

  // Super admin check - support both email formats
  const superAdminEmails = ['jtheoden@gmail.com', 'jtheoden@googlemail.com'];
  if (superAdminEmails.includes(user.email) || user.role === 'super_admin') {
    return true;
  }

  try {
    const { data: profile, error } = await supabase
      .from('user_profiles')
      .select('role, is_enabled')
      .eq('id', user.id)
      .single();

    if (error) throw error;

    if (!profile || !profile.is_enabled) {
      return false;
    }

    return roles[profile.role] >= roles[requiredRole];
  } catch (error) {
    console.error('Error checking permissions:', error);
    return false;
  }
};

// Helper function to handle protected routes
export const withAuth = async (user, requiredRole, callback) => {
  const hasPermission = await checkPermissions(user, requiredRole);
  if (!hasPermission) {
    throw new Error('Unauthorized access');
  }
  return callback();
};