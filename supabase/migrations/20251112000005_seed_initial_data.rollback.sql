-- ============================================================================
-- ROLLBACK: SEED INITIAL DATA
-- Created: 2025-11-12
-- Purpose: Remove seeded data (optional - usually you keep seed data)
-- ============================================================================

-- WARNING: This rollback is for development only.
-- In production, you typically keep seed data and only update it.
-- Comment out the lines below if you want to keep the seed data.

-- ============================================================================
-- STEP 1: Delete Payment Methods (optional - can comment out)
-- ============================================================================

-- DELETE FROM public.payment_methods
-- WHERE name IN (
--   'Transferencia Bancaria',
--   'Depósito en Efectivo',
--   'Billetera Digital',
--   'Tarjeta de Crédito'
-- );

-- ============================================================================
-- STEP 2: Delete Visual Settings (optional - can comment out)
-- ============================================================================

-- DELETE FROM public.visual_settings
-- WHERE setting_key IN (
--   'app_name',
--   'site_title',
--   'logo_text',
--   'favicon_url',
--   'primary_color',
--   'secondary_color',
--   'support_email',
--   'support_phone',
--   'maintenance_mode'
-- );

-- ============================================================================
-- STEP 3: Note about Category Rules
-- ============================================================================

-- Category rules are created by the categorization system migration
-- They are deleted in that migration's rollback, not here

-- ============================================================================
-- STEP 4: Note about Banks and Remittance Types
-- ============================================================================

-- Do NOT delete banks and remittance types in production
-- They are configuration data that users depend on

-- ============================================================================

-- To completely remove all seed data (dev only), uncomment the sections above
-- For production, comment them out and keep the seed data

-- ============================================================================
