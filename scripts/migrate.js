#!/usr/bin/env node

/**
 * Supabase Migration Runner
 * Executes migrations without requiring Supabase CLI linking
 * Uses direct PostgreSQL connection to run SQL migrations
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { Client } from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// Load environment variables
dotenv.config({ path: path.join(projectRoot, '.env.local') });
dotenv.config({ path: path.join(projectRoot, '.env') });

// Configuration
const MIGRATIONS_DIR = path.join(projectRoot, 'supabase', 'migrations');
const MIGRATIONS_TABLE = 'public._migrations_applied';

// Database connection config
const DB_CONFIG = {
  host: process.env.DB_HOST || process.env.SUPABASE_DB_HOST,
  port: process.env.DB_PORT || process.env.SUPABASE_DB_PORT || 5432,
  database: process.env.DB_NAME || process.env.SUPABASE_DB_NAME || 'postgres',
  user: process.env.DB_USER || process.env.SUPABASE_DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || process.env.SUPABASE_DB_PASSWORD,
};

// Validate required config
const REQUIRED_VARS = ['host', 'user', 'password'];
const missingVars = REQUIRED_VARS.filter(key => !DB_CONFIG[key]);

if (missingVars.length > 0) {
  console.error('❌ Missing required database configuration:');
  missingVars.forEach(key => {
    console.error(`   - DB_${key.toUpperCase()} (or SUPABASE_DB_${key.toUpperCase()})`);
  });
  console.error('\n📝 Set these in .env.local or environment variables');
  process.exit(1);
}

/**
 * Create migrations tracking table if it doesn't exist
 */
async function ensureMigrationsTable(client) {
  const query = `
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text UNIQUE NOT NULL,
      executed_at timestamp with time zone DEFAULT now(),
      duration_ms integer,
      success boolean DEFAULT true,
      error_message text
    );
  `;

  try {
    await client.query(query);
  } catch (error) {
    console.error('Failed to create migrations table:', error.message);
    throw error;
  }
}

/**
 * Get list of migration files
 */
function getMigrationFiles() {
  const files = fs.readdirSync(MIGRATIONS_DIR);

  // Filter to include only:
  // - Files matching pattern: 20YYMMDD*.sql
  // - CORRECTED versions for specific migrations
  // - Exclude rollback files
  const migrationFiles = files
    .filter(f => {
      if (f.endsWith('.rollback.sql')) return false;
      if (!f.endsWith('.sql')) return false;
      // Match timestamp pattern (20YYMMDD)
      if (!/^\d{8,}.*\.sql$/.test(f)) return false;
      return true;
    })
    .sort()
    .map(f => ({
      name: f.replace(/\.sql$/, ''),
      filename: f,
      path: path.join(MIGRATIONS_DIR, f),
    }));

  return migrationFiles;
}

/**
 * Get applied migrations
 */
async function getAppliedMigrations(client) {
  try {
    const result = await client.query(
      `SELECT name FROM ${MIGRATIONS_TABLE} WHERE success = true ORDER BY executed_at`
    );
    return result.rows.map(row => row.name);
  } catch {
    return [];
  }
}

/**
 * Read migration file content
 */
function readMigrationFile(filepath) {
  try {
    return fs.readFileSync(filepath, 'utf-8');
  } catch (error) {
    throw new Error(`Failed to read migration file: ${error.message}`);
  }
}

/**
 * Execute a single migration
 */
async function executeMigration(client, migration, appliedMigrations) {
  if (appliedMigrations.includes(migration.name)) {
    return {
      status: 'skipped',
      name: migration.name,
      message: 'Already applied',
    };
  }

  const content = readMigrationFile(migration.path);
  const startTime = Date.now();

  try {
    // Execute the migration SQL
    await client.query(content);
    const duration = Date.now() - startTime;

    // Record in migrations table
    await client.query(
      `INSERT INTO ${MIGRATIONS_TABLE} (name, success, duration_ms) VALUES ($1, true, $2)`,
      [migration.name, duration]
    );

    return {
      status: 'success',
      name: migration.name,
      duration: `${duration}ms`,
    };
  } catch (error) {
    // Record failed migration
    try {
      await client.query(
        `INSERT INTO ${MIGRATIONS_TABLE} (name, success, error_message) VALUES ($1, false, $2)`,
        [migration.name, error.message]
      );
    } catch {
      // Ignore error recording errors
    }

    return {
      status: 'error',
      name: migration.name,
      error: error.message,
    };
  }
}

/**
 * Get migration status
 */
async function getStatus(client) {
  const migrations = getMigrationFiles();
  const applied = await getAppliedMigrations(client);

  console.log('\n📋 Migration Status\n');
  console.log(`Total migrations: ${migrations.length}`);
  console.log(`Applied: ${applied.length}`);
  console.log(`Pending: ${migrations.length - applied.length}\n`);

  console.log('Migration List:');
  console.log('─'.repeat(80));

  for (const migration of migrations) {
    const isApplied = applied.includes(migration.name);
    const status = isApplied ? '✅' : '⏳';
    console.log(`${status} ${migration.name}`);
  }

  console.log('─'.repeat(80) + '\n');
}

/**
 * Run pending migrations
 */
async function runMigrations(client, options = {}) {
  const migrations = getMigrationFiles();
  const applied = await getAppliedMigrations(client);
  const pending = migrations.filter(m => !applied.includes(m.name));

  if (pending.length === 0) {
    console.log('\n✅ All migrations already applied!\n');
    return { success: true, migrationCount: 0 };
  }

  console.log(`\n▶️  Running ${pending.length} pending migration(s)...\n`);

  const results = [];
  let hasErrors = false;

  for (const migration of pending) {
    const result = await executeMigration(client, migration, applied);
    results.push(result);

    if (result.status === 'success') {
      console.log(`✅ ${result.name} (${result.duration})`);
    } else if (result.status === 'error') {
      console.log(`❌ ${result.name}`);
      console.log(`   Error: ${result.error}`);
      hasErrors = true;

      // Stop on first error unless --force is set
      if (!options.force) {
        console.log('\n⚠️  Migration failed. Fix the error and try again.');
        console.log('   Use --force to continue despite errors.\n');
        return { success: false, results, migrationCount: results.filter(r => r.status === 'success').length };
      }
    } else if (result.status === 'skipped') {
      console.log(`⏭️  ${result.name} (${result.message})`);
    }
  }

  console.log('\n' + (hasErrors ? '⚠️' : '✅') + ' Migration run completed!\n');

  return {
    success: !hasErrors,
    results,
    migrationCount: results.filter(r => r.status === 'success').length,
  };
}

/**
 * Main CLI handler
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'status';
  const options = {
    force: args.includes('--force'),
  };

  const client = new Client(DB_CONFIG);

  try {
    // Connect to database
    console.log('🔌 Connecting to database...');
    await client.connect();
    console.log('✅ Connected\n');

    // Ensure migrations table exists
    await ensureMigrationsTable(client);

    // Execute command
    switch (command) {
      case 'up':
      case 'migrate':
        const result = await runMigrations(client, options);
        process.exit(result.success ? 0 : 1);
        break;

      case 'status':
        await getStatus(client);
        process.exit(0);
        break;

      case 'list':
        console.log('\n📋 Available Migrations\n');
        const migrations = getMigrationFiles();
        migrations.forEach((m, i) => {
          console.log(`${i + 1}. ${m.name}`);
        });
        console.log();
        process.exit(0);
        break;

      default:
        console.error(`\n❌ Unknown command: ${command}\n`);
        console.log('Available commands:');
        console.log('  migrate (up)  - Run pending migrations');
        console.log('  status        - Show migration status');
        console.log('  list          - List all migrations\n');
        process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    console.error('\nDebugging info:');
    console.error(`  Host: ${DB_CONFIG.host}`);
    console.error(`  Port: ${DB_CONFIG.port}`);
    console.error(`  Database: ${DB_CONFIG.database}`);
    console.error(`  User: ${DB_CONFIG.user}`);
    process.exit(1);
  } finally {
    try {
      await client.end();
    } catch (error) {
      // Connection already closed
    }
  }
}

main();
