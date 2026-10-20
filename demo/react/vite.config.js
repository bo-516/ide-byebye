import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Source-tree usage so the plugin can be edited and tested in place.
// Real projects: `import inspector from 'ide-byebye'` (or 'ide-byebye/vite').
import codeIntentInspectorPlugin from '../../dist/index.js';

export default defineConfig({
  plugins: [
    // Registers the built-in stamper (data-insp-path) + inspector bootstrap.
    // Keep recording enabled here so the demo can show rrweb capture.
    codeIntentInspectorPlugin({
      recording: true,
      // Turn on experimental Antigravity IDE sessions and the opt-in Cascade IDE agents for the React demo.
      agents: {
        devinIde: true,
        windsurfIde: true,
      },
    }),
    react(),
  ],
  server: {
    // Bind every interface. Vite's default is localhost, which on this machine is [::1] only, so a tab
    // opened at http://127.0.0.1:5300 cannot reach the dev server and the inspector call fails with
    // "Failed to fetch".
    host: true,
    port: Number(process.env.PORT) || 5300,
    strictPort: true,
    // Unset DEMO_OPEN (human `pnpm dev:react`) still opens a browser. The matrix sets DEMO_OPEN=0.
    open: process.env.DEMO_OPEN !== '0',
  },
});
