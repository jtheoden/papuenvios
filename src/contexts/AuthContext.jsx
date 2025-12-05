// src/contexts/AuthContext.jsx
import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/use-toast';
import AuthLoadingScreen from '@/components/AuthLoadingScreen';
import { SUPER_ADMIN_EMAILS, TIMEOUTS, RETRY_CONFIG } from '@/lib/constants';
import { getUserCategory } from '@/lib/userCategorizationService';

const AuthContext = createContext();

// localStorage role cache helper functions
const getRoleCacheKey = (userId) => `auth_role_${userId}`;
const getCachedRole = (userId) => {
  if (!userId) return null;
  try {
    const cached = localStorage.getItem(getRoleCacheKey(userId));
    return cached ? JSON.parse(cached) : null;
  } catch (e) {
    return null;
  }
};
const setCachedRole = (userId, role) => {
  if (!userId || !role) return;
  try {
    localStorage.setItem(getRoleCacheKey(userId), JSON.stringify({ role, ts: Date.now() }));
  } catch (e) {
    console.warn('[Auth] Failed to cache role:', e);
  }
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [userCategory, setUserCategory] = useState(null);
  const [isEnabled, setIsEnabled] = useState(true);
  const [loading, setLoading] = useState(true);

  const mountedRef = useRef(true);
  const sessionCheckIntervalRef = useRef(null);

  // Check and refresh session to prevent auth loss
  const checkAndRefreshSession = async () => {
    try {
      const { data: { session }, error } = await supabase.auth.getSession();

      if (error) {
        console.error('[Auth] Session check failed:', error.message);
        return false;
      }

      if (!session) {
        console.warn('[Auth] Session lost - no active session detected');
        setUser(null);
        setUserRole(null);
        setUserCategory(null);
        return false;
      }

      // Verify user still has proper permissions
      if (user && session.user.id !== user.id) {
        console.warn('[Auth] User ID mismatch - possible session corruption');
        setUser(null);
        setUserRole(null);
        setUserCategory(null);
        return false;
      }

      // Check token expiration
      const expiresAt = session.expires_at;
      const now = Math.floor(Date.now() / 1000);
      const timeUntilExpiry = expiresAt - now;

      console.log('[Auth] Session check: token expires in', timeUntilExpiry, 'seconds');

      if (timeUntilExpiry < 60) {
        console.warn('[Auth] Token expiring soon, attempting refresh...');
        const { data, error: refreshError } = await supabase.auth.refreshSession();

        if (refreshError) {
          console.error('[Auth] Token refresh failed:', refreshError.message);
          await supabase.auth.signOut();
          setUser(null);
          setUserRole(null);
          setUserCategory(null);
          return false;
        }

        if (data?.session) {
          console.log('[Auth] Token refreshed successfully');
          await updateUserState(data.session);
          return true;
        }
      }

      return true;
    } catch (err) {
      console.error('[Auth] Session check error:', err);
      return false;
    }
  };

  // Profile fetch with retry logic for better reliability
  const fetchProfile = async (uid, attempt = 1) => {
    try {
      const { data, error } = await Promise.race([
        supabase.from('user_profiles')
          .select('role, is_enabled, avatar_url, full_name, email')
          .eq('id', uid)
          .single(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Profile fetch timeout')), TIMEOUTS.PROFILE_FETCH)
        )
      ]);

      if (error) {
        console.warn(`[Auth] Profile fetch error (attempt ${attempt}/${RETRY_CONFIG.PROFILE_FETCH_ATTEMPTS}):`, error);

        // Retry if attempts remaining
        if (attempt < RETRY_CONFIG.PROFILE_FETCH_ATTEMPTS) {
          console.log(`[Auth] Retrying profile fetch in ${RETRY_CONFIG.PROFILE_FETCH_DELAY}ms...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_CONFIG.PROFILE_FETCH_DELAY));
          return fetchProfile(uid, attempt + 1);
        }

        return null;
      }

      return data;
    } catch (err) {
      console.warn(`[Auth] Profile fetch failed (attempt ${attempt}/${RETRY_CONFIG.PROFILE_FETCH_ATTEMPTS}):`, err.message);

      // Retry if attempts remaining
      if (attempt < RETRY_CONFIG.PROFILE_FETCH_ATTEMPTS) {
        console.log(`[Auth] Retrying profile fetch in ${RETRY_CONFIG.PROFILE_FETCH_DELAY}ms...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_CONFIG.PROFILE_FETCH_DELAY));
        return fetchProfile(uid, attempt + 1);
      }

      return null;
    }
  };

  const updateUserState = async (session) => {
    if (!session?.user) {
      console.warn('[Auth] updateUserState called with invalid session');
      setUser(null);
      setUserRole(null);
      setUserCategory(null);
      setIsEnabled(true);
      return;
    }

    const uid = session.user.id;
    console.log('[Auth] Updating user state for:', session.user.email);
    console.log('[Auth] Session user metadata:', {
      id: session.user.id,
      email: session.user.email,
      provider: session.user.app_metadata?.provider,
      aud: session.user.aud,
      expires_at: session.expires_at
    });

    // Fetch profile from database
    const profile = await fetchProfile(uid);

    if (!profile) {
      // Profile doesn't exist or fetch failed - use cached role if available
      console.warn('[Auth] Profile not found, attempting to use cached role as fallback');
      const cachedRoleData = getCachedRole(uid);
      const fallbackRole = cachedRoleData?.role || 'user';

      console.log('[Auth] Using fallback role:', fallbackRole, 'from cache:', !!cachedRoleData);

      setUser(session.user);
      setUserRole(fallbackRole);
      setUserCategory(null);
      setIsEnabled(true);
      return;
    }

    // Check if account is disabled
    if (profile.is_enabled === false) {
      console.warn('[Auth] Account is disabled');
      setUser(null);
      setUserRole(null);
      setUserCategory(null);
      setIsEnabled(false);
      try {
        await supabase.auth.signOut();
        toast({
          title: 'Cuenta deshabilitada',
          description: 'Tu cuenta ha sido deshabilitada. Contacta al soporte.',
          variant: 'destructive'
        });
      } catch (e) {
        console.error('[Auth] Error signing out disabled user:', e);
      }
      return;
    }

    // Success - set user state with profile
    // CRITICAL: Merge profile fields directly into user object (NOT nested)
    // This ensures avatar_url, full_name, etc. are accessible at user.avatar_url
    // Priority: OAuth metadata > DB profile for avatar
    const mergedUser = {
      ...session.user,
      // Preserve OAuth metadata (Google picture, etc.)
      avatar_url: session.user.user_metadata?.picture ||
                  session.user.user_metadata?.avatar_url ||
                  profile.avatar_url,
      full_name: profile.full_name || session.user.user_metadata?.name || session.user.user_metadata?.full_name,
      email: profile.email || session.user.email,
      role: profile.role || 'user',
      is_enabled: profile.is_enabled,
      // Keep profile object for backwards compatibility
      profile
    };

    setUser(mergedUser);
    setUserRole(profile.role || 'user');
    setIsEnabled(true);

    // Cache the role for future use in case of timeout
    setCachedRole(uid, profile.role || 'user');

    console.log('[Auth] User state updated successfully', {
      role: profile.role,
      email: mergedUser.email,
      hasAvatar: !!mergedUser.avatar_url,
      timestamp: new Date().toISOString()
    });

    // Non-blocking: Sync metadata from OAuth provider
    syncMetadata(uid, session.user, profile);
  };

  // Separate function for metadata sync (non-blocking)
  const syncMetadata = async (uid, sessionUser, profile) => {
    try {
      const metadataAvatar = sessionUser.user_metadata?.avatar_url || sessionUser.user_metadata?.picture;
      const metadataName = sessionUser.user_metadata?.full_name || sessionUser.user_metadata?.name;

      const updates = {};
      if (metadataAvatar && metadataAvatar !== profile.avatar_url) {
        updates.avatar_url = metadataAvatar;
      }
      if (metadataName && metadataName !== profile.full_name) {
        updates.full_name = metadataName;
      }

      if (Object.keys(updates).length > 0) {
        const { error } = await supabase
          .from('user_profiles')
          .update(updates)
          .eq('id', uid);

        if (error) {
          console.warn('[Auth] Metadata sync error (non-critical):', error);
        }
      }
    } catch (e) {
      console.warn('[Auth] Metadata sync failed (non-critical):', e);
    }
  };

  useEffect(() => {
    mountedRef.current = true;

    // Global timeout to prevent infinite loading
    const globalTimer = setTimeout(() => {
      if (mountedRef.current && loading) {
        console.warn('[Auth] Init timeout - clearing loading state');
        setLoading(false);
      }
    }, TIMEOUTS.INIT_AUTH);

    const initialize = async () => {
      console.log('[Auth] Initializing...');
      setLoading(true);

      try {
        const { data: { session }, error } = await supabase.auth.getSession();

        if (error) {
          console.error('[Auth] getSession error:', error);
          setLoading(false);
          return;
        }

        if (session) {
          await updateUserState(session);
        }
      } catch (err) {
        console.error('[Auth] Init error:', err);
      } finally {
        clearTimeout(globalTimer);
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    };

    // Listen for auth changes (sign in, sign out, token refresh)
    const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('[Auth] State change:', event, {
        hasSession: !!session,
        timestamp: new Date().toISOString()
      });

      if (!mountedRef.current) return;

      if (event === 'SIGNED_OUT') {
        console.log('[Auth] SIGNED_OUT event received - clearing user state');
        setUser(null);
        setUserRole(null);
        setUserCategory(null);
        setIsEnabled(true);
        return;
      }

      if (event === 'TOKEN_REFRESHED') {
        console.log('[Auth] TOKEN_REFRESHED event - session updated');
      }

      if (session) {
        await updateUserState(session);
      }
    });

    // Set up periodic session check (every 5 minutes)
    sessionCheckIntervalRef.current = setInterval(() => {
      if (mountedRef.current && user) {
        console.log('[Auth] Running periodic session check...');
        checkAndRefreshSession();
      }
    }, 5 * 60 * 1000); // 5 minutes

    initialize();

    return () => {
      mountedRef.current = false;
      clearTimeout(globalTimer);
      if (sessionCheckIntervalRef.current) {
        clearInterval(sessionCheckIntervalRef.current);
      }
      if (listener?.subscription) {
        listener.subscription.unsubscribe();
      }
    };
  }, []);

  const login = async (email, password) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      if (data?.session) {
        await updateUserState(data.session);
        return true;
      }

      return false;
    } catch (err) {
      console.error('[Auth] login error', err);
      toast({
        title: 'Error de inicio de sesión',
        description: err.message || String(err),
        variant: 'destructive'
      });
      return false;
    }
  };

  const signInWithGoogle = async () => {
    try {
      await supabase.auth.signOut();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/auth/callback`, queryParams: { access_type: 'offline', prompt: 'consent' } }
      });
      if (error) throw error;
      if (data?.url) window.location.replace(data.url);
    } catch (err) {
      console.error('[Auth] signInWithGoogle error', err);
      toast({ title: 'Error', description: err.message || String(err), variant: 'destructive' });
    }
  };

  const logout = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setUser(null);
      setUserRole(null);
      setUserCategory(null);
      setIsEnabled(true);
    } catch (err) {
      console.error('[Auth] logout error', err);
      toast({ title: 'Error al cerrar sesión', description: err.message || String(err), variant: 'destructive' });
    }
  };

  useEffect(() => {
    let isMounted = true;

    const loadCategory = async () => {
      if (!user?.id) {
        setUserCategory(null);
        return;
      }

      if (userRole === 'admin' || userRole === 'super_admin') {
        setUserCategory(null);
        return;
      }

      try {
        const category = await getUserCategory(user.id);
        if (isMounted) {
          setUserCategory(category);
        }
      } catch (err) {
        console.warn('[Auth] Failed to load user category:', err);
        if (isMounted) {
          setUserCategory(null);
        }
      }
    };

    loadCategory();

    return () => {
      isMounted = false;
    };
  }, [user?.id, userRole]);

  const checkRole = (requiredRole) => {
    if (!requiredRole) return true;
    if (!userRole) return false;

    // Super admin has access to everything
    if (userRole === 'super_admin') return true;

    // Admin has access to admin and user routes
    if (userRole === 'admin' && requiredRole !== 'super_admin') return true;

    // Exact role match
    return userRole === requiredRole;
  };

  // Check if user email is in super admin list (for UI convenience only, not security)
  const isSuperAdminEmail = SUPER_ADMIN_EMAILS.includes(user?.email);

  const value = {
    user,
    loading,
    isAuthenticated: !!user && isEnabled,
    userRole,
    userCategory,
    isEnabled,
    isSuperAdmin: userRole === 'super_admin' || isSuperAdminEmail,
    isAdmin: userRole === 'admin' || userRole === 'super_admin' || isSuperAdminEmail,
    checkRole,
    login,
    signInWithGoogle,
    logout,
    checkAndRefreshSession, // Exported for manual session checks if needed
    supabaseClient: supabase
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading ? children : <AuthLoadingScreen />}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
};

export default AuthProvider;
