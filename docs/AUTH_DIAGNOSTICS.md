# Authentication Diagnostics Guide

## Purpose
This document explains how to diagnose and troubleshoot authentication loss issues using the enhanced logging in AuthContext.

---

## Console Logs to Monitor

Open **Developer Tools → Console** and look for logs with `[Auth]` prefix:

### Session Initialization
```
[Auth] Initializing...
[Auth] Updating user state for: user@example.com
[Auth] Session user metadata: {
  id: "uuid-here",
  email: "user@example.com",
  provider: "google",
  aud: "authenticated",
  expires_at: 1700000000
}
[Auth] User state updated successfully {
  role: "super_admin",
  email: "user@example.com",
  hasAvatar: true,
  timestamp: "2025-11-12T10:30:00Z"
}
```

### Session Events
```
[Auth] State change: SIGNED_IN { hasSession: true, timestamp: "..." }
[Auth] State change: TOKEN_REFRESHED { hasSession: true, timestamp: "..." }
[Auth] State change: SIGNED_OUT { hasSession: false, timestamp: "..." }
```

### Periodic Session Check (every 5 minutes)
```
[Auth] Running periodic session check...
[Auth] Session check: token expires in 3600 seconds
```

---

## Common Problems & Diagnostics

### Problem 1: "Auth Init timeout" appears

**Log pattern:**
```
[Auth] Initializing...
[Auth] Updating user state for: user@example.com
[Auth] Init timeout - clearing loading state
```

**Root causes:**
1. **RLS policies too slow** - Profile fetch taking > 20 seconds
2. **Database connection issue** - Supabase is unreachable
3. **Network latency** - Slow connection to Supabase

**Fix:**
- Run the RLS optimization migration
- Verify Supabase project is responding: `supabase status`
- Check network tab in DevTools for slow requests

---

### Problem 2: User becomes null unexpectedly

**Log pattern:**
```
[Auth] User state updated successfully { role: "super_admin", ... }
[After some time]
[Auth] Session lost - no active session detected
[Auth] updateUserState called with invalid session
```

**Root causes:**
1. **Token expired** - Refresh token is invalid
2. **Session invalidated** - User logged out elsewhere
3. **RLS policy blocking profile fetch** - User can't read their own profile

**Diagnostics:**
- Check "Session check: token expires in X seconds" logs
- If expires_in < 0, token has expired
- Look for profile fetch errors in the logs

**Fix:**
- If token expired: Implement automatic token refresh (already in place, runs every 5 min)
- If RLS blocking: Check RLS policies on `user_profiles` table
- Manual fix: Hard refresh page (Ctrl+Shift+R)

---

### Problem 3: "User ID mismatch" warning

**Log pattern:**
```
[Auth] User ID mismatch - possible session corruption
```

**Root causes:**
1. **Session hijacking** (security issue)
2. **Multiple tabs with different sessions**
3. **Cache corruption**

**Diagnostics:**
- Check if you have multiple tabs open
- Check browser's Application tab → Cookies → Check `sb-...` cookies
- Run `localStorage.clear()` in console if needed

**Fix:**
- Close other tabs
- Clear localStorage and cookies
- Sign out and sign back in

---

### Problem 4: "Profile fetch timeout" or "Profile not found"

**Log pattern:**
```
[Auth] Profile fetch error (attempt 1/3): ...
[Auth] Retrying profile fetch in 1000ms...
[Auth] Profile fetch error (attempt 2/3): ...
[Auth] Retrying profile fetch in 1000ms...
[Auth] Profile fetch error (attempt 3/3): ...
[Auth] Profile not found, using session data as fallback
```

**Root causes:**
1. **user_profiles table not accessible** - RLS policy denying access
2. **Row doesn't exist** - User profile wasn't created during signup
3. **Database query slow** - Timeouts before completion

**Diagnostics:**
- Check RLS policies: Does the user have SELECT permission on user_profiles?
- Check if row exists: Query `SELECT * FROM user_profiles WHERE id = 'user-id'`
- Check database performance in Supabase dashboard

**Fix:**
- Create missing user_profiles row
- Update RLS policies if too restrictive
- Run RLS optimization migration to improve performance

---

### Problem 5: "Token refresh failed"

**Log pattern:**
```
[Auth] Token expiring soon, attempting refresh...
[Auth] Token refresh failed: ...
[Auth] SIGNED_OUT event received - clearing user state
```

**Root causes:**
1. **Refresh token expired** - User needs to sign in again
2. **Session was manually revoked** - Administrator action
3. **Network error** - Can't reach Supabase

**Diagnostics:**
- Check browser console for specific error message
- Check Supabase logs for token issues
- Check network connectivity

**Fix:**
- User must sign in again
- Check if admin revoked session
- Wait for network to stabilize, then refresh page

---

## Testing the Fixes

### Test 1: Verify RLS Optimization Reduced Timeout

1. Open DevTools console
2. Look for auth startup logs
3. Check that `[Auth] User state updated successfully` appears within 5-10 seconds (not 20+)

### Test 2: Verify Session Check is Running

1. Let page sit idle for 5+ minutes
2. Check console for `[Auth] Running periodic session check...`
3. Verify token expiration status is logged

### Test 3: Verify Manual Session Check Works

1. Open DevTools console
2. Run: `useAuth().checkAndRefreshSession()`
3. Should see session check logs appear

### Test 4: Test Token Refresh

1. Wait for `[Auth] Token expiring soon...` log (or simulate by checking token exp time)
2. Verify refresh succeeds with `[Auth] Token refreshed successfully`
3. Verify user remains logged in

---

## Logging Configuration

### To Enable More Verbose Logging

In AuthContext.jsx, change:
```javascript
// All console.log calls have [Auth] prefix - they're already visible
// For less logging, comment out specific lines
```

### To Disable Diagnostics in Production

Create a constant:
```javascript
const DEBUG_AUTH = process.env.NODE_ENV === 'development';

// Then wrap logs:
if (DEBUG_AUTH) console.log('[Auth]', ...);
```

---

## Further Investigation

If issues persist after applying these fixes:

1. **Check Supabase logs:**
   - Go to Supabase Dashboard → Logs
   - Filter by user ID or email
   - Look for RLS policy errors or database errors

2. **Check RLS policies:**
   - Go to Supabase → SQL Editor
   - Run: `SELECT * FROM pg_policies WHERE tablename = 'user_profiles';`
   - Verify policies match expected behavior

3. **Verify user_profiles row exists:**
   ```sql
   SELECT id, email, role, is_enabled FROM user_profiles WHERE id = 'user-id';
   ```

4. **Check JWT claims:**
   ```javascript
   const { data } = await supabase.auth.getSession();
   console.log('JWT Claims:', data.session.user);
   ```

5. **Test with curl:**
   ```bash
   # Test profile fetch directly
   curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
     https://your-project.supabase.co/rest/v1/user_profiles?id=eq.USER_ID
   ```

---

## Timeline of a Successful Auth Flow

Healthy authentication should show this sequence:

```
1. [Auth] Initializing...
2. [Auth] Updating user state for: user@example.com
3. [Auth] Session user metadata: { ... }
4. [Auth] User state updated successfully { role: "...", ... }
5. [Auth] State change: SIGNED_IN { hasSession: true, ... }
6. [Auth] Running periodic session check... (every 5 min)
7. [Auth] Session check: token expires in XXXX seconds
```

If any step fails or takes > 10 seconds, log the issue.

---

## Support

If you're still experiencing issues:

1. **Collect logs:** Screenshot the complete [Auth] log sequence
2. **Include session info:**
   - User email
   - User role
   - Timestamp when auth loss occurred
3. **Check recent changes:**
   - Recent RLS policy changes?
   - Recent user_profiles schema changes?
   - Recent Supabase configuration changes?

---

**Last Updated:** 2025-11-12
**Auth Timeout (INIT_AUTH):** 20000ms (20 seconds)
**Profile Fetch Timeout:** 15000ms (15 seconds)
**Session Check Interval:** 300000ms (5 minutes)
