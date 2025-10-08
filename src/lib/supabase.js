// src/lib/supabase.js
import { createClient } from '@supabase/supabase-js';

/**
 * Config
 * - Variables de entorno: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
 * - No pongas service_role en frontend.
 */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)');
}

/**
 * Cliente Supabase configurado
 * - flowType: 'pkce' es bueno para OAuth
 * - detectSessionInUrl: false on frontends that handle callback manually (set true if you rely on the client lib).
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storage: window.localStorage,
    storageKey: 'papuenvios-auth',
    flowType: 'pkce',
    debug: false
  },
  db: {
    schema: 'public'
  },
  global: {
    headers: {
      'x-client-info': 'papuenvios-web'
    }
  }
});

/* ======= Utilities ======= */
const DEFAULT_QUERY_TIMEOUT = 10000; // 10s
const ROLE_CACHE_TTL = 30_000; // 30s cache for role checks

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * withTimeout: race a promise with a timeout to avoid hanging queries
 */
export const withTimeout = async (promise, ms = DEFAULT_QUERY_TIMEOUT, label = 'op') => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
};

/* ======= Simple in-memory cache for roles (client-side helper) ======= */
const roleCache = new Map(); // userId -> { role, ts }

/**
 * getCachedRole
 */
const getCachedRole = (userId) => {
  if (!userId) return null;
  const entry = roleCache.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.ts > ROLE_CACHE_TTL) {
    roleCache.delete(userId);
    return null;
  }
  return entry.role;
};

const setCachedRole = (userId, role) => {
  if (!userId) return;
  roleCache.set(userId, { role, ts: Date.now() });
};

/* ======= Core helpers ======= */

/**
 * getUserProfile(userId)
 * - Returns profile object or null
 * - Handles timeouts and RLS/permission errors gracefully
 */
export const getUserProfile = async (userId, { timeoutMs = DEFAULT_QUERY_TIMEOUT } = {}) => {
  if (!userId) return null;
  try {
    const res = await withTimeout(
      supabase
        .from('user_profiles')
        .select('id, user_id, email, role, is_enabled, full_name, avatar_url, created_at, updated_at')
        .eq('id', userId)
        .single(),
      timeoutMs,
      'getUserProfile'
    );

    // supabase-js returns { data, error } in v2
    if (res?.error) {
      // Silently log and return null so UI can fallback
      console.warn('[supabase] getUserProfile error:', res.error);
      return null;
    }
    const profile = res?.data ?? res;
    if (profile?.role) setCachedRole(userId, profile.role);
    return profile ?? null;
  } catch (err) {
    console.warn('[supabase] getUserProfile failed:', err.message || err);
    return null;
  }
};

/**
 * getUserRole(userId)
 * - First checks cache, then DB.
 * - Returns role string or null.
 */
export const getUserRole = async (userId, { timeoutMs = DEFAULT_QUERY_TIMEOUT } = {}) => {
  if (!userId) return null;
  const cached = getCachedRole(userId);
  if (cached) return cached;

  const profile = await getUserProfile(userId, { timeoutMs });
  const role = profile?.role ?? null;
  if (role) setCachedRole(userId, role);
  return role;
};

/**
 * checkAdminStatus(userId)
 * - Returns true if role is 'admin' or 'super_admin'
 * - Uses cache and fallback logic
 */
export const checkAdminStatus = async (userId, { timeoutMs = DEFAULT_QUERY_TIMEOUT } = {}) => {
  if (!userId) return false;
  try {
    const role = await getUserRole(userId, { timeoutMs });
    return role === 'admin' || role === 'super_admin';
  } catch (err) {
    console.warn('[supabase] checkAdminStatus error:', err);
    return false;
  }
};

/* ======= createOrUpdateUserProfile (client-side safe) =======
   - IMPORTANT: **Do not** assign privileged roles (admin/super_admin) in client code.
   - This function will:
     - Try to fetch existing profile
     - If none exists, insert a profile with role='user' (do NOT auto-promote)
     - If exists, update avatar/full_name if different
   - If you need to promote someone to admin/super_admin, run an admin-only RPC or do it from the Supabase Dashboard.
*/
export const createOrUpdateUserProfile = async (user, { timeoutMs = DEFAULT_QUERY_TIMEOUT } = {}) => {
  if (!user) return null;

  try {
    // Attempt to read existing profile
    const existing = await withTimeout(
      supabase.from('user_profiles').select('*').eq('id', user.id).single(),
      timeoutMs,
      'fetchExistingProfile'
    );

    if (existing?.error && existing.error.code && existing.error.code !== 'PGRST116') {
      // PGRST116 = no rows (depends on version); only log unexpected errors
      console.warn('[supabase] createOrUpdateUserProfile - fetch existing returned error:', existing.error);
    }

    const existingProfile = existing?.data ?? existing ?? null;

    // Build profile payload
    const profileData = {
      user_id: user.id,
      email: user.email,
      full_name: user.user_metadata?.full_name || user.user_metadata?.name || '',
      avatar_url: user.user_metadata?.avatar_url || user.user_metadata?.picture || '',
      // ROLE: do NOT set super_admin here. If profile exists, keep existing role; otherwise, default to 'user'
      role: existingProfile?.role || 'user',
      is_enabled: true
    };

    // If no profile exist -> INSERT (role will be 'user')
    if (!existingProfile) {
      const insert = await withTimeout(
        supabase.from('user_profiles').insert([profileData]).select().single(),
        timeoutMs,
        'insertUserProfile'
      );
      if (insert?.error) {
        console.error('[supabase] createOrUpdateUserProfile insert error:', insert.error);
        return null;
      }
      // cache role
      setCachedRole(user.id, profileData.role);
      return insert?.data ?? insert ?? null;
    }

    // Otherwise update only changed non-privileged fields (avatar, full_name)
    const updates = {};
    if (profileData.avatar_url && profileData.avatar_url !== existingProfile.avatar_url) updates.avatar_url = profileData.avatar_url;
    if (profileData.full_name && profileData.full_name !== existingProfile.full_name) updates.full_name = profileData.full_name;

    if (Object.keys(updates).length > 0) {
      const upd = await withTimeout(
        supabase.from('user_profiles').update(updates).eq('id', user.id).select().single(),
        timeoutMs,
        'updateUserProfile'
      );
      if (upd?.error) {
        console.error('[supabase] createOrUpdateUserProfile update error:', upd.error);
        return existingProfile;
      }
      return upd?.data ?? upd ?? existingProfile;
    }

    // nothing to update
    return existingProfile;
  } catch (err) {
    console.error('[supabase] createOrUpdateUserProfile failed:', err);
    return null;
  }
};

/* ======= Optional helper: server-side promotion (RPC) =======
   - Never call this from client with a service_role key. Use Supabase Dashboard or an Edge Function
     that runs with service_role to promote a user to admin/super_admin.
   - Below is a SQL snippet you should run **in SQL editor** (admin only).
*/

/*
-- SQL (run in Supabase SQL editor as admin) to create an RPC secure function:
create or replace function public.set_user_role(target_user_id uuid, new_role text)
returns void language plpgsql as $$
begin
  -- Only callable by service_role or by trusted server environment.
  update public.user_profiles set role = new_role where user_id = target_user_id;
end$$;
*/

export default supabase;
