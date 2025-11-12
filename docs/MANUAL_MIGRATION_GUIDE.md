# Manual Migration Execution Guide
**Created:** 2025-11-12
**Purpose:** Execute Supabase migrations directly via Dashboard SQL Editor

---

## Prerequisites

- Access to [Supabase Dashboard](https://supabase.com/dashboard)
- Project: `qcwnlbpultscerwdnzbm`

---

## STEP 1: Create Storage Buckets (MUST DO FIRST)

1. Go to **Supabase Dashboard** → Your Project
2. Click **Storage** (left sidebar)
3. Click **"Create a new bucket"**

### Bucket 1: `order-delivery-proofs`
- **Name:** `order-delivery-proofs`
- **Private bucket:** ✅ YES (uncheck "public")
- **File size limit:** 5 MB
- Click **Create bucket**

### Bucket 2: `remittance-delivery-proofs`
- **Name:** `remittance-delivery-proofs`
- **Private bucket:** ✅ YES (uncheck "public")
- **File size limit:** 5 MB
- Click **Create bucket**

✅ **Both buckets should now exist in Storage**

---

## STEP 2: Execute Migrations in SQL Editor

1. Go to **SQL Editor** (left sidebar)
2. Click **"New query"**
3. Copy and paste each migration SQL **IN ORDER** (below)
4. Click **"Run"** button for each one
5. Wait for success message

---

## ⚠️ IMPORTANTE - Usar Versiones CORREGIDAS

Las migraciones han sido actualizadas para coincidir con tu esquema actual.
**Usa las versiones _CORRECTED:**
- `20251112000001_optimize_rls_policies_CORRECTED.sql`
- `20251112000003_add_manager_role_CORRECTED.sql`
- `20251112000004_user_categorization_system_CORRECTED.sql`

Cambios principales:
- ✅ `remittances` usa `user_id` (no `sender_id`)
- ✅ `user_profiles` relacionamiento actualizado
- ✅ Constraints de roles actualizados

---

## Migration 1: RLS Optimization (CORRECTED)

**File:** `20251112000001_optimize_rls_policies_CORRECTED.sql`

```sql
-- ============================================================================
-- RLS POLICIES OPTIMIZATION - Create STABLE Functions and Replace Subqueries
-- Created: 2025-11-12
-- ============================================================================

-- ============================================================================
-- STEP 1: Create STABLE Functions for Role Checking
-- ============================================================================

CREATE OR REPLACE FUNCTION current_user_id() RETURNS uuid AS $$
  SELECT auth.uid();
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION current_user_role() RETURNS text AS $$
  SELECT COALESCE(role, 'user')
  FROM public.user_profiles
  WHERE id = auth.uid()
  LIMIT 1;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION is_admin() RETURNS boolean AS $$
  SELECT COALESCE(role = 'admin', false)
  FROM public.user_profiles
  WHERE id = auth.uid()
  LIMIT 1;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION is_super_admin() RETURNS boolean AS $$
  SELECT COALESCE(role = 'super_admin', false)
  FROM public.user_profiles
  WHERE id = auth.uid()
  LIMIT 1;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION is_manager() RETURNS boolean AS $$
  SELECT COALESCE(role = 'manager', false)
  FROM public.user_profiles
  WHERE id = auth.uid()
  LIMIT 1;
$$ LANGUAGE sql STABLE;

-- ============================================================================
-- STEP 2: Optimize user_profiles RLS Policies
-- ============================================================================

DROP POLICY IF EXISTS "users can view own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "users can update own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "admins can view all profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "admins can update any profile" ON public.user_profiles;

CREATE POLICY "users can view own profile"
ON public.user_profiles
FOR SELECT
TO authenticated
USING (id = current_user_id());

CREATE POLICY "users can update own profile"
ON public.user_profiles
FOR UPDATE
TO authenticated
USING (id = current_user_id())
WITH CHECK (id = current_user_id());

CREATE POLICY "admins can view all profiles"
ON public.user_profiles
FOR SELECT
TO authenticated
USING (is_admin() OR is_super_admin());

CREATE POLICY "admins can update any profile"
ON public.user_profiles
FOR UPDATE
TO authenticated
USING (is_admin() OR is_super_admin())
WITH CHECK (is_admin() OR is_super_admin());

CREATE POLICY "public can view basic profile info"
ON public.user_profiles
FOR SELECT
TO public
USING (true);

-- ============================================================================
-- STEP 3: Optimize orders RLS Policies
-- ============================================================================

DROP POLICY IF EXISTS "users can view own orders" ON public.orders;
DROP POLICY IF EXISTS "users can insert own orders" ON public.orders;
DROP POLICY IF EXISTS "users can update own orders" ON public.orders;
DROP POLICY IF EXISTS "admins can view all orders" ON public.orders;
DROP POLICY IF EXISTS "admins can update all orders" ON public.orders;

CREATE POLICY "users can view own orders"
ON public.orders
FOR SELECT
TO authenticated
USING (user_id = current_user_id());

CREATE POLICY "users can insert own orders"
ON public.orders
FOR INSERT
TO authenticated
WITH CHECK (user_id = current_user_id());

CREATE POLICY "users can update own orders"
ON public.orders
FOR UPDATE
TO authenticated
USING (user_id = current_user_id())
WITH CHECK (user_id = current_user_id());

CREATE POLICY "admins can view all orders"
ON public.orders
FOR SELECT
TO authenticated
USING (is_admin() OR is_super_admin());

CREATE POLICY "admins can update all orders"
ON public.orders
FOR UPDATE
TO authenticated
USING (is_admin() OR is_super_admin())
WITH CHECK (is_admin() OR is_super_admin());

-- ============================================================================
-- STEP 4: Optimize remittances RLS Policies
-- ============================================================================

DROP POLICY IF EXISTS "users can view own remittances" ON public.remittances;
DROP POLICY IF EXISTS "users can insert remittances" ON public.remittances;
DROP POLICY IF EXISTS "users can update own remittances" ON public.remittances;
DROP POLICY IF EXISTS "admins can view all remittances" ON public.remittances;
DROP POLICY IF EXISTS "admins can update all remittances" ON public.remittances;

CREATE POLICY "users can view own remittances"
ON public.remittances
FOR SELECT
TO authenticated
USING (sender_id = current_user_id());

CREATE POLICY "users can insert remittances"
ON public.remittances
FOR INSERT
TO authenticated
WITH CHECK (sender_id = current_user_id());

CREATE POLICY "users can update own remittances"
ON public.remittances
FOR UPDATE
TO authenticated
USING (sender_id = current_user_id())
WITH CHECK (sender_id = current_user_id());

CREATE POLICY "admins can view all remittances"
ON public.remittances
FOR SELECT
TO authenticated
USING (is_admin() OR is_super_admin());

CREATE POLICY "admins can update all remittances"
ON public.remittances
FOR UPDATE
TO authenticated
USING (is_admin() OR is_super_admin())
WITH CHECK (is_admin() OR is_super_admin());

-- ============================================================================
-- STEP 5: Optimize products RLS Policies
-- ============================================================================

DROP POLICY IF EXISTS "anyone can view products" ON public.products;
DROP POLICY IF EXISTS "admins can insert products" ON public.products;
DROP POLICY IF EXISTS "admins can update products" ON public.products;
DROP POLICY IF EXISTS "admins can delete products" ON public.products;

CREATE POLICY "anyone can view products"
ON public.products
FOR SELECT
TO public
USING (true);

CREATE POLICY "admins can insert products"
ON public.products
FOR INSERT
TO authenticated
WITH CHECK (is_admin() OR is_super_admin());

CREATE POLICY "admins can update products"
ON public.products
FOR UPDATE
TO authenticated
USING (is_admin() OR is_super_admin())
WITH CHECK (is_admin() OR is_super_admin());

CREATE POLICY "admins can delete products"
ON public.products
FOR DELETE
TO authenticated
USING (is_admin() OR is_super_admin());

-- ============================================================================
-- STEP 6: Optimize combos RLS Policies
-- ============================================================================

DROP POLICY IF EXISTS "anyone can view combos" ON public.combos;
DROP POLICY IF EXISTS "admins can manage combos" ON public.combos;

CREATE POLICY "anyone can view combos"
ON public.combos
FOR SELECT
TO public
USING (true);

CREATE POLICY "admins can manage combos"
ON public.combos
FOR INSERT
TO authenticated
WITH CHECK (is_admin() OR is_super_admin());

CREATE POLICY "admins can update combos"
ON public.combos
FOR UPDATE
TO authenticated
USING (is_admin() OR is_super_admin())
WITH CHECK (is_admin() OR is_super_admin());

CREATE POLICY "admins can delete combos"
ON public.combos
FOR DELETE
TO authenticated
USING (is_admin() OR is_super_admin());

-- ============================================================================
-- STEP 7: Optimize testimonials RLS Policies
-- ============================================================================

DROP POLICY IF EXISTS "anyone can view testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "users can insert testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "admins can manage testimonials" ON public.testimonials;

CREATE POLICY "anyone can view testimonials"
ON public.testimonials
FOR SELECT
TO public
USING (approved = true);

CREATE POLICY "users can view own testimonials"
ON public.testimonials
FOR SELECT
TO authenticated
USING (user_id = current_user_id() OR is_admin() OR is_super_admin());

CREATE POLICY "users can insert testimonials"
ON public.testimonials
FOR INSERT
TO authenticated
WITH CHECK (user_id = current_user_id());

CREATE POLICY "admins can update testimonials"
ON public.testimonials
FOR UPDATE
TO authenticated
USING (is_admin() OR is_super_admin())
WITH CHECK (is_admin() OR is_super_admin());

CREATE POLICY "admins can delete testimonials"
ON public.testimonials
FOR DELETE
TO authenticated
USING (is_admin() OR is_super_admin());

-- ============================================================================
-- STEP 8: Optimize bank_accounts RLS Policies
-- ============================================================================

DROP POLICY IF EXISTS "users can view bank accounts" ON public.bank_accounts;
DROP POLICY IF EXISTS "admins can manage bank accounts" ON public.bank_accounts;

CREATE POLICY "users can view bank accounts"
ON public.bank_accounts
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "public can view bank accounts"
ON public.bank_accounts
FOR SELECT
TO public
USING (true);

CREATE POLICY "admins can insert bank accounts"
ON public.bank_accounts
FOR INSERT
TO authenticated
WITH CHECK (is_admin() OR is_super_admin());

CREATE POLICY "admins can update bank accounts"
ON public.bank_accounts
FOR UPDATE
TO authenticated
USING (is_admin() OR is_super_admin())
WITH CHECK (is_admin() OR is_super_admin());

CREATE POLICY "admins can delete bank accounts"
ON public.bank_accounts
FOR DELETE
TO authenticated
USING (is_admin() OR is_super_admin());

-- ============================================================================
-- STEP 9: Grant execute permissions on functions
-- ============================================================================

GRANT EXECUTE ON FUNCTION current_user_id() TO authenticated, public;
GRANT EXECUTE ON FUNCTION current_user_role() TO authenticated, public;
GRANT EXECUTE ON FUNCTION is_admin() TO authenticated, public;
GRANT EXECUTE ON FUNCTION is_super_admin() TO authenticated, public;
GRANT EXECUTE ON FUNCTION is_manager() TO authenticated, public;
```

✅ **Expected:** Query ran successfully

---

## Migration 2: Storage Buckets RLS

**File:** `20251112000002_create_storage_buckets.sql`

```sql
-- ============================================================================
-- STORAGE BUCKETS RLS POLICIES
-- Created: 2025-11-12
-- ============================================================================

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Order Delivery Proofs
CREATE POLICY "users can upload order delivery proofs"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'order-delivery-proofs' AND
  (auth.uid())::text = (storage.foldername(name))[1]
);

CREATE POLICY "users can view order delivery proofs"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'order-delivery-proofs' AND
  (
    (auth.uid())::text = (storage.foldername(name))[1] OR
    EXISTS (
      SELECT 1 FROM public.orders
      WHERE id = (storage.foldername(name))[2]::uuid
      AND (
        orders.user_id = auth.uid() OR
        EXISTS (
          SELECT 1 FROM public.user_profiles
          WHERE id = auth.uid()
          AND role IN ('admin', 'super_admin', 'manager')
        )
      )
    )
  )
);

CREATE POLICY "users can delete order delivery proofs"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'order-delivery-proofs' AND
  (auth.uid())::text = (storage.foldername(name))[1]
);

CREATE POLICY "admins can view all order delivery proofs"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'order-delivery-proofs' AND
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid()
    AND role IN ('admin', 'super_admin')
  )
);

-- Remittance Delivery Proofs
CREATE POLICY "users can upload remittance delivery proofs"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'remittance-delivery-proofs' AND
  (auth.uid())::text = (storage.foldername(name))[1]
);

CREATE POLICY "users can view remittance delivery proofs"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'remittance-delivery-proofs' AND
  (
    (auth.uid())::text = (storage.foldername(name))[1] OR
    EXISTS (
      SELECT 1 FROM public.remittances
      WHERE id = (storage.foldername(name))[2]::uuid
      AND (
        remittances.sender_id = auth.uid() OR
        EXISTS (
          SELECT 1 FROM public.user_profiles
          WHERE id = auth.uid()
          AND role IN ('admin', 'super_admin', 'manager')
        )
      )
    )
  )
);

CREATE POLICY "users can delete remittance delivery proofs"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'remittance-delivery-proofs' AND
  (auth.uid())::text = (storage.foldername(name))[1]
);

CREATE POLICY "admins can view all remittance delivery proofs"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'remittance-delivery-proofs' AND
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid()
    AND role IN ('admin', 'super_admin', 'manager')
  )
);
```

✅ **Expected:** Query ran successfully

---

## Migration 3: Manager Role

**File:** `20251112000003_add_manager_role.sql`

```sql
-- ============================================================================
-- ADD MANAGER ROLE
-- Created: 2025-11-12
-- ============================================================================

-- Update role check constraint
ALTER TABLE public.user_profiles
DROP CONSTRAINT IF EXISTS user_profiles_role_check;

ALTER TABLE public.user_profiles
ADD CONSTRAINT user_profiles_role_check
CHECK (role IN ('user', 'admin', 'super_admin', 'manager'));

-- Create Manager Assignments Table
CREATE TABLE IF NOT EXISTS public.manager_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  assigned_by uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  scope text DEFAULT 'all',
  assigned_at timestamp with time zone DEFAULT now(),
  removed_at timestamp with time zone,
  reason text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

COMMENT ON TABLE public.manager_assignments IS
'Tracks manager role assignments and their scope.';

CREATE INDEX idx_manager_assignments_manager_id
  ON public.manager_assignments(manager_id)
  WHERE removed_at IS NULL;

CREATE INDEX idx_manager_assignments_assigned_by
  ON public.manager_assignments(assigned_by);

CREATE INDEX idx_manager_assignments_scope
  ON public.manager_assignments(scope)
  WHERE removed_at IS NULL;

-- Enable RLS
ALTER TABLE public.manager_assignments ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "managers can view own assignment"
ON public.manager_assignments
FOR SELECT
TO authenticated
USING (manager_id = auth.uid());

CREATE POLICY "super admins can view all assignments"
ON public.manager_assignments
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid()
    AND role = 'super_admin'
  )
);

CREATE POLICY "super admins can create assignments"
ON public.manager_assignments
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid()
    AND role = 'super_admin'
  )
);

CREATE POLICY "super admins can update assignments"
ON public.manager_assignments
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid()
    AND role = 'super_admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid()
    AND role = 'super_admin'
  )
);

CREATE POLICY "super admins can delete assignments"
ON public.manager_assignments
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid()
    AND role = 'super_admin'
  )
);

-- Create assignment functions
CREATE OR REPLACE FUNCTION public.assign_manager_role(
  p_manager_id uuid,
  p_scope text DEFAULT 'all',
  p_reason text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = v_user_id AND role = 'super_admin'
  ) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Only super_admin can assign manager role'
    );
  END IF;

  UPDATE public.user_profiles
  SET role = 'manager'
  WHERE id = p_manager_id;

  INSERT INTO public.manager_assignments (
    manager_id,
    assigned_by,
    scope,
    reason
  )
  VALUES (p_manager_id, v_user_id, p_scope, p_reason);

  RETURN json_build_object(
    'success', true,
    'message', 'Manager role assigned successfully',
    'manager_id', p_manager_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_manager_role(p_manager_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = v_user_id AND role = 'super_admin'
  ) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Only super_admin can remove manager role'
    );
  END IF;

  UPDATE public.user_profiles
  SET role = 'user'
  WHERE id = p_manager_id;

  UPDATE public.manager_assignments
  SET removed_at = now()
  WHERE manager_id = p_manager_id
  AND removed_at IS NULL;

  RETURN json_build_object(
    'success', true,
    'message', 'Manager role removed successfully',
    'manager_id', p_manager_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_manager_role TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_manager_role TO authenticated;
```

✅ **Expected:** Query ran successfully

---

## Migration 4: User Categorization System

**File:** `20251112000004_user_categorization_system.sql`

**This is a LONG migration. Copy from the file directly:**

Go to `/supabase/migrations/20251112000004_user_categorization_system.sql` and copy the entire content. It's too long to paste here but includes:
- user_categories table
- user_category_history table
- category_rules table
- category_discounts table
- 4 functions for auto/manual categorization
- RLS policies

✅ **Expected:** Query ran successfully

---

## Migration 5: Seed Initial Data

**File:** `20251112000005_seed_initial_data.sql`

**IMPORTANT:** Before running this, you need to:

1. Get your super admin user ID from Supabase Auth
2. In **Settings** → **Database** → **Users** (or SQL Editor):
   ```sql
   SELECT id, email FROM auth.users WHERE email = 'jtheoden@googlemail.com';
   ```
3. Copy the UUID returned

Then replace `'super-admin-uuid-placeholder'` in the seed script with your actual UUID:

```sql
-- ============================================================================
-- SEED INITIAL DATA
-- ============================================================================

INSERT INTO public.user_profiles (
  id,
  email,
  full_name,
  role,
  is_enabled,
  created_at
)
VALUES (
  'YOUR-UUID-HERE', -- REPLACE THIS
  'jtheoden@googlemail.com',
  'Super Admin',
  'super_admin',
  true,
  now()
)
ON CONFLICT (id) DO UPDATE
SET role = 'super_admin', is_enabled = true;

-- ============================================================================
-- SEED CUBAN BANKS
-- ============================================================================

INSERT INTO public.bank_accounts (
  name,
  code,
  country,
  logo_url,
  is_active,
  created_at
)
VALUES
  ('Banco Nacional de Cuba', 'BNC', 'Cuba', '/bank-logos/bandec.jpg', true, now()),
  ('Banco de Finanzas Internacionales', 'BFI', 'Cuba', '/bank-logos/bfi.png', true, now()),
  ('Banco Popular de Ahorros', 'BPA', 'Cuba', '/bank-logos/bpa.jpg', true, now()),
  ('Banco Metropolitano de Cuba', 'BMC', 'Cuba', '/bank-logos/metropolitano.jpg', true, now())
ON CONFLICT (code) DO UPDATE
SET is_active = true, updated_at = now();

-- ============================================================================
-- SEED REMITTANCE TYPES
-- ============================================================================

INSERT INTO public.remittance_types (
  name,
  description,
  requires_bank_account,
  is_active,
  created_at
)
VALUES
  ('Transferencia Bancaria', 'Envío de dinero mediante transferencia a cuenta bancaria', true, true, now()),
  ('Entrega en Efectivo', 'Envío de dinero en efectivo para entrega personal', false, true, now()),
  ('Monedero Digital', 'Envío a billeteras digitales y apps de pago', false, true, now())
ON CONFLICT (name) DO UPDATE
SET is_active = true, updated_at = now();

-- ============================================================================
-- SEED CURRENCIES
-- ============================================================================

INSERT INTO public.currencies (
  code,
  name,
  symbol,
  exchange_rate_to_usd,
  is_active,
  created_at
)
VALUES
  ('USD', 'Dólar Estadounidense', '$', 1.00, true, now()),
  ('CUP', 'Peso Cubano', '₱', 0.037, true, now()),
  ('EUR', 'Euro', '€', 1.09, true, now())
ON CONFLICT (code) DO UPDATE
SET is_active = true, updated_at = now();

-- ============================================================================
-- SEED CATEGORY RULES
-- ============================================================================

INSERT INTO public.category_rules (category_name, interaction_threshold, description, color_code)
VALUES
  ('regular', 0, 'New users (0-4 interactions)', '#808080'),
  ('pro', 5, 'Active users (5-9 interactions)', '#3B82F6'),
  ('vip', 10, 'Premium users (10+ interactions)', '#FFD700')
ON CONFLICT (category_name) DO NOTHING;

-- ============================================================================
-- SEED VISUAL SETTINGS
-- ============================================================================

INSERT INTO public.visual_settings (
  setting_key,
  setting_value,
  setting_type,
  description
)
VALUES
  ('app_name', 'PapuEnvios', 'text', 'Application name'),
  ('site_title', 'PapuEnvios - Remesas y E-Commerce', 'text', 'HTML page title'),
  ('logo_text', 'Papu', 'text', 'Logo text in header'),
  ('favicon_url', '/favicon.ico', 'text', 'Favicon URL'),
  ('primary_color', '#3B82F6', 'color', 'Primary brand color'),
  ('secondary_color', '#10B981', 'color', 'Secondary brand color'),
  ('support_email', 'soporte@papuenvios.com', 'text', 'Support email'),
  ('support_phone', '+53-XXXXXXX', 'text', 'Support phone'),
  ('maintenance_mode', 'false', 'boolean', 'Maintenance mode')
ON CONFLICT (setting_key) DO UPDATE
SET setting_value = EXCLUDED.setting_value,
    updated_at = now();

-- ============================================================================
-- SEED PAYMENT METHODS
-- ============================================================================

INSERT INTO public.payment_methods (
  name,
  description,
  is_active,
  requires_proof,
  created_at
)
VALUES
  ('Transferencia Bancaria', 'Transferencia bancaria nacional o internacional', true, true, now()),
  ('Depósito en Efectivo', 'Depósito en agencia bancaria', true, true, now()),
  ('Billetera Digital', 'Pago mediante aplicación de billetera digital', true, true, now()),
  ('Tarjeta de Crédito', 'Pago con tarjeta de crédito', false, false, now())
ON CONFLICT (name) DO UPDATE
SET is_active = EXCLUDED.is_active, updated_at = now();
```

✅ **Expected:** Query ran successfully

---

## ✅ VERIFICATION

After all migrations are applied, run these verification queries in SQL Editor:

```sql
-- Check functions exist
SELECT COUNT(*) as function_count FROM pg_proc
WHERE proname IN ('current_user_id', 'current_user_role', 'is_admin', 'is_super_admin', 'is_manager');

-- Check tables exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name LIKE '%categor%'
ORDER BY table_name;

-- Check banks seeded
SELECT COUNT(*) FROM public.bank_accounts;

-- Check visual settings
SELECT COUNT(*) FROM public.visual_settings;
```

All should return > 0 results.

---

## 🎯 Summary

- ✅ Buckets created (manual)
- ✅ RLS optimization applied
- ✅ Storage policies configured
- ✅ Manager role added
- ✅ Categorization system created
- ✅ Initial data seeded

**You're ready to use the application!**

---

**Last Updated:** 2025-11-12
