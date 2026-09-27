import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Standalone dev server for the preview harness only — separate from
// wxt.config.ts on purpose, so this never affects (or is reachable from) the
// real extension build. `wxt/browser` is aliased to a fixture-backed mock
// (mocks/browser.ts) so real ui/ components render without a live extension
// runtime; see mocks/browser.ts for what it answers.
export default defineConfig({
  root: dirname,
  plugins: [react()],
  resolve: {
    alias: [
      { find: 'wxt/browser', replacement: path.resolve(dirname, 'mocks/browser.ts') }
    ]
  },
  server: {
    port: 4174,
    strictPort: true
  }
});
