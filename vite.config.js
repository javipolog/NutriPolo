import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  // Only VITE_: with TAURI_ the updater's signing key (in the release
  // environment) could end up in the bundle shipped in the installer
  envPrefix: ['VITE_'],
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
