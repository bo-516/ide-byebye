import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
// Source-tree usage so the plugin can be edited and tested in place.
// Real projects: `import inspector from 'ide-byebye'` (or 'ide-byebye/vite').
import codeIntentInspectorPlugin from '../../dist/index.js';

export default defineConfig({
  plugins: [
    // Zero-config. Vue SFCs get data-insp-path via code-inspector; source-context
    // extracts template slices (best-effort — not a full Vue compiler).
    codeIntentInspectorPlugin(),
    vue(),
  ],
  server: {
    port: Number(process.env.PORT) || 5600,
    open: true,
  },
});
