# Supabase Storage Buckets Setup Guide
**Created:** 2025-10-30
**Last Updated:** 2025-11-12
**Purpose:** Configuration guide for required Storage buckets

---

## Table of Contents
1. [Required Buckets](#required-buckets)
2. [Dashboard Setup Steps](#dashboard-setup-steps)
3. [Migration Application](#migration-application)
4. [Verification](#verification)
5. [Troubleshooting](#troubleshooting)

---

## Required Buckets

This project requires the following Storage buckets to be configured in Supabase Dashboard.

### 1. `order-delivery-proofs`
**Purpose:** Store delivery proof images uploaded by admins for order fulfillment
**Access:** Private (user + admin/manager)
**Status:** ⚠️ **NEEDS TO BE CREATED**

#### Dashboard Setup:

1. Go to Supabase Dashboard → Storage
2. Click "Create a new bucket"
3. Fill in the form as follows:

```
Bucket Name: order-delivery-proofs
Public bucket: ❌ NO (unchecked - Private)
File size limit: 5 MB
Allowed MIME types: image/jpeg, image/jpg, image/png, image/webp
```

4. Click "Create bucket"

**NOTE:** RLS Policies will be applied automatically via migration (see [Migration Application](#migration-application) section)

---

### 2. `remittance-delivery-proofs`
**Purpose:** Store delivery proof images for remittance fulfillment
**Access:** Private (user + admin/manager)
**Status:** ⚠️ **NEEDS TO BE CREATED**

#### Dashboard Setup:

1. Go to Supabase Dashboard → Storage
2. Click "Create a new bucket"
3. Fill in the form:

```
Bucket Name: remittance-delivery-proofs
Public bucket: ❌ NO (unchecked - Private)
File size limit: 5 MB
Allowed MIME types: image/jpeg, image/jpg, image/png, image/webp
```

4. Click "Create bucket"

**NOTE:** RLS Policies will be applied automatically via migration

---

### 3. `payment-proofs` (Existing)
**Purpose:** Store payment proof images uploaded by users for remittances
**Access:** Private (user + admin)
**Status:** ✅ Should already exist

#### Verification Query:
```sql
SELECT name, public
FROM storage.buckets
WHERE name = 'payment-proofs';
```

#### If Missing, Configure as:

```
Bucket Name: payment-proofs
Public bucket: ❌ NO (Private)
File size limit: 5 MB
Allowed MIME types: image/*, application/pdf
```

**RLS Policies:**

```sql
-- Users can upload their own payment proofs
CREATE POLICY "Users can upload payment proofs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'payment-proofs'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Users can read their own proofs, admins can read all
CREATE POLICY "Users/Admins can read payment proofs"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'payment-proofs'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR (auth.jwt() ->> 'user_role') IN ('admin', 'super_admin')
  )
);

-- Users can update their own proofs
CREATE POLICY "Users can update payment proofs"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'payment-proofs'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
```

---

### 3. `order-documents` (Order Payment Proofs)
**Purpose:** Store payment proof documents for product orders
**Access:** Private (user + admin)
**Status:** ✅ Should already exist

#### Verification:
```sql
SELECT name, public
FROM storage.buckets
WHERE name = 'order-documents';
```

#### Configuration (if missing):
```
Bucket Name: order-documents
Public bucket: ❌ NO (Private)
File size limit: 5 MB
Allowed MIME types: image/*, application/pdf
```

**RLS Policies:** Similar to `payment-proofs` above.

---

## Dashboard Setup Steps

### Quick Checklist

- [ ] Create `order-delivery-proofs` bucket (Private, 5MB limit, images only)
- [ ] Create `remittance-delivery-proofs` bucket (Private, 5MB limit, images only)
- [ ] Verify `payment-proofs` bucket exists

---

## Migration Application

After creating buckets in the Supabase Dashboard, apply RLS policies via migration:

### Step 1: Apply the Storage Migration

```bash
# Check migration status
npm run db:status

# Apply the storage bucket policies migration
npm run db:migrate
```

Expected output:
```
✓ 20251112000002_create_storage_buckets.sql
```

### Step 2: Verify RLS Policies Applied

```bash
# In Supabase SQL Editor, run:
SELECT schemaname, tablename, policyname
FROM pg_policies
WHERE schemaname = 'storage'
AND tablename = 'objects'
ORDER BY policyname;
```

You should see policies for:
- `users can upload order delivery proofs`
- `users can view order delivery proofs`
- `users can delete order delivery proofs`
- `admins can view all order delivery proofs`
- `users can upload remittance delivery proofs`
- `users can view remittance delivery proofs`
- `users can delete remittance delivery proofs`
- `admins can view all remittance delivery proofs`

---

## Verification

### Verify All Buckets Exist

After creating buckets in Dashboard and applying migrations, run this verification:

```sql
-- Check all required buckets exist
SELECT
  name,
  public,
  file_size_limit,
  allowed_mime_types
FROM storage.buckets
WHERE name IN (
  'order-delivery-proofs',
  'remittance-delivery-proofs',
  'payment-proofs',
  'order-documents'
)
ORDER BY name;

-- Should return 4 rows
```

Expected output:
```
name                          | public | file_size_limit | allowed_mime_types
-------------------------------|--------|-----------------|-------------------
order-delivery-proofs         | false  | 5242880         | image/jpeg, ...
order-documents               | false  | 5242880         | image/*, ...
payment-proofs                | false  | 5242880         | image/*, ...
remittance-delivery-proofs    | false  | 5242880         | image/jpeg, ...
```

---

## Troubleshooting

### Error: "bucket not found"
**Cause:** Bucket doesn't exist or is misconfigured
**Solution:** Create bucket following steps above

### Error: "new row violates row-level security policy"
**Cause:** RLS policies not configured or JWT missing user_role
**Solution:**
1. Verify policies are created
2. Check JWT contains `user_role` claim
3. Verify user has correct role in `user_profiles` table

### Error: "File too large"
**Cause:** File exceeds bucket size limit
**Solution:**
1. Increase file_size_limit in bucket settings
2. Or add client-side validation to prevent large uploads

---

## Related Files

- **Upload functions:** `/src/lib/remittanceService.js` (uploadPaymentProof)
- **Order delivery:** `/src/lib/orderService.js` (uploadDeliveryProof)
- **UI Components:** `/src/components/FileUploadWithPreview.jsx`

---

## Security Notes

🔒 **CRITICAL:**
- ALL buckets MUST be private (public = false)
- RLS policies MUST check user_role from JWT
- File paths SHOULD include user_id for user-uploaded files
- Admins MUST have access to all files for validation
- Implement file type validation in upload functions
- Set reasonable file size limits (5MB recommended)

---

## Next Steps

**Phase 1: Setup (Required)**
- [ ] Create `order-delivery-proofs` bucket in Supabase Dashboard
- [ ] Create `remittance-delivery-proofs` bucket in Supabase Dashboard
- [ ] Run `npm run db:migrate` to apply RLS policies
- [ ] Verify buckets and policies using SQL queries above

**Phase 2: Integration (Backend)**
- [ ] Update remittance service to use new bucket
- [ ] Update order service for delivery proofs
- [ ] Implement signed URL generation for private bucket access
- [ ] Add file type and size validation

**Phase 3: Testing (QA)**
- [ ] Test upload/download functionality
- [ ] Verify signed URL generation works
- [ ] Check error handling in upload functions
- [ ] Test RLS policies (users can only see their own files)
- [ ] Test admin/manager can see all files

---

## Summary of Changes

### Buckets to Create
| Bucket Name | Purpose | Access | Status |
|-------------|---------|--------|--------|
| `order-delivery-proofs` | Order delivery proofs | Private | New |
| `remittance-delivery-proofs` | Remittance delivery proofs | Private | New |
| `payment-proofs` | User payment proofs | Private | Existing |
| `order-documents` | Order payment proofs | Private | Existing |

### Related Migrations
- `20251112000002_create_storage_buckets.sql` - RLS policies for new buckets
- `20251112000002_create_storage_buckets.rollback.sql` - Rollback RLS policies

### Related Documentation
- [AUTH_DIAGNOSTICS.md](../AUTH_DIAGNOSTICS.md) - Authentication troubleshooting
- [EXECUTION_GUIDE.md](./EXECUTION_GUIDE.md) - Migration execution guide

---

**Last Updated:** 2025-11-12
**Maintained By:** Development Team
