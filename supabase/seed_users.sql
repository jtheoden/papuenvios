-- Create test users and their profiles
-- Clean up existing test data
DELETE FROM public.user_profiles WHERE id IN (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003'
);

DELETE FROM auth.users WHERE email IN (
  'superadmin@test.com',
  'admin@test.com',
  'user@test.com'
);

-- Insert fresh test users with proper password hashing
INSERT INTO auth.users (
  id,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_user_meta_data,
  is_sso_user,
  created_at,
  updated_at,
  confirmation_token,
  confirmed_at
)
VALUES 
  (
    '00000000-0000-0000-0000-000000000001',
    'superadmin@test.com',
    crypt('test123', gen_salt('bf')),
    NOW(),
    '{"name":"Super Admin", "avatar_url":"https://api.dicebear.com/7.x/avataaars/svg?seed=superadmin"}',
    false,
    NOW(),
    NOW(),
    NULL,
    NOW()
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    'admin@test.com',
    crypt('test123', gen_salt('bf')),
    NOW(),
    '{"name":"Admin User", "avatar_url":"https://api.dicebear.com/7.x/avataaars/svg?seed=admin"}',
    false,
    NOW(),
    NOW(),
    NULL,
    NOW()
  ),
  (
    '00000000-0000-0000-0000-000000000003',
    'user@test.com',
    crypt('test123', gen_salt('bf')),
    NOW(),
    '{"name":"Regular User", "avatar_url":"https://api.dicebear.com/7.x/avataaars/svg?seed=user"}',
    false,
    NOW(),
    NOW(),
    NULL,
    NOW()
  )
ON CONFLICT (id) DO NOTHING;

-- Create or update user profiles with roles
INSERT INTO user_profiles (id, role, is_enabled)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'super_admin', true),
  ('00000000-0000-0000-0000-000000000002', 'admin', true),
  ('00000000-0000-0000-0000-000000000003', 'user', true)
ON CONFLICT (id) DO
UPDATE SET 
  role = EXCLUDED.role,
  is_enabled = EXCLUDED.is_enabled;

-- Set up RLS policies
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON user_profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON user_profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON user_profiles;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON user_profiles;

-- Create new policies
CREATE POLICY "Users can view their own profile"
  ON user_profiles
  FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON user_profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Admins can view all profiles"
  ON user_profiles
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
      AND (role = 'admin' OR role = 'super_admin')
    )
  );

CREATE POLICY "Admins can update all profiles"
  ON user_profiles
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
      AND (role = 'admin' OR role = 'super_admin')
    )
  );

CREATE POLICY "Enable insert for authenticated users"
  ON user_profiles
  FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Ensure the user_role type exists
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('user', 'admin', 'super_admin');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create function to handle new user creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, role, is_enabled)
  VALUES (
    NEW.id,
    CASE 
      WHEN NEW.email = 'jtheoden@gmail.com' THEN 'super_admin'
      WHEN NEW.email = 'superadmin@test.com' THEN 'super_admin'
      WHEN NEW.email = 'admin@test.com' THEN 'admin'
      ELSE 'user'
    END,
    true
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for automatic profile creation
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- The password for all test users is 'test123'