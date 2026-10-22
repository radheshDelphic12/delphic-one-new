import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { buildInfoPlugin } from './build-info.js';

export default defineConfig({
  // buildInfoPlugin: <meta name="build-commit" ...> tags in the head (commit id, message, dates), readable by inspecting the page
  plugins: [react(), buildInfoPlugin()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/uploads': 'http://localhost:4000',
      '/delphic/career': 'http://localhost:4000',
    },
  },
});
