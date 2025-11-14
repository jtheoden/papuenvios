-- ============================================================================
-- SEED INITIAL DATA FOR SUPABASE - MINIMAL VERSION
-- Created: 2025-11-12
-- Purpose: Populate database with essential data and create admin user profile
-- Note: This is a minimal version WITHOUT the slow DO block for user categorization
-- ============================================================================

-- ============================================================================
-- STEP 1: Create Super Admin User Profile (CRITICAL - UNBLOCKS AUTH)
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
  'cedc2b86-33a5-46ce-91b4-93f01056e029',
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
-- STEP 5: Seed Category Rules
-- ============================================================================

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
-- STEP 7: Seed Payment Methods
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
-- STEP 8: Initialize User Categories (Manual approach - no slow DO block)
-- ============================================================================

-- Initialize the super admin user with regular category
INSERT INTO public.user_categories (user_id, category_name, assignment_reason)
VALUES ('cedc2b86-33a5-46ce-91b4-93f01056e029', 'regular', 'automatic')
ON CONFLICT (user_id) DO NOTHING;

-- ============================================================================
-- SUCCESS - All essential data seeded!
-- ============================================================================
