import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

export default defineConfig({
  plugins: [{
    name: 'bundled-font-licenses',
    generateBundle() {
      for (const [directory, family] of [['barlow', 'Barlow'], ['sairacondensed', 'SairaCondensed'], ['geistmono', 'GeistMono']]) {
        this.emitFile({ type: 'asset', fileName: `assets/${family}-OFL.txt`, source: readFileSync(new URL(`./src/fonts/${directory}/OFL.txt`, import.meta.url), 'utf8') });
      }
    }
  }],
  server: {
    host: '127.0.0.1', port: 1420, strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] }
  },
  clearScreen: false,
  envPrefix: ['VITE_']
});
