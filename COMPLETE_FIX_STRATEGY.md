# 🔧 Complete System Diagnosis & Fix Strategy

## 📋 Executive Summary

Your application is experiencing **3 critical infrastructure issues**:

1. **Profile Fetch Timeouts** - Database queries timing out (RLS/permissions issue)
2. **Auth Session Loss** - Users losing authentication after time
3. **Storage Bucket Missing** - File uploads failing with 404 errors

**Root Cause**: The database infrastructure setup is incomplete. While tables exist, critical components (RLS policies, storage buckets, user profiles) were not properly configured.

---

## 🔍 Issue #1: Profile Fetch Timeouts

### Symptoms
```
[Auth] Profile fetch failed (attempt 1/3): Profile fetch timeout
[Auth] Profile fetch failed (attempt 2/3): Profile fetch timeout
[Auth] Profile fetch failed (attempt 3/3): Profile fetch timeout
[Auth] Profile not found, using session data as fallback
```

### Root Causes (One or More)
1. ❌ **Your user profile doesn't exist in `user_profiles` table**
2. ❌ **RLS policies are blocking the query**
3. ❌ **Missing indexes causing slow queries**
4. ❌ **The `is_admin_user()` function has errors**
5. ❌ **FIX_TIMEOUTS_FINAL.sql was never executed**

### Impact
- Users cannot access their profile data
- Role-based permissions don't work
- Auth falls back to 'user' role (no admin access)
- Slow loading times

---

## 🔍 Issue #2: Authorization Gets Lost

### Symptoms
- User is authenticated initially
- After some time, auth is lost
- User must re-login

### Root Causes
1. ❌ **Profile fetch failures** → incomplete user state → session cleanup
2. ❌ **RLS policies blocking profile reads intermittently**
3. ❌ **Token refresh failing** due to database permission issues

### Impact
- Poor user experience
- Data loss (unsaved work)
- Security concerns

---

## 🔍 Issue #3: Storage Bucket Not Found

### Symptoms
```json
{"statusCode":"404","error":"Bucket not found","message":"Bucket not found"}
```

### Root Causes
❌ **Storage buckets were never created in Supabase**

Required buckets:
- `remittance-proofs` - For remittance payment proofs
- `order-delivery-proofs` - For order delivery proofs
- `remittance-delivery-proofs` - For remittance delivery proofs

### Impact
- Users cannot upload payment proofs
- Delivery proof uploads fail
- Core remittance workflow is broken

---

## 🛠️ Fix Strategy - Step by Step

### ✅ STEP 1: Diagnose Current State

**Action**: Run diagnostic SQL to understand current database state

**Script**: `DIAGNOSE_DATABASE.sql`

**How**:
1. Open Supabase SQL Editor: https://app.supabase.com/project/qcwnlbpultscerwdnzbm/sql
2. Copy entire content of `DIAGNOSE_DATABASE.sql`
3. Paste and run
4. Review results - note what's missing

**Expected Issues**:
- ❌ No user profile for jtheoden@googlemail.com
- ❌ No storage buckets
- ⚠️ RLS enabled but policies may be problematic
- ⚠️ `is_admin_user()` function may have errors

**Time**: 2 minutes

---

### ✅ STEP 2: Verify FIX_TIMEOUTS_FINAL.sql Was Executed

**Check**: Did you successfully run `FIX_TIMEOUTS_FINAL.sql`?

**If NO** → Run it now:
1. Open `FIX_TIMEOUTS_FINAL.sql` in your local VS Code
2. Copy entire contents
3. Paste in Supabase SQL Editor
4. Run and verify no errors

**If YES** → Check if it completed successfully:
- Look for `✅ SETUP COMPLETE!` message
- Check for any errors in the output

**Time**: 2-5 minutes

---

### ✅ STEP 3: Create Your User Profile

**Problem**: Your user account exists in `auth.users` but not in `user_profiles` table

**Fix**: Run this SQL in Supabase SQL Editor:

```sql
-- Get your user_id from auth
SELECT id, email FROM auth.users WHERE email = 'jtheoden@googlemail.com';

-- Create your profile (replace YOUR_USER_ID with the id from above)
INSERT INTO user_profiles (
    id,
    user_id,
    email,
    role,
    is_enabled,
    full_name,
    created_at,
    updated_at
)
VALUES (
    'YOUR_USER_ID',  -- Replace this
    'YOUR_USER_ID',  -- Replace this
    'jtheoden@googlemail.com',
    'super_admin',
    true,
    'Jose Theoden',  -- Your name
    NOW(),
    NOW()
)
ON CONFLICT (id) DO UPDATE SET
    role = 'super_admin',
    is_enabled = true,
    updated_at = NOW();

-- Verify
SELECT * FROM user_profiles WHERE email = 'jtheoden@googlemail.com';
```

**Expected Result**: Your profile now exists with `super_admin` role

**Time**: 2 minutes

---

### ✅ STEP 4: Create Storage Buckets

**Problem**: No storage buckets exist for file uploads

**Fix**: Run this SQL in Supabase SQL Editor:

```sql
-- Create remittance-proofs bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'remittance-proofs',
    'remittance-proofs',
    false,
    10485760,  -- 10MB
    ARRAY['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Create order-delivery-proofs bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'order-delivery-proofs',
    'order-delivery-proofs',
    false,
    10485760,  -- 10MB
    ARRAY['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Create remittance-delivery-proofs bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'remittance-delivery-proofs',
    'remittance-delivery-proofs',
    false,
    10485760,  -- 10MB
    ARRAY['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Verify buckets were created
SELECT * FROM storage.buckets ORDER BY name;
```

**Expected Result**: 3 buckets created

**Time**: 1 minute

---

### ✅ STEP 5: Create Storage Bucket Policies

**Problem**: Buckets exist but users can't upload files (no policies)

**Fix**: Run this SQL in Supabase SQL Editor:

```sql
-- ============================================================================
-- STORAGE POLICIES FOR remittance-proofs
-- ============================================================================

-- Allow authenticated users to upload their own files
CREATE POLICY "Users can upload their own remittance proofs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'remittance-proofs'
    AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow users to read their own files
CREATE POLICY "Users can read their own remittance proofs"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'remittance-proofs'
    AND (
        auth.uid()::text = (storage.foldername(name))[1]
        OR EXISTS (
            SELECT 1 FROM user_profiles
            WHERE user_id = auth.uid()
            AND role IN ('admin', 'super_admin')
        )
    )
);

-- Allow users to delete their own files
CREATE POLICY "Users can delete their own remittance proofs"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'remittance-proofs'
    AND (
        auth.uid()::text = (storage.foldername(name))[1]
        OR EXISTS (
            SELECT 1 FROM user_profiles
            WHERE user_id = auth.uid()
            AND role IN ('admin', 'super_admin')
        )
    )
);

-- ============================================================================
-- STORAGE POLICIES FOR order-delivery-proofs
-- ============================================================================

CREATE POLICY "Users can upload order delivery proofs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'order-delivery-proofs'
    AND (
        auth.uid()::text = (storage.foldername(name))[1]
        OR EXISTS (
            SELECT 1 FROM user_profiles
            WHERE user_id = auth.uid()
            AND role IN ('admin', 'super_admin')
        )
    )
);

CREATE POLICY "Users can read order delivery proofs"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'order-delivery-proofs'
    AND (
        auth.uid()::text = (storage.foldername(name))[1]
        OR EXISTS (
            SELECT 1 FROM user_profiles
            WHERE user_id = auth.uid()
            AND role IN ('admin', 'super_admin')
        )
    )
);

CREATE POLICY "Users can delete order delivery proofs"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'order-delivery-proofs'
    AND (
        auth.uid()::text = (storage.foldername(name))[1]
        OR EXISTS (
            SELECT 1 FROM user_profiles
            WHERE user_id = auth.uid()
            AND role IN ('admin', 'super_admin')
        )
    )
);

-- ============================================================================
-- STORAGE POLICIES FOR remittance-delivery-proofs
-- ============================================================================

CREATE POLICY "Users can upload remittance delivery proofs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'remittance-delivery-proofs'
    AND EXISTS (
        SELECT 1 FROM user_profiles
        WHERE user_id = auth.uid()
        AND role IN ('admin', 'super_admin')
    )
);

CREATE POLICY "Users can read remittance delivery proofs"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'remittance-delivery-proofs'
    AND (
        auth.uid()::text = (storage.foldername(name))[1]
        OR EXISTS (
            SELECT 1 FROM user_profiles
            WHERE user_id = auth.uid()
            AND role IN ('admin', 'super_admin')
        )
    )
);

CREATE POLICY "Admins can delete remittance delivery proofs"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'remittance-delivery-proofs'
    AND EXISTS (
        SELECT 1 FROM user_profiles
        WHERE user_id = auth.uid()
        AND role IN ('admin', 'super_admin')
    )
);

-- Verify policies were created
SELECT
    bucket_id,
    name as policy_name,
    definition
FROM storage.policies
ORDER BY bucket_id, name;
```

**Expected Result**: Storage policies created for all 3 buckets

**Time**: 2 minutes

---

### ✅ STEP 6: Test Profile Fetch

**Problem**: Verify user profile can now be fetched

**Fix**: Run this SQL to test:

```sql
-- Simulate what the app does
SELECT
    role,
    is_enabled,
    avatar_url,
    full_name,
    email
FROM user_profiles
WHERE id = (
    SELECT id FROM auth.users
    WHERE email = 'jtheoden@googlemail.com'
    LIMIT 1
);
```

**Expected Result**: Your profile data returned instantly (no timeout)

**Time**: 30 seconds

---

### ✅ STEP 7: Clear Browser & Test Application

**Actions**:

1. **Clear browser cache and storage**:
   - Press `Ctrl + Shift + Delete`
   - Select "Cached images and files", "Cookies", "Local storage"
   - Click "Clear data"

2. **Hard refresh**:
   - Close all localhost:5173 tabs
   - Open new tab
   - Go to http://localhost:5173/
   - Press `Ctrl + Shift + R` to hard refresh

3. **Login**:
   - Login with jtheoden@googlemail.com
   - Watch browser console for errors

**Expected Result**:
- ✅ No profile fetch timeouts
- ✅ Login completes quickly
- ✅ User role is `super_admin`
- ✅ No RLS errors

**Time**: 2 minutes

---

### ✅ STEP 8: Test File Upload

**Actions**:

1. Navigate to remittances section
2. Try to upload a payment proof
3. Watch browser console for errors

**Expected Result**:
- ✅ No "Bucket not found" errors
- ✅ File uploads successfully
- ✅ File appears in Supabase Storage

**Time**: 2 minutes

---

## 📊 Verification Checklist

After completing all steps, verify:

- [ ] User profile exists for jtheoden@googlemail.com
- [ ] User role is `super_admin`
- [ ] Profile fetch completes in < 1 second
- [ ] No timeout errors in console
- [ ] Auth persists after refresh
- [ ] Auth persists after 10 minutes
- [ ] 3 storage buckets exist
- [ ] File upload works without errors
- [ ] Can view uploaded files
- [ ] RLS policies allow proper access

---

## 🚨 If Issues Persist

### Profile Still Timing Out
1. Check if `is_admin_user()` function has errors
2. Disable RLS temporarily on `user_profiles` to test
3. Check PostgreSQL logs in Supabase dashboard

### Auth Still Lost
1. Check token expiry settings
2. Verify session refresh is working
3. Check for RLS policy conflicts

### Upload Still Failing
1. Verify bucket names match exactly
2. Check storage policies are created
3. Test with Supabase Storage UI directly

---

## 📝 Next Steps After Fix

1. **Create initial data**:
   - Add at least 1 Zelle account
   - Create remittance types
   - Configure WhatsApp admin number

2. **Test complete workflows**:
   - Create order → upload proof → admin review
   - Create remittance → upload proof → admin validate → delivery

3. **Performance monitoring**:
   - Monitor query times in Supabase
   - Watch for any new timeout errors

---

## 📚 Standards Compliance

This fix strategy follows the project standards defined in:
- ✅ `PROYECTO_STATUS.md` - Infrastructure requirements
- ✅ `AUTHORIZATION_FIX_INSTRUCTIONS.md` - RLS best practices
- ✅ `ESTADO_Y_PENDIENTES.md` - Critical pending tasks
- ✅ `ACCIONES_REQUERIDAS.md` - Required setup steps

---

## ⏱️ Total Time Estimate

- **Diagnosis**: 5 minutes
- **Database fixes**: 10 minutes
- **Testing**: 5 minutes
- **Total**: ~20 minutes

---

## 🎯 Success Criteria

✅ **Application loads without errors**
✅ **Login completes in < 2 seconds**
✅ **Profile data loads correctly**
✅ **Auth persists across refreshes**
✅ **File uploads work**
✅ **Admin access granted**

---

**Ready to start? Begin with STEP 1: Run DIAGNOSE_DATABASE.sql**
