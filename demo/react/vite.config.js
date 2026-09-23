import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Source-tree usage so the plugin can be edited and tested in place.
// Real projects: `import inspector from 'ide-byebye'` (or 'ide-byebye/vite').
import codeIntentInspectorPlugin from '../../dist/index.js';

export default defineConfig({
  plugins: [
    // Registers code-inspector (data-insp-path) + inspector bootstrap.
    // Keep recording enabled here so the demo can show rrweb capture.
    codeIntentInspectorPlugin({ recording: true }),
    react(),
  ],
  server: {
    port: Number(process.env.PORT) || 5300,
    open: true,
  },
});
