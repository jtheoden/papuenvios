# 🔍 Payment Proof Loading Debug Guide

**Issue:** Payment proofs are not loading in Admin > Remesas modal

**Status:** Enhanced debugging has been implemented. Use this guide to identify the root cause.

---

## 📋 What Was Done

### 1. Enhanced Error Logging ✅
Added comprehensive console logging to identify the exact failure point:

- **generateProofSignedUrl()** now logs:
  - File path being processed
  - Whether it's a direct URL or file path
  - Detailed Supabase error information
  - Whether signed URL was generated successfully

- **AdminRemittancesTab** now logs:
  - When proof modal opens
  - Which file path is being requested
  - Success/failure of signed URL generation

### 2. Fixed Related Issue ✅
Fixed `confirmDelivery()` function to use file paths instead of invalid public URLs for delivery proofs.

### 3. RLS Policy Verification ✅
Verified that storage bucket RLS policies allow:
- Users can upload their own proofs
- Users can view their own proofs
- **Admins can view ALL payment proofs** ✓

---

## 🔧 How to Debug

### Step 1: Open Browser Console
1. Open Admin > Remesas page
2. Open **Developer Tools** (F12)
3. Go to **Console** tab

### Step 2: Try to View Payment Proof
1. Find a remittance with an uploaded payment proof
2. Click the proof icon to open the modal

### Step 3: Check Console Messages
Look for logged messages starting with:
- `[generateProofSignedUrl]` - Function execution logs
- `[AdminRemittancesTab]` - Modal handler logs

### Example Output Scenarios

#### ✅ SUCCESS (Image loads):
```
[AdminRemittancesTab] Opening proof modal for: user-id/REM-2025-0001.jpg
[AdminRemittancesTab] Generating signed URL from path
[generateProofSignedUrl] Generating signed URL for: user-id/REM-2025-0001.jpg
[generateProofSignedUrl] Successfully generated signed URL
[AdminRemittancesTab] Signed URL generated successfully
```

#### ❌ PERMISSION ERROR:
```
[generateProofSignedUrl] Supabase error: {
  message: "Access denied by storage.objects policy",
  status: 403
}
[generateProofSignedUrl] Policy error: User admin role not found in user_profiles
```

**Fix:** Admin user needs to have `role` set to `'admin'` or `'super_admin'` in `user_profiles` table.

#### ❌ FILE NOT FOUND:
```
[generateProofSignedUrl] Supabase error: {
  message: "The resource was not found",
  status: 404
}
```

**Fix:** The file path is incorrect or the file wasn't uploaded successfully. Check database.

#### ❌ INVALID FILE PATH:
```
[AdminRemittancesTab] Opening proof modal for: null
[AdminRemittancesTab] Opening proof modal for: undefined
```

**Fix:** The `payment_proof_url` field in the database is empty or NULL. User didn't successfully upload a proof.

---

## 🛠️ Common Issues & Solutions

### Issue 1: Admin Can't See Other Users' Proofs
**Symptoms:** 403 Forbidden error

**Cause:** Admin role not properly set in `user_profiles`

**Solution:**
```sql
-- Check current role
SELECT user_id, email, role FROM user_profiles WHERE user_id = auth.uid();

-- Set admin role
UPDATE user_profiles
SET role = 'admin'
WHERE user_id = auth.uid();
```

### Issue 2: File Path in Database is a URL (Old Format)
**Symptoms:** Image loads but might be old/broken

**Cause:** Old code stored full public URLs instead of file paths

**Solution:** ✅ Already handled! Code checks if it starts with http:// and uses directly.

### Issue 3: File Path Missing User ID
**Symptoms:** 404 or permission error

**Cause:** File was uploaded but user ID not in path

**Expected Path Format:** `{user-id}/{remittance-number}.{ext}`

**Verify:** Check `remittances.payment_proof_url` column in database for affected remittance.

### Issue 4: Storage Bucket RLS Policies Not Enabled
**Symptoms:** All files fail to load, even for the file owner

**Solution:** Check if RLS is enabled on storage.objects:
```sql
-- Run this in Supabase SQL Editor
SELECT
  objname,
  rowsecurity
FROM pg_class
WHERE relname = 'objects'
AND relnamespace = 'storage'::regnamespace;
```

Should return `rowsecurity = true`.

---

## 📊 Testing Checklist

- [ ] Verify admin user has role='admin' or role='super_admin'
- [ ] Check that payment_proof_url in database is file path (not URL)
- [ ] Verify file exists in remittance-proofs bucket
  - Go to Supabase Dashboard > Storage > remittance-proofs
  - Look for user-id folder with proof file
- [ ] Check browser console for error messages
- [ ] Test with F12 open to see exact error details

---

## 📚 Related Files

- Service: `/src/lib/remittanceService.js` - generateProofSignedUrl() function
- Component: `/src/components/AdminRemittancesTab.jsx` - Proof modal handler
- RLS Policies: `/supabase/CREATE_REMITTANCE_STORAGE.sql` - Storage bucket configuration
- Upload Function: `/src/lib/remittanceService.js` - uploadPaymentProof() function

---

## 🚀 Next Steps

1. **Check console errors** - Run through the debugging steps above
2. **Report the specific error** - Share the exact console message
3. **Verify admin role** - Ensure admin user has correct role in user_profiles
4. **Test file upload** - Verify proof file was actually uploaded to storage bucket

---

**Last Updated:** October 27, 2025
**Commits:**
- `c043fce8` - Dashboard grid optimization
- `75ed1c3f` - Payment proof debugging enhancements

