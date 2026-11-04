import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: process.env.TAURI_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
  // Only this checkout's tests: Claude worktrees under .claude/ carry their own src/.
  test: {
    dir: 'src',
    exclude: ['**/node_modules/**', '**/.claude/**'],
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext',
    },
  },
});
