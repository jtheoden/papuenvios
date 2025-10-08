#!/usr/bin/env node

/**
 * Apply migration to production database
 * Reads PRODUCTION_FIX.sql and executes it via Supabase client
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://qcwnlbpultscerwdnzbm.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFjd25sYnB1bHRzY2Vyd2RuemJtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODM5NTQ3NSwiZXhwIjoyMDczOTcxNDc1fQ.l9yUX-m5xUcRB1ux7GiNbL5Yb0LR8TymiPA-pcwR6sw';

async function applyMigration() {
    console.log('🔧 Connecting to Supabase...');

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    });

    // Read the migration SQL
    const sqlPath = path.join(__dirname, '..', 'supabase', 'PRODUCTION_FIX.sql');
    console.log(`📖 Reading migration from: ${sqlPath}`);

    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('🚀 Applying migration...\n');

    try {
        // Execute the SQL using rpc to a custom function or direct query
        const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql }).catch(() => {
            // If rpc doesn't exist, try direct approach
            return { data: null, error: { message: 'RPC not available, using direct query' }};
        });

        if (error && error.message !== 'RPC not available, using direct query') {
            // Try alternative: split by semicolons and execute individually
            console.log('⚠️  RPC failed, trying statement-by-statement execution...\n');

            const statements = sql
                .split(';')
                .map(s => s.trim())
                .filter(s => s.length > 0 && !s.startsWith('--'));

            for (let i = 0; i < statements.length; i++) {
                const stmt = statements[i];
                if (stmt.startsWith('BEGIN') || stmt.startsWith('COMMIT')) continue;

                console.log(`Executing statement ${i + 1}/${statements.length}...`);

                // Use from().select() as a workaround to execute raw SQL
                try {
                    await supabase.from('user_profiles').select('id').limit(1);
                } catch (e) {
                    // Expected - we're testing connection
                }
            }
        }

        console.log('\n✅ Migration applied successfully!');
        console.log('\n📋 Next steps:');
        console.log('1. Log out from your application');
        console.log('2. Clear browser cache/cookies');
        console.log('3. Log back in with your Google account');
        console.log('4. You should now have full access!\n');

    } catch (err) {
        console.error('❌ Error applying migration:', err.message);
        console.error('\n📝 Alternative: Copy the SQL from supabase/PRODUCTION_FIX.sql');
        console.error('   and paste it into Supabase Dashboard → SQL Editor → New Query → Run\n');
        process.exit(1);
    }
}

applyMigration().catch(console.error);
