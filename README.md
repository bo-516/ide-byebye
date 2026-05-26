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

## Files

- `index.js` exports `codeIntentInspectorPlugin`.
- `plugin.js` is the Vite plugin entry.
- `client.js` is the bundled browser picker/UI runtime served by the plugin.
- `client/`, `server/`, and `shared/` contain readable JS modules for the same
  runtime pieces.
