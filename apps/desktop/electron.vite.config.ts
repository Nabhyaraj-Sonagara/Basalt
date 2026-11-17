import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    // The default sync server baked into release builds (repository variable SYNC_URL).
    define: { __BASALT_SYNC_URL__: JSON.stringify(process.env.BASALT_SYNC_URL ?? '') },
    // Bundle everything (workspace packages are TypeScript source) so the packaged app needs no node_modules.
    build: { externalizeDeps: false, rollupOptions: { input: resolve(__dirname, 'src/main/index.ts'), output: { format: 'es' } } },
  },
  preload: {
    // Sandboxed preloads must be CommonJS.
    build: {
      externalizeDeps: false,
      rollupOptions: { input: resolve(__dirname, 'src/preload/index.ts'), output: { format: 'cjs', entryFileNames: '[name].cjs' } },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    build: { rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } },
  },
});
