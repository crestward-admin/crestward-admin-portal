import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const sharedRoot = path.resolve(__dirname, '../web-app/packages/shared/src');

export default defineConfig({
  server: { port: 3002, host: '0.0.0.0' },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': sharedRoot,
    },
  },
  publicDir: 'public',
  build: {
    esbuildOptions: { drop: ['console', 'debugger'] },
  },
});
