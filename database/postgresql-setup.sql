-- ============================================================================
-- POSTGRESQL DATABASE SETUP - STANDALONE VERSION
-- Created: 2025-11-12
-- Purpose: Complete database schema setup without Supabase dependencies
-- Usage: psql -U postgres -d papuenvios -f postgresql-setup.sql
-- ============================================================================

-- ============================================================================
-- NOTE: This is a SIMPLIFIED VERSION for backup/migration purposes
-- For the complete, production-ready schema, use Supabase migrations
-- ============================================================================

-- ============================================================================
-- STEP 1: Create Extensions
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- STEP 2: Create Enums
-- ============================================================================

CREATE TYPE user_role AS ENUM ('user', 'admin', 'super_admin', 'manager');
CREATE TYPE order_status AS ENUM ('pending', 'processing', 'shipped', 'delivered', 'completed', 'cancelled');
CREATE TYPE payment_status AS ENUM ('pending', 'validated', 'rejected');
CREATE TYPE remittance_status AS ENUM ('pending', 'in_transit', 'delivered', 'completed', 'cancelled');
CREATE TYPE category_name AS ENUM ('regular', 'pro', 'vip');

-- ============================================================================
-- STEP 3: Create Tables
-- ============================================================================

-- Users Table
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  email varchar(255) UNIQUE NOT NULL,
  phone varchar(20),
  auth_provider varchar(50) DEFAULT 'email', -- 'google', 'email'
  auth_provider_id varchar(255),
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

-- User Profiles Table
CREATE TABLE IF NOT EXISTS user_profiles (
  id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name varchar(255),
  avatar_url text,
  role user_role DEFAULT 'user',
  is_enabled boolean DEFAULT true,
  bio text,
  phone_verified boolean DEFAULT false,
  email_verified boolean DEFAULT false,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

-- Currencies Table
CREATE TABLE IF NOT EXISTS currencies (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  code varchar(3) UNIQUE NOT NULL,
  name varchar(100) NOT NULL,
  symbol varchar(5),
  exchange_rate_to_usd numeric(10,4) DEFAULT 1.0,
  is_active boolean DEFAULT true,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

-- Bank Accounts Table
CREATE TABLE IF NOT EXISTS bank_accounts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name varchar(255) NOT NULL,
  code varchar(10) UNIQUE NOT NULL,
  country varchar(100),
  logo_url text,
  account_number_format varchar(50),
  is_active boolean DEFAULT true,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

-- Payment Methods Table
CREATE TABLE IF NOT EXISTS payment_methods (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name varchar(100) UNIQUE NOT NULL,
  description text,
  is_active boolean DEFAULT true,
  requires_proof boolean DEFAULT false,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

-- Orders Table
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  total_amount numeric(12,2) NOT NULL,
  currency_code varchar(3) DEFAULT 'USD',
  status order_status DEFAULT 'pending',
  payment_status payment_status DEFAULT 'pending',
  payment_proof_url text,
  payment_validated_at timestamp,
  payment_rejected_at timestamp,
  shipped_at timestamp,
  delivered_at timestamp,
  completed_at timestamp,
  cancelled_at timestamp,
  notes text,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

-- Order Items Table
CREATE TABLE IF NOT EXISTS order_items (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id uuid,
  combo_id uuid,
  quantity integer NOT NULL DEFAULT 1,
  unit_price numeric(12,2) NOT NULL,
  subtotal numeric(12,2) NOT NULL,
  created_at timestamp DEFAULT now()
);

-- Remittances Table
CREATE TABLE IF NOT EXISTS remittances (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_name varchar(255) NOT NULL,
  recipient_email varchar(255),
  recipient_phone varchar(20),
  amount_sent numeric(12,2) NOT NULL,
  currency_sent varchar(3) DEFAULT 'USD',
  currency_delivered varchar(3) DEFAULT 'CUP',
  amount_delivered numeric(12,2),
  remittance_type varchar(100),
  bank_account_id uuid REFERENCES bank_accounts(id),
  account_number varchar(50),
  payment_status payment_status DEFAULT 'pending',
  status remittance_status DEFAULT 'pending',
  payment_proof_url text,
  delivery_proof_url text,
  payment_validated_at timestamp,
  payment_rejected_at timestamp,
  shipped_at timestamp,
  delivered_at timestamp,
  completed_at timestamp,
  cancelled_at timestamp,
  notes text,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

-- User Categories Table
CREATE TABLE IF NOT EXISTS user_categories (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_name category_name DEFAULT 'regular',
  assigned_at timestamp DEFAULT now(),
  assigned_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  assignment_reason varchar(50) DEFAULT 'automatic',
  effective_from timestamp DEFAULT now(),
  effective_to timestamp,
  referral_count integer DEFAULT 0,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

-- User Category History Table
CREATE TABLE IF NOT EXISTS user_category_history (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  old_category category_name NOT NULL DEFAULT 'regular',
  new_category category_name NOT NULL,
  changed_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  change_reason text,
  changed_at timestamp DEFAULT now()
);

-- Manager Assignments Table
CREATE TABLE IF NOT EXISTS manager_assignments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  manager_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  assigned_by uuid NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,
  scope varchar(50) DEFAULT 'all',
  assigned_at timestamp DEFAULT now(),
  removed_at timestamp,
  reason text,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

-- Category Rules Table
CREATE TABLE IF NOT EXISTS category_rules (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_name category_name UNIQUE NOT NULL,
  interaction_threshold integer NOT NULL,
  description text,
  color_code varchar(7) DEFAULT '#808080',
  enabled boolean DEFAULT true,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

-- Category Discounts Table
CREATE TABLE IF NOT EXISTS category_discounts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_name category_name UNIQUE NOT NULL,
  discount_percentage numeric(5,2) DEFAULT 0,
  discount_description text,
  enabled boolean DEFAULT false,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

-- Visual Settings Table
CREATE TABLE IF NOT EXISTS visual_settings (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  setting_key varchar(100) UNIQUE NOT NULL,
  setting_value text,
  setting_type varchar(50) DEFAULT 'text',
  description text,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

-- ============================================================================
-- STEP 4: Create Indexes
-- ============================================================================

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_user_profiles_role ON user_profiles(role);
CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_payment_status ON orders(payment_status);
CREATE INDEX idx_remittances_sender_id ON remittances(sender_id);
CREATE INDEX idx_remittances_status ON remittances(status);
CREATE INDEX idx_remittances_payment_status ON remittances(payment_status);
CREATE INDEX idx_user_categories_user_id ON user_categories(user_id);
CREATE INDEX idx_user_categories_category ON user_categories(category_name);
CREATE INDEX idx_user_category_history_user_id ON user_category_history(user_id);
CREATE INDEX idx_manager_assignments_manager_id ON manager_assignments(manager_id) WHERE removed_at IS NULL;

-- ============================================================================
-- STEP 5: Insert Initial Data
-- ============================================================================

-- Insert currencies
INSERT INTO currencies (code, name, symbol, exchange_rate_to_usd)
VALUES
  ('USD', 'Dólar Estadounidense', '$', 1.00),
  ('CUP', 'Peso Cubano', '₱', 0.037),
  ('EUR', 'Euro', '€', 1.09)
ON CONFLICT (code) DO NOTHING;

-- Insert Cuban banks
INSERT INTO bank_accounts (name, code, country, logo_url)
VALUES
  ('Banco Nacional de Cuba', 'BNC', 'Cuba', '/bank-logos/bandec.jpg'),
  ('Banco de Finanzas Internacionales', 'BFI', 'Cuba', '/bank-logos/bfi.png'),
  ('Banco Popular de Ahorros', 'BPA', 'Cuba', '/bank-logos/bpa.jpg'),
  ('Banco Metropolitano de Cuba', 'BMC', 'Cuba', '/bank-logos/metropolitano.jpg')
ON CONFLICT (code) DO NOTHING;

-- Insert category rules
INSERT INTO category_rules (category_name, interaction_threshold, description, color_code)
VALUES
  ('regular', 0, 'New users (0-4 interactions)', '#808080'),
  ('pro', 5, 'Active users (5-9 interactions)', '#3B82F6'),
  ('vip', 10, 'Premium users (10+ interactions)', '#FFD700')
ON CONFLICT (category_name) DO NOTHING;

-- ============================================================================
-- STEP 6: Create Functions (PostgreSQL equivalents)
-- ============================================================================

-- Function to count user interactions
CREATE OR REPLACE FUNCTION count_user_interactions(p_user_id uuid)
RETURNS integer AS $$
DECLARE
  v_count integer := 0;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM orders
  WHERE user_id = p_user_id
  AND status = 'completed';

  SELECT COUNT(*) + v_count INTO v_count
  FROM remittances
  WHERE sender_id = p_user_id
  AND payment_status = 'validated'
  AND status IN ('completed', 'delivered');

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 7: Verification Queries
-- ============================================================================

/*
-- Verify tables exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- Verify initial data
SELECT 'Users' as type, COUNT(*) FROM users
UNION ALL
SELECT 'Orders', COUNT(*) FROM orders
UNION ALL
SELECT 'Remittances', COUNT(*) FROM remittances
UNION ALL
SELECT 'Currencies', COUNT(*) FROM currencies
UNION ALL
SELECT 'Banks', COUNT(*) FROM bank_accounts;
*/

-- ============================================================================
-- NOTE: RLS (Row Level Security) is a Supabase feature
-- For standalone PostgreSQL, implement authorization at the application level
-- ============================================================================
