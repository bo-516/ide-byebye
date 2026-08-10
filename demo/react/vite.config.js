import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Source-tree usage so the plugin can be edited and tested in place.
// Real projects: `import inspector from 'ide-byebye'` (or 'ide-byebye/vite').
import codeIntentInspectorPlugin from '../../index.js';

export default defineConfig({
  plugins: [
    // Zero-config: registers code-inspector (data-insp-path) + inspector bootstrap.
    // ⌘/Ctrl-click on by default; recording on; all footer agents enabled.
    codeIntentInspectorPlugin(),
    react(),
  ],
  server: {
    port: Number(process.env.PORT) || 5300,
    open: true,
  },
});
