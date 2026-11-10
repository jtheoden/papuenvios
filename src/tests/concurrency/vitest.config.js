import { defineConfig } from 'vite';
import path from 'path';

// Separate config: these tests talk to the LOCAL Supabase Postgres (see README.md)
// and must never run as part of the default `npm test` (unit) suite.
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, '../..') }
  },
  test: {
    environment: 'node',
    include: ['src/tests/concurrency/**/*.test.js'],
    testTimeout: 60000,
    hookTimeout: 60000,
    // One DB, shared fixtures: files and tests run sequentially.
    fileParallelism: false
  }
});
