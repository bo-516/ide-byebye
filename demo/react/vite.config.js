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
      // Opt-in agents: off in real projects until configured. On here so the React demo shows them.
      agents: {
        antigravityIde: true,
        antigravity: true,
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
    open: true,
  },
});
