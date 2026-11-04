// src/contexts/AuthContext.jsx
import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/use-toast';
import AuthLoadingScreen from '@/components/AuthLoadingScreen';
import { TIMEOUTS, RETRY_CONFIG, AUTH_STORAGE_KEY } from '@/lib/constants';
import { getUserCategory } from '@/lib/userCategorizationService';
import { flushQueuedActivityLogs, logActivity } from '@/lib/activityLogger';
import { clearRefreshBlock, getRefreshBlockRemainingMs, isRefreshBlocked, subscribeRefreshBlock } from '@/lib/refreshGuard';

const AuthContext = createContext();

// Waits between session-recovery attempts (the refresh guard's cooldown, when longer, wins).
const SESSION_RECOVERY_DELAYS = [5000, 15000, 30000, 60000];
const SESSION_RECOVERY_JITTER = 0.2;
const isRetryableAuthError = (error) => error?.name === 'AuthRetryableFetchError';
// auth-js refreshes a token this close to its expiry, so a session with less left is not "back to normal".
const SESSION_HEALTHY_MIN_LEFT_MS = 90_000;
const hasLifeLeft = (session) => (session?.expires_at ?? 0) * 1000 - Date.now() > SESSION_HEALTHY_MIN_LEFT_MS;

const clearStoredSession = () => {
  try {
    [AUTH_STORAGE_KEY, `${AUTH_STORAGE_KEY}-user`, `${AUTH_STORAGE_KEY}-code-verifier`]
      .forEach((key) => localStorage.removeItem(key));
  } catch (e) {
    // storage unavailable: nothing persisted to clear
  }
};

// While the refresh is blocked auth-js cannot load the expired session: signOut() would stall for
// the whole retry loop and then fail WITHOUT removing it. Sign out locally instead (the refresh
// token is not revoked server-side; it dies with its own expiry).
const signOutSafely = async () => {
  if (!isRefreshBlocked()) {
    const { error } = await supabase.auth.signOut();
    if (!error || !isRetryableAuthError(error)) return error;
  }
  clearStoredSession();
  clearRefreshBlock();
  return null;
};

// localStorage role cache helper functions
const getRoleCacheKey = (userId) => `auth_role_${userId}`;
// The cached role is a UI HINT only (shown as 'provisional'); the fresh profile
// and server-side RLS are the authority. Entries expire after ROLE_CACHE_MAX_AGE.
const getCachedRole = (userId) => {
  if (!userId) return null;
  try {
    const cached = JSON.parse(localStorage.getItem(getRoleCacheKey(userId)));
    const fresh = cached?.role && Date.now() - cached.ts <= RETRY_CONFIG.ROLE_CACHE_MAX_AGE;
    return fresh ? cached : null;
  } catch (e) {
    return null;
  }
};
const clearCachedRole = (userId) => {
  if (!userId) return;
  try {
    localStorage.removeItem(getRoleCacheKey(userId));
  } catch (e) {
    // storage unavailable: nothing to clear
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
  const [hasLoggedSession, setHasLoggedSession] = useState(false);
  // 'resolved' = role comes from a fresh profile (or there is nothing to resolve),
  // 'provisional' = cached role shown as a hint, 'unresolved' = no role known yet
  // (userRole stays null: never default to 'user' on a failed fetch).
  const [roleStatus, setRoleStatus] = useState('resolved');
  const [profileFailed, setProfileFailed] = useState(false);
  const [roleRetryExhausted, setRoleRetryExhausted] = useState(false);
  const [roleVerifyTimedOut, setRoleVerifyTimedOut] = useState(false);
  // The refresh token could not be renewed for now (rate limit / network): the session is kept
  // and renewed in the background. Different from `sessionExpired`: the session really ended.
  const [sessionRecovering, setSessionRecovering] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);

  const mountedRef = useRef(true);
  const updateSeqRef = useRef(0); // only the latest updateUserState call may apply its result
  const sessionRef = useRef(null);
  const resolvedUidRef = useRef(null);
  const retryRef = useRef(null);
  const explicitSignOutRef = useRef(false); // SIGNED_OUT that the person asked for is not an expiry

  const markSessionHealthy = () => {
    setSessionRecovering(false);
    setSessionExpired(false);
  };

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
        setSessionExpired(Boolean(sessionRef.current));
        resetAuthState();
        return false;
      }

      // Verify user still has proper permissions
      if (user && session.user.id !== user.id) {
        console.warn('[Auth] User ID mismatch - possible session corruption');
        resetAuthState();
        return false;
      }

      // Check token expiration
      const expiresAt = session.expires_at;
      const now = Math.floor(Date.now() / 1000);
      const timeUntilExpiry = expiresAt - now;

      if (timeUntilExpiry < 60) {
        console.warn('[Auth] Token expiring soon, attempting refresh...');
        const { data, error: refreshError } = await supabase.auth.refreshSession();

        if (refreshError) {
          // No sign-out here: auth-js already ends the session (SIGNED_OUT) when the refresh
          // token is really invalid; a rate limit or network failure must keep it.
          console.error('[Auth] Token refresh failed:', refreshError.message);
          return false;
        }

        if (data?.session) {
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
  const fetchProfile = async (uid, timeoutMs, attempt = 1) => {
    let timer;
    const retryOrNull = async () => {
      if (attempt < RETRY_CONFIG.PROFILE_FETCH_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, RETRY_CONFIG.PROFILE_FETCH_DELAY));
        return fetchProfile(uid, timeoutMs, attempt + 1);
      }
      return null;
    };

    try {
      const { data, error } = await Promise.race([
        supabase.from('user_profiles')
          .select('role, is_enabled, avatar_url, full_name, email')
          .eq('id', uid)
          .single(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Profile fetch timeout')), timeoutMs);
        })
      ]);

      if (error) {
        console.warn(`[Auth] Profile fetch error (attempt ${attempt}/${RETRY_CONFIG.PROFILE_FETCH_ATTEMPTS}):`, error);
        return await retryOrNull();
      }

      return data;
    } catch (err) {
      console.warn(`[Auth] Profile fetch failed (attempt ${attempt}/${RETRY_CONFIG.PROFILE_FETCH_ATTEMPTS}):`, err.message);
      return await retryOrNull();
    } finally {
      // Otherwise the losing timeout promise rejects later, unhandled.
      clearTimeout(timer);
    }
  };

  const resetAuthState = () => {
    updateSeqRef.current += 1; // invalidate any in-flight updateUserState
    clearCachedRole(sessionRef.current?.user?.id);
    sessionRef.current = null;
    resolvedUidRef.current = null;
    setUser(null);
    setUserRole(null);
    setUserCategory(null);
    setIsEnabled(true);
    setRoleStatus('resolved');
    setProfileFailed(false);
    setRoleRetryExhausted(false);
  };

  const updateUserState = async (session) => {
    if (!session?.user) {
      console.warn('[Auth] updateUserState called with invalid session');
      resetAuthState();
      return;
    }

    const seq = ++updateSeqRef.current;
    const uid = session.user.id;
    const isNewUid = sessionRef.current?.user?.id !== uid;
    sessionRef.current = session;
    const alreadyResolved = resolvedUidRef.current === uid;

    if (!alreadyResolved) {
      // Show the signed-in person right away with the cached role as a hint
      // (or no role at all) while the profile loads; never default to 'user'.
      const cachedRoleData = getCachedRole(uid);
      setUser(prev => (prev?.id === uid ? prev : session.user));
      setUserRole(cachedRoleData?.role ?? null);
      if (isNewUid) {
        // Only a different person resets the failure flags; recovery retries of the
        // same uid must not hide the banner while their fetch is in flight.
        setRoleStatus(cachedRoleData ? 'provisional' : 'unresolved');
        setProfileFailed(false);
        setRoleRetryExhausted(false);
      }
    }

    // Fetch profile from database. Generous budget until the role is resolved;
    // short for background refreshes of an already resolved role.
    const profile = await fetchProfile(
      uid,
      alreadyResolved ? TIMEOUTS.PROFILE_FETCH : TIMEOUTS.PROFILE_FETCH_INITIAL
    );

    // A newer call (or sign-out/unmount) superseded this one: drop its result.
    if (!mountedRef.current || seq !== updateSeqRef.current) return;

    if (!profile) {
      // Fetch failed: keep whatever is known (resolved role, provisional hint or
      // unresolved) and let the background recovery loop retry.
      console.warn('[Auth] Profile not available; keeping current role state and retrying in background');
      setProfileFailed(true);
      return;
    }

    // Check if account is disabled
    if (profile.is_enabled === false) {
      console.warn('[Auth] Account is disabled');
      clearCachedRole(uid);
      sessionRef.current = null;
      resolvedUidRef.current = null;
      setUser(null);
      setUserRole(null);
      setUserCategory(null);
      setIsEnabled(false);
      setRoleStatus('resolved');
      setProfileFailed(false);
      setRoleRetryExhausted(false);
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

    resolvedUidRef.current = uid;
    setUser(mergedUser);
    setUserRole(profile.role || 'user');
    setIsEnabled(true);
    setRoleStatus('resolved');
    setProfileFailed(false);
    setRoleRetryExhausted(false);

    // Cache the role for future use (UI hint only)
    setCachedRole(uid, profile.role || 'user');

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
    // Effect-local (not a ref): each StrictMode run owns its flag, so a
    // discarded run finishing cannot re-open the guard of the live one.
    let initializing = false;

    // Global timeout to prevent infinite loading
    const globalTimer = setTimeout(() => {
      // A hung getSession() must not keep dropping auth events forever.
      initializing = false;
      if (mountedRef.current && loading) {
        console.warn('[Auth] Init timeout - clearing loading state');
        setLoading(false);
      }
    }, TIMEOUTS.INIT_AUTH);

    const initialize = async () => {
      initializing = true;
      setLoading(true);

      try {
        const { data: { session }, error } = await supabase.auth.getSession();

        if (error) {
          console.error('[Auth] getSession error:', error);
          // Refresh blocked/unreachable: the stored session is intact, so say "reconnecting"
          // and let the recovery loop renew it instead of showing a signed-out screen.
          if (isRetryableAuthError(error)) setSessionRecovering(true);
          setLoading(false);
          return;
        }

        if (session) {
          markSessionHealthy();
          await updateUserState(session);
        }
      } catch (err) {
        console.error('[Auth] Init error:', err);
      } finally {
        clearTimeout(globalTimer);
        initializing = false;
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    };

    // Listen for auth changes (sign in, sign out, token refresh)
    const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {

      if (!mountedRef.current) return;

      if (event === 'SIGNED_OUT') {
        const expired = Boolean(sessionRef.current) && !explicitSignOutRef.current;
        explicitSignOutRef.current = false;
        clearRefreshBlock(); // nothing left to refresh: do not carry the cooldown into the next session
        resetAuthState();
        setSessionRecovering(false);
        setSessionExpired(expired);
        return;
      }

      // While `initialize()` is running it independently resolves the
      // current session via its own getSession() call and calls
      // updateUserState itself. supabase-js's internal
      // _recoverAndRefresh() also notifies this listener for that same
      // stored session — observed in real browsers as 'SIGNED_IN' fired
      // BEFORE 'INITIAL_SESSION' (not always 'INITIAL_SESSION' alone, and
      // not necessarily in event-name order). Skipping by the `initializing` flag
      // (a time window) instead of by specific event name covers both,
      // and any other event supabase-js may emit during that window,
      // without needing to duplicate updateUserState here.
      if (initializing) return;

      // Do NOT await updateUserState here: supabase-js's internal
      // _notifyAllSubscribers awaits this callback's returned promise as
      // part of _recoverAndRefresh(), which getSession() itself awaits via
      // initializePromise. Since updateUserState -> fetchProfile needs a
      // valid session (which requires getSession() to resolve), awaiting it
      // here creates a circular wait: getSession() blocks on this callback,
      // which blocks on getSession(). Firing it without awaiting lets this
      // callback's promise resolve immediately, breaking the deadlock.
      if (session) {
        // A session about to expire proves nothing yet; one with life left means we are back.
        if (hasLifeLeft(session)) markSessionHealthy();
        updateUserState(session);
      }
    });

    // The refresh guard says "rate limited": keep the session, show "reconnecting".
    const unsubscribeRefreshBlock = subscribeRefreshBlock((blocked) => {
      if (mountedRef.current) setSessionRecovering(blocked);
    });
    // A reload during the cooldown (or a 429 that landed before this effect subscribed): auth-js is
    // still retrying locally for a long while, so say "reconnecting" instead of "sign in".
    if (isRefreshBlocked()) setSessionRecovering(true);

    initialize();

    return () => {
      mountedRef.current = false;
      clearTimeout(globalTimer);
      unsubscribeRefreshBlock();
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
        markSessionHealthy();
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
      explicitSignOutRef.current = true;
      await signOutSafely();
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
      explicitSignOutRef.current = true;
      const error = await signOutSafely();
      if (error) throw error;
      resetAuthState();
      markSessionHealthy();
      explicitSignOutRef.current = false; // SIGNED_OUT was already delivered; do not mask a later expiry
    } catch (err) {
      explicitSignOutRef.current = false;
      console.error('[Auth] logout error', err);
      toast({ title: 'Error al cerrar sesión', description: err.message || String(err), variant: 'destructive' });
    }
  };

  // Total budget for "verifying permissions": after it, protected routes stop spinning.
  const roleResolved = roleStatus === 'resolved';
  useEffect(() => {
    if (roleResolved || !user?.id) {
      setRoleVerifyTimedOut(false);
      return undefined;
    }
    const timer = setTimeout(() => setRoleVerifyTimedOut(true), TIMEOUTS.ROLE_VERIFY_MAX);
    return () => clearTimeout(timer);
  }, [user?.id, roleResolved]);

  // One boolean so the loop (and its attempt budget) is not restarted when the second flag flips.
  const recoveryActive = profileFailed || roleVerifyTimedOut;

  // Background recovery once a profile fetch has failed while the role is
  // unresolved/provisional: backoff, then a
  // steady interval (capped), plus an immediate try on `online` and when the tab
  // becomes visible. Stops as soon as the role resolves, on sign-out and unmount.
  useEffect(() => {
    // While the session itself is being renewed every profile fetch would go out without a
    // valid token; the role loop restarts (fresh budget) once the session is back.
    if (roleStatus === 'resolved' || !recoveryActive || !user?.id || sessionRecovering) return undefined;

    let cancelled = false;
    let running = false;
    let attempts = 0;
    let timer = null;

    const scheduleNext = () => {
      clearTimeout(timer);
      if (cancelled) return;
      if (attempts >= RETRY_CONFIG.PROFILE_RECOVERY_MAX_ATTEMPTS) {
        setRoleRetryExhausted(true);
        return;
      }
      const delays = RETRY_CONFIG.PROFILE_RECOVERY_DELAYS;
      const delay = delays[attempts] ?? RETRY_CONFIG.PROFILE_RECOVERY_INTERVAL;
      attempts += 1;
      timer = setTimeout(() => attempt(false), delay);
    };

    const attempt = async (resetBudget) => {
      clearTimeout(timer);
      if (resetBudget) {
        attempts = 0;
        setRoleRetryExhausted(false);
      }
      if (cancelled || running || !sessionRef.current) return;
      running = true;
      try {
        await updateUserState(sessionRef.current);
      } finally {
        running = false;
      }
      // Resolved meanwhile (e.g. success on the last attempt): do not schedule or flag exhaustion.
      if (cancelled || resolvedUidRef.current === sessionRef.current?.user?.id) return;
      scheduleNext();
    };

    const onOnline = () => attempt(true);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') attempt(true);
    };

    retryRef.current = () => attempt(true);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);
    // Before the first failure only the manual/online/visibility triggers are armed: a timer-driven
    // retry would supersede the first fetch still in flight and delay the failure banner.
    if (profileFailed) scheduleNext();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      retryRef.current = null;
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user?.id, roleStatus, recoveryActive, profileFailed, sessionRecovering]);

  // Renews the session in the background while the refresh is blocked/unreachable: one attempt per
  // step (never inside the guard's cooldown), backoff with jitter, plus an immediate try when the
  // connection or the tab comes back. Stops by itself as soon as a session is returned.
  useEffect(() => {
    if (!sessionRecovering) return undefined;

    let cancelled = false;
    let running = false;
    let attempts = 0;
    let timer = null;

    const schedule = () => {
      clearTimeout(timer);
      if (cancelled) return;
      const step = SESSION_RECOVERY_DELAYS[Math.min(attempts, SESSION_RECOVERY_DELAYS.length - 1)];
      attempts += 1;
      const wait = Math.max(step, getRefreshBlockRemainingMs());
      timer = setTimeout(attempt, wait * (1 + Math.random() * SESSION_RECOVERY_JITTER));
    };

    const attempt = async () => {
      clearTimeout(timer);
      if (cancelled || running) return;
      if (isRefreshBlocked()) {
        schedule();
        return;
      }
      running = true;
      try {
        const { data, error } = await supabase.auth.getSession();
        if (cancelled) return;
        if (data?.session) {
          // auth-js already notified listeners (TOKEN_REFRESHED); hydrate only if that did not.
          if (sessionRef.current?.user?.id !== data.session.user?.id) updateUserState(data.session);
          markSessionHealthy();
          return;
        }
        if (!error) {
          setSessionRecovering(false); // nothing left to recover (signed out elsewhere)
          return;
        }
      } catch (err) {
        console.warn('[Auth] Session recovery attempt failed:', err?.message);
      } finally {
        running = false;
      }
      schedule();
    };

    const onOnline = () => { if (!isRefreshBlocked()) attempt(); };
    const onVisibility = () => { if (document.visibilityState === 'visible' && !isRefreshBlocked()) attempt(); };

    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);
    schedule();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [sessionRecovering]);

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

  useEffect(() => {
    if (user && roleStatus === 'resolved' && !hasLoggedSession) {
      logActivity({
        action: 'login',
        entityType: 'user',
        entityId: user.id,
        performedBy: user.email,
        description: 'Inicio de sesión exitoso',
        metadata: { provider: user.app_metadata?.provider }
      });
      setHasLoggedSession(true);
    }

    if (!user && hasLoggedSession) {
      setHasLoggedSession(false);
    }
  }, [hasLoggedSession, user, roleStatus]);

  useEffect(() => {
    if (user?.id && roleStatus === 'resolved' && !sessionRecovering) {
      flushQueuedActivityLogs();
    }
  }, [user?.id, roleStatus, sessionRecovering]);

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

  const value = {
    user,
    loading,
    isAuthenticated: !!user && isEnabled,
    userRole,
    roleStatus,
    roleRetryExhausted,
    roleFetchFailed: profileFailed,
    roleVerifyTimedOut,
    retryRoleResolution: () => retryRef.current?.(),
    userCategory,
    isEnabled,
    // 'reconnecting' = session kept, being renewed; 'expired' = it ended without a sign-out request
    sessionStatus: sessionRecovering ? 'reconnecting' : (sessionExpired && !user ? 'expired' : 'ok'),
    isSuperAdmin: userRole === 'super_admin',
    isAdmin: userRole === 'admin' || userRole === 'super_admin',
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
