# Code Intent Inspector Core

This directory is a copy-friendly JavaScript version of the plugin runtime. It
keeps readable source modules for development, and can build a single ESM file
that embeds the browser runtime for other projects.

## Single-File Build

Build the portable plugin file:

```sh
npm run build
```

The output is:

```txt
dist/code-intent-inspector.js
dist/client.js
```

Copy only `dist/code-intent-inspector.js` into another Vite project and import
it from the local Vite config. The single-file plugin embeds the browser
runtime; `dist/client.js` is also emitted for source-tree usage and direct
client-bundle inspection.

## Copy Usage

Single-file usage:

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { codeInspectorPlugin } from 'code-inspector-plugin';
import codeIntentInspectorPlugin from './code-intent-inspector.js';

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

Source-tree usage is still supported during development:

```js
import { codeIntentInspectorPlugin } from './core/index.js';
```

## Required Dependencies

For source-aware element picking, install the companion locator plugin in the
target project:

```sh
npm install -D code-inspector-plugin
```

Optional agent dependencies:

```sh
npm install @openai/codex-sdk
npm install ws
npm install @anthropic-ai/claude-agent-sdk
```

`ws` is only needed for the Codex App Server adapter on Node versions without a
global `WebSocket`.

## Codex App

Set `agents.codexApp.projectRoot` to override the folder opened by Codex App
deeplinks without enabling the in-page Codex dock or the Codex SDK adapter.

```js
codeIntentInspectorPlugin({
  defaultAgent: 'codex-app',
  codexDock: { enabled: false },
  agents: {
    codexApp: {
      enabled: true,
      projectRoot: '/absolute/path/to/project',
    },
    codexSdk: false,
  },
});
```

## Cursor

Enable `agents.cursorApp` to open Cursor with the generated intent prompt
prefilled. Cursor prompt deeplinks route by workspace name, so set
`cursorApp.workspace` if the folder name shown in Cursor differs from the Vite
project folder.

```js
codeIntentInspectorPlugin({
  defaultAgent: 'cursor-app',
  agents: {
    cursorApp: {
      enabled: true,
      workspace: 'my-app',
    },
  },
});
```

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
dock sends editing requests through the Codex SDK, surfaces native reasoning
progress when the SDK returns it, and shows session state, selected sources,
tokens/s, and context usage. Its position, width, height, collapsed state,
selected model, and session-sidebar state are persisted locally; the session
sidebar can collapse into a narrow rail when you need more chat space.

## Files

- `index.js` exports `codeIntentInspectorPlugin`.
- `plugin.js` is the Vite plugin entry.
- `scripts/build-single-file.js` builds `dist/code-intent-inspector.js` and
  `dist/client.js`.
- `dist/client.js` is the generated browser runtime for source-tree usage.
- `client/`, `server/`, and `shared/` contain readable JS modules for the same
  runtime pieces.
