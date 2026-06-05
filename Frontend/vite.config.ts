import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Frontend dev server runs on 5173. All JSON API calls go directly to the
// backend (VITE_API_BASE_URL, default http://localhost:4000) using CORS.
// EXCEPTION: /api/proxy-page is proxied so the Mapping Studio iframe stays
// same-origin with the app — required for live selector testing, which reads
// the iframe's contentDocument (blocked cross-origin by the same-origin policy).
const API_TARGET = process.env.VITE_API_TARGET || 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 5173,
    proxy: {
      '/api/proxy-page': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
});
