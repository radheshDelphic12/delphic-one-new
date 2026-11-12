import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served by the viewer's own Express app under /dbviewer/ (host nginx strips the prefix), so every URL is relative.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
  server: { proxy: { '/api': 'http://localhost:8090' } },
});
