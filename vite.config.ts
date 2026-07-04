import { resolve } from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/renderer',
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@': resolve(__dirname, 'src/renderer'),
    },
  },
  build: {
    outDir: '../../dist-web',
    emptyOutDir: true,
  },
  plugins: [react()],
});
