# Code Intent Inspector Core

This directory is a copy-friendly JavaScript version of the plugin runtime.
It keeps the same module layout as `src`, but strips TypeScript-only files and
ships a ready-to-serve browser bundle at `client.js`.

## Copy Usage

Copy the whole `core` directory into your Vite project, then import the plugin
from your Vite config:

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { codeInspectorPlugin } from 'code-inspector-plugin';
import { codeIntentInspectorPlugin } from './core/index.js';

export default defineConfig({
  plugins: [
    react(),
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
    codeIntentInspectorPlugin({
      defaultAgent: 'clipboard',
      // Optional persistent web Codex dock. Requires code-inspector-plugin and
      // the target project to install @openai/codex-sdk.
      codexDock: {
        enabled: true,
        models: [
          { label: 'Default', value: '' },
          { label: '5.5 Extra High', value: 'gpt-5.5-codex' },
        ],
      },
      agents: {
        codexSdk: true,
      },
    }),
  ],
});
```

## Required Dependencies

Install these in the target project:

```sh
npm install -D code-inspector-plugin
npm install @babel/parser @babel/traverse
```

Optional agent dependencies:

```sh
npm install @openai/codex-sdk
npm install ws
npm install @anthropic-ai/claude-agent-sdk
```

`ws` is only needed for the Codex App Server adapter on Node versions without a
global `WebSocket`.

## Codex Dock

Set `codexDock: true` or `codexDock: { enabled: true }` and enable
`agents.codexSdk` to show a draggable Codex dock in the browser. The dock reads
recent project sessions from
`~/.codex/sessions/YYYY/MM/DD`, scanning only the last 15 days by default and
prefiltering with one `rg -l --fixed-strings <projectRoot>` command before it
parses JSONL metadata. Session lookup uses the current Vite `config.root`; set
`codexDock.projectRoot` only if your Codex sessions use a different `cwd`.

When `codexDock` is enabled, Command+click is the default code-reference
gesture unless `clickModifier` is explicitly configured. It adds the clicked
source block as a highlighted `@file #range` attachment in the dock composer.
Screenshot choices render above the prompt text only after they are selected in
the dock, and reuse the same capture pipeline as the intent dialog. The model
picker uses the built-in model list unless `codexDock.models` is supplied. The
composer also includes a Build/Plan mode toggle: Build sends an editing request,
while Plan asks Codex to return a plan without mutating files. The dock surfaces
session state, selected sources, tokens/s, and context usage when the SDK returns
those metrics. Its position, width, height, collapsed state, selected model, and
session-sidebar state are persisted locally; the session sidebar can collapse
into a narrow rail when you need more chat space.

## Files

- `index.js` exports `codeIntentInspectorPlugin`.
- `plugin.js` is the Vite plugin entry.
- `client.js` is the bundled browser picker/UI runtime served by the plugin.
- `client/`, `server/`, and `shared/` contain readable JS modules for the same
  runtime pieces.
