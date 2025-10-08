// src/contexts/AuthContext.jsx
import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/use-toast';
import AuthLoadingScreen from '@/components/AuthLoadingScreen';

const AuthContext = createContext();

// Reduced timeouts for better UX
const PROFILE_TIMEOUT_MS = 5000;
const INIT_TIMEOUT_MS = 10000;

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [isEnabled, setIsEnabled] = useState(true);
  const [loading, setLoading] = useState(true);

  const mountedRef = useRef(true);

  // Simplified profile fetch with single timeout
  const fetchProfile = async (uid) => {
    try {
      const { data, error } = await Promise.race([
        supabase.from('user_profiles')
          .select('role, is_enabled, avatar_url, full_name, email')
          .eq('id', uid)
          .single(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Profile fetch timeout')), PROFILE_TIMEOUT_MS)
        )
      ]);

      if (error) {
        console.warn('[Auth] Profile fetch error:', error);
        return null;
      }

      return data;
    } catch (err) {
      console.warn('[Auth] Profile fetch failed:', err.message);
      return null;
    }
  };

  const updateUserState = async (session) => {
    if (!session?.user) {
      setUser(null);
      setUserRole(null);
      setIsEnabled(true);
      return;
    }

    const uid = session.user.id;
    console.log('[Auth] Updating user state for:', session.user.email);

    // Fetch profile from database
    const profile = await fetchProfile(uid);

    if (!profile) {
      // Profile doesn't exist or fetch failed - use fallback
      console.warn('[Auth] Profile not found, using session data as fallback');
      setUser(session.user);
      setUserRole('user');
      setIsEnabled(true);
      return;
    }

    // Check if account is disabled
    if (profile.is_enabled === false) {
      console.warn('[Auth] Account is disabled');
      setUser(null);
      setUserRole(null);
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
    setUser({ ...session.user, profile });
    setUserRole(profile.role || 'user');
    setIsEnabled(true);

    console.log('[Auth] User state updated successfully. Role:', profile.role);

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
    }, INIT_TIMEOUT_MS);

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
      console.log('[Auth] State change:', event);

      if (!mountedRef.current) return;

      if (event === 'SIGNED_OUT') {
        setUser(null);
        setUserRole(null);
        setIsEnabled(true);
        return;
      }

      if (session) {
        await updateUserState(session);
      }
    });

    initialize();

    return () => {
      mountedRef.current = false;
      clearTimeout(globalTimer);
      if (listener?.subscription) {
        listener.subscription.unsubscribe();
      }
    };
  }, []);

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
      setIsEnabled(true);
    } catch (err) {
      console.error('[Auth] logout error', err);
      toast({ title: 'Error al cerrar sesión', description: err.message || String(err), variant: 'destructive' });
    }
  };

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

  // Support both @gmail.com and @googlemail.com for super admin
  const superAdminEmails = ['jtheoden@gmail.com', 'jtheoden@googlemail.com'];
  const isSuperAdminEmail = superAdminEmails.includes(user?.email);

  const value = {
    user,
    loading,
    isAuthenticated: !!user && isEnabled,
    userRole,
    isEnabled,
    isSuperAdmin: userRole === 'super_admin' || isSuperAdminEmail,
    isAdmin: userRole === 'admin' || userRole === 'super_admin' || isSuperAdminEmail,
    checkRole,
    signInWithGoogle,
    logout,
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
