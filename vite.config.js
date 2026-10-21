import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    // Default 5 s flakes under CI/coverage load (heavy RTL page renders)
    testTimeout: 30000,
    hookTimeout: 30000,
    setupFiles: ['./src/tests/setup.js'],
    include: ['src/tests/unit/**/*.test.{js,jsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/lib/**', 'src/contexts/**', 'src/hooks/**'],
      // Ratchet: measured 41.39/37.2/53.31/40.48 on 2026-10-21, floored. Raise as coverage grows.
      thresholds: { statements: 41, branches: 37, functions: 53, lines: 40 },
    },
  },
   server: {
    host: true,
    port: 5173,               // SIGUE SIENDO 5173
    allowedHosts: [
      '.vercel.app',   // cualquier subdominio de vercel
    ],
  },
});