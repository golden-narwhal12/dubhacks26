import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: [
        '**/artifacts/**',
        '**/release/**',
        '**/dist/**',
        '**/dist-desktop/**',
        '**/test-results/**',
      ],
    },
  },
  build: { chunkSizeWarningLimit: 3500 },
});
