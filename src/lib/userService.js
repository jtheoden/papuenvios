import { supabase } from './supabase';
import {
  handleError,
  logError,
  createNotFoundError,
  createPermissionError,
  parseSupabaseError,
  ERROR_CODES
} from './errorHandler';

export const userService = {
  async getAllUsers() {
    // Fixed: email is now denormalized in user_profiles
    // No need to query auth.users (which is not accessible from client anyway)
    try {
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
        const appError = parseSupabaseError(profilesError);
        logError(appError, { operation: 'getAllUsers' });
        throw appError;
      }

      // Note: last_sign_in_at is not available from client SDK
      // If needed, create a database function or Edge Function to fetch it
      return profiles;
    } catch (error) {
      if (error.code) throw error; // Already an AppError
      return handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getAllUsers' });
    }
  },

  async getUserById(userId) {
    try {
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

      if (error) {
        const appError = parseSupabaseError(error);
        if (!data) {
          throw createNotFoundError('User', userId);
        }
        throw appError;
      }

      return data;
    } catch (error) {
      if (error.code) throw error; // Already an AppError
      return handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getUserById', userId });
    }
  },

  async updateUserRole(userId, role) {
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({ role })
        .eq('id', userId);

      if (error) {
        const appError = parseSupabaseError(error);
        logError(appError, { operation: 'updateUserRole', userId, role });
        throw appError;
      }
    } catch (error) {
      if (error.code) throw error; // Already an AppError
      return handleError(error, ERROR_CODES.DB_ERROR, { operation: 'updateUserRole', userId, role });
    }
  },

  async updateUserStatus(userId, isEnabled) {
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({ is_enabled: isEnabled })
        .eq('id', userId);

      if (error) {
        const appError = parseSupabaseError(error);
        logError(appError, { operation: 'updateUserStatus', userId, isEnabled });
        throw appError;
      }
    } catch (error) {
      if (error.code) throw error; // Already an AppError
      return handleError(error, ERROR_CODES.DB_ERROR, { operation: 'updateUserStatus', userId, isEnabled });
    }
  },

  async getUserStats() {
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('role, is_enabled');

      if (error) {
        const appError = parseSupabaseError(error);
        logError(appError, { operation: 'getUserStats' });
        throw appError;
      }

      return {
        total: data.length,
        active: data.filter(user => user.is_enabled).length,
        admins: data.filter(user => user.role === 'admin').length,
        users: data.filter(user => user.role === 'user').length,
        super_admins: data.filter(user => user.role === 'super_admin').length
      };
    } catch (error) {
      if (error.code) throw error; // Already an AppError
      return handleError(error, ERROR_CODES.DB_ERROR, { operation: 'getUserStats' });
    }
  }
};

// Middleware to check user permissions
export const checkPermissions = async (user, requiredRole = 'user') => {
  try {
    if (!user) {
      logError(new Error('User not authenticated'), { operation: 'checkPermissions' });
      return false;
    }

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

    const { data: profile, error } = await supabase
      .from('user_profiles')
      .select('role, is_enabled')
      .eq('id', user.id)
      .single();

    if (error) {
      const appError = parseSupabaseError(error);
      logError(appError, { operation: 'checkPermissions', userId: user.id });
      return false;
    }

    if (!profile || !profile.is_enabled) {
      logError(new Error('User disabled or profile not found'), {
        operation: 'checkPermissions',
        userId: user.id,
        profileExists: !!profile,
        isEnabled: profile?.is_enabled
      });
      return false;
    }

    return roles[profile.role] >= roles[requiredRole];
  } catch (error) {
    logError(error, { operation: 'checkPermissions', userId: user?.id });
    return false;
  }
};

// Helper function to handle protected routes
export const withAuth = async (user, requiredRole, callback) => {
  try {
    const hasPermission = await checkPermissions(user, requiredRole);
    if (!hasPermission) {
      throw createPermissionError('access this resource', requiredRole);
    }
    return callback();
  } catch (error) {
    if (error.code) throw error; // Already an AppError
    return handleError(error, ERROR_CODES.FORBIDDEN, { operation: 'withAuth', requiredRole });
  }
};

/**
 * Import path:
 * import { userService, checkPermissions, withAuth } from '@/lib/userService';
 *
 * Usage examples:
 *
 * // Fetch all users
 * const users = await userService.getAllUsers();
 *
 * // Get user by ID with error handling
 * try {
 *   const user = await userService.getUserById(userId);
 * } catch (error) {
 *   if (error.code === 'NOT_FOUND') {
 *     // Handle user not found
 *   }
 * }
 *
 * // Update user role
 * try {
 *   await userService.updateUserRole(userId, 'admin');
 * } catch (error) {
 *   console.error(error.message);
 * }
 *
 * // Check permissions
 * const canAccess = await checkPermissions(currentUser, 'admin');
 *
 * // Protected callback
 * try {
 *   await withAuth(currentUser, 'admin', () => {
 *     // Admin-only operations
 *   });
 * } catch (error) {
 *   // Handle auth error
 * }
 */