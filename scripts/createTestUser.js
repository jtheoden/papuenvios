import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY; // Fixed: use non-VITE prefix for server-side

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function createTestUser() {
  try {
    // Create admin user
    const { data: adminUser, error: adminError } = await supabase.auth.admin.createUser({
      email: 'admin@example.com',
      password: 'admin123',
      email_confirm: true
    });

    if (adminError) throw adminError;
    console.log('Admin user created:', adminUser);

    // Create regular user
    const { data: regularUser, error: userError } = await supabase.auth.admin.createUser({
      email: 'user@example.com',
      password: 'user123',
      email_confirm: true
    });

    if (userError) throw userError;
    console.log('Regular user created:', regularUser);

  } catch (error) {
    console.error('Error creating test users:', error);
  }
}

createTestUser();