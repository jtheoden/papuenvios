-- ============================================================================
-- SEED INITIAL DATA FOR SUPABASE
-- Created: 2025-11-12
-- Purpose: Populate database with initial configuration and admin user
-- Note: This migration is idempotent and safe to run multiple times
-- ============================================================================

-- ============================================================================
-- STEP 1: Create Super Admin User Profile
-- ============================================================================
-- NOTE: The user must be created via Supabase Auth dashboard first
-- This script assumes the user exists and only creates the profile

-- Super admin profile (jtheoden@googlemail.com)
-- UUID should be replaced with actual user ID from Supabase Auth
INSERT INTO public.user_profiles (
  id,
  email,
  full_name,
  role,
  is_enabled,
  created_at
)
VALUES (
  'super-admin-uuid-placeholder', -- Replace with actual UUID from Supabase Auth
  'jtheoden@googlemail.com',
  'Super Admin',
  'super_admin',
  true,
  now()
)
ON CONFLICT (id) DO UPDATE
SET role = 'super_admin', is_enabled = true;

-- ============================================================================
-- STEP 2: Seed Cuban Banks
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
  (
    'Banco Nacional de Cuba',
    'BNC',
    'Cuba',
    '/bank-logos/bandec.jpg',
    true,
    now()
  ),
  (
    'Banco de Finanzas Internacionales',
    'BFI',
    'Cuba',
    '/bank-logos/bfi.png',
    true,
    now()
  ),
  (
    'Banco Popular de Ahorros',
    'BPA',
    'Cuba',
    '/bank-logos/bpa.jpg',
    true,
    now()
  ),
  (
    'Banco Metropolitano de Cuba',
    'BMC',
    'Cuba',
    '/bank-logos/metropolitano.jpg',
    true,
    now()
  )
ON CONFLICT (code) DO UPDATE
SET is_active = true, updated_at = now();

-- ============================================================================
-- STEP 3: Seed Remittance Types
-- ============================================================================

INSERT INTO public.remittance_types (
  name,
  description,
  requires_bank_account,
  is_active,
  created_at
)
VALUES
  (
    'Transferencia Bancaria',
    'Envío de dinero mediante transferencia a cuenta bancaria',
    true,
    true,
    now()
  ),
  (
    'Entrega en Efectivo',
    'Envío de dinero en efectivo para entrega personal',
    false,
    true,
    now()
  ),
  (
    'Monedero Digital',
    'Envío a billeteras digitales y apps de pago',
    false,
    true,
    now()
  )
ON CONFLICT (name) DO UPDATE
SET is_active = true, updated_at = now();

-- ============================================================================
-- STEP 4: Seed Currencies
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
  (
    'USD',
    'Dólar Estadounidense',
    '$',
    1.00,
    true,
    now()
  ),
  (
    'CUP',
    'Peso Cubano',
    '₱',
    0.037,
    true,
    now()
  ),
  (
    'EUR',
    'Euro',
    '€',
    1.09,
    true,
    now()
  )
ON CONFLICT (code) DO UPDATE
SET is_active = true, updated_at = now();

-- ============================================================================
-- STEP 5: Seed Category Rules (already created in migration, verify they exist)
-- ============================================================================

-- These are already inserted in the categorization migration
-- This is just a verification that they exist
INSERT INTO public.category_rules (category_name, interaction_threshold, description, color_code)
VALUES
  ('regular', 0, 'New users (0-4 interactions)', '#808080'),
  ('pro', 5, 'Active users (5-9 interactions)', '#3B82F6'),
  ('vip', 10, 'Premium users (10+ interactions)', '#FFD700')
ON CONFLICT (category_name) DO NOTHING;

-- ============================================================================
-- STEP 6: Seed Visual Settings
-- ============================================================================

INSERT INTO public.visual_settings (
  setting_key,
  setting_value,
  setting_type,
  description
)
VALUES
  ('app_name', 'PapuEnvios', 'text', 'Application name displayed in navigation'),
  ('site_title', 'PapuEnvios - Remesas y E-Commerce', 'text', 'HTML page title (browser tab)'),
  ('logo_text', 'Papu', 'text', 'Logo text shown in header'),
  ('favicon_url', '/favicon.ico', 'text', 'URL to favicon image'),
  ('primary_color', '#3B82F6', 'color', 'Primary brand color (hex)'),
  ('secondary_color', '#10B981', 'color', 'Secondary brand color (hex)'),
  ('support_email', 'soporte@papuenvios.com', 'text', 'Support email address'),
  ('support_phone', '+53-XXXXXXX', 'text', 'Support phone number'),
  ('maintenance_mode', 'false', 'boolean', 'Enable/disable maintenance mode')
ON CONFLICT (setting_key) DO UPDATE
SET setting_value = EXCLUDED.setting_value,
    updated_at = now();

-- ============================================================================
-- STEP 7: Seed Order Statuses Configuration (if needed)
-- ============================================================================

-- Order statuses are constants in the app, but we can create a config table if needed
-- For now, they're defined in constants.js

-- ============================================================================
-- STEP 8: Seed Payment Methods
-- ============================================================================

INSERT INTO public.payment_methods (
  name,
  description,
  is_active,
  requires_proof,
  created_at
)
VALUES
  (
    'Transferencia Bancaria',
    'Transferencia bancaria nacional o internacional',
    true,
    true,
    now()
  ),
  (
    'Depósito en Efectivo',
    'Depósito en agencia bancaria',
    true,
    true,
    now()
  ),
  (
    'Billetera Digital',
    'Pago mediante aplicación de billetera digital',
    true,
    true,
    now()
  ),
  (
    'Tarjeta de Crédito',
    'Pago con tarjeta de crédito',
    false,
    false,
    now()
  )
ON CONFLICT (name) DO UPDATE
SET is_active = EXCLUDED.is_active, updated_at = now();

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

/*
-- Verify seed data was inserted
SELECT 'Banks' as type, COUNT(*) FROM public.bank_accounts
UNION ALL
SELECT 'Currencies', COUNT(*) FROM public.currencies
UNION ALL
SELECT 'Remittance Types', COUNT(*) FROM public.remittance_types
UNION ALL
SELECT 'Category Rules', COUNT(*) FROM public.category_rules
UNION ALL
SELECT 'Visual Settings', COUNT(*) FROM public.visual_settings
UNION ALL
SELECT 'Payment Methods', COUNT(*) FROM public.payment_methods;

-- Verify visual settings
SELECT setting_key, setting_value FROM public.visual_settings ORDER BY setting_key;

-- Verify banks
SELECT name, code, country FROM public.bank_accounts ORDER BY name;

-- Verify currencies
SELECT code, name, exchange_rate_to_usd FROM public.currencies ORDER BY code;
*/

-- ============================================================================
