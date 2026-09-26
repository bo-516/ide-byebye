import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
// Source-tree usage so the plugin can be edited and tested in place.
// Real projects: `import inspector from 'ide-byebye'` (or 'ide-byebye/vite').
import codeIntentInspectorPlugin from '../../dist/index.js';

export default defineConfig({
  plugins: [
    // Vue SFCs get data-insp-path from the built-in stamper; source-context extracts
    // template slices. Keep recording enabled for the demo.
    codeIntentInspectorPlugin({ recording: true }),
    vue(),
  ],
  server: {
    port: Number(process.env.PORT) || 5600,
    open: true,
  },
});
