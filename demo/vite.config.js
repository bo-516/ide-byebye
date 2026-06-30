import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// The demo imports the plugin source directly (source-tree usage) so it can be edited and tested in place.
// In a real project you would instead: `import codeIntentInspectorPlugin from 'ide-byebye'`
// (or 'ide-byebye/webpack' / 'ide-byebye/rspack' for those bundlers).
import codeIntentInspectorPlugin from '../index.js';

export default defineConfig({
  plugins: [
    // ai-inspector now registers code-inspector-plugin (the data-insp-path injector) internally with zero config —
    // no separate codeInspectorPlugin({...}) entry, no `bundler` to pass, no clickModifier needed. Its enforce:'pre'
    // plugins run before @vitejs/plugin-react's JSX transform regardless of array order. ⌘-click (Ctrl-click on
    // Windows/Linux) is enabled by default. After filling in the intent, click an app button at the bottom of the
    // dialog to assemble "element source + your intent" into a prompt and open the matching app prefilled.
    // Zero-config: recording on, clipboard/file + all three app agents enabled, Enter submits to claude-app.
    // Override anything via options, e.g. codeIntentInspectorPlugin({ recording: false, agents: { cursorApp: false } }).
    codeIntentInspectorPlugin(),
    react(),
  ],
  server: {
    // The inspector now runs on its own loopback server, so the app no longer needs a special host binding — the page
    // reaches the inspector cross-origin (CORS + per-process token handle that). Honor a PORT override from tooling.
    port: Number(process.env.PORT) || 5300,
    open: true,
  },
});
