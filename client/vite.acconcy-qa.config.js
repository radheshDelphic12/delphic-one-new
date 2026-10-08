import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
const proxy = { '/api': 'http://localhost:4100', '/uploads': 'http://localhost:4100' };
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist-qa' },
  preview: { port: 5200, strictPort: true, proxy },
});
