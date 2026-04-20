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
    setupFiles: ['./src/tests/setup.js'],
    include: ['src/tests/unit/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/lib/priceCalculationService.js', 'src/lib/remittanceCalculations.js'],
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