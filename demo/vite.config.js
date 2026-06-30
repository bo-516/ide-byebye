import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { codeInspectorPlugin } from 'code-inspector-plugin';
// The demo imports the plugin source directly (source-tree usage) so it can be edited and tested in place.
// In a real project, copy the single-file ../dist/code-intent-inspector.js into the project and import that instead.
import codeIntentInspectorPlugin from '../index.js';

export default defineConfig({
  plugins: [
    // 1) code-inspector-plugin must run before @vitejs/plugin-react so it can inject data-insp-path
    //    (source file:line:column) onto every DOM element before the JSX transform. Its built-in
    //    jump-to-source / copy hotkeys are disabled here, keeping only the "inject location info"
    //    capability, to avoid clashing with our plugin's ⌘ + click gesture below.
    codeInspectorPlugin({
      bundler: 'vite',
      pathType: 'absolute',
      hotKeys: ['altKey'],
      behavior: {
        locate: false,
        copy: false,
        defaultAction: 'target',
      },
    }),

    react(),

    // 2) ai-inspector (this plugin): ⌘ + click any element -> select it and open the "intent" dialog ->
    //    after filling in the intent, click an app button at the bottom of the dialog to assemble
    //    "element source + your intent" into a structured prompt and open the matching app prefilled.
    //    Note: the footer buttons are fixed to Codex App / Claude App / Cursor, so the corresponding app
    //    agents must be enabled here for the buttons to work (otherwise clicking shows "… is not enabled.").
    //    These three agents only rely on the macOS `open` command and need no extra npm deps; installing
    //    the matching app is enough for it to respond to the deeplink.
    codeIntentInspectorPlugin({
      defaultAgent: 'claude-app', // default target submitted on Enter
      clickModifier: 'meta', // macOS ⌘; 'command' / 'cmd' also work
      // Element-behavior recording (rrweb). Requires @rrweb/record / @rrweb/replay installed in this demo.
      recording: { enabled: true },
      agents: {
        claudeApp: true, // open Claude with a prefilled new conversation
        codexApp: { enabled: true }, // open Codex App
        cursorApp: { enabled: true, workspace: 'demo' }, // open Cursor (routed by workspace name)
      },
    }),
  ],
  server: {
    // Bind IPv4 explicitly to match the fixed http://127.0.0.1 origin the plugin uses internally. Otherwise
    // Vite's default host=localhost may resolve only to IPv6 (::1), so the browser's fetch to the plugin's
    // /__intent-inspector endpoints cannot connect.
    host: '127.0.0.1',
    port: 5300,
    open: true,
  },
});
