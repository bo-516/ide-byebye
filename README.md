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
      // The dialog footer always shows Codex App / Claude App / Cursor, so
      // defaultAgent (used by Enter) must be one of those three.
      defaultAgent: 'claude-app',
      clickModifier: 'meta', // ⌘+click to pick an element (macOS)
      agents: {
        codexApp: { enabled: true },
        claudeApp: true,
        cursorApp: { enabled: true },
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

The three app agents (Codex App / Claude App / Cursor) only need the macOS
`open` command and the matching app installed; no extra npm dependencies are
required.

## Codex App

Set `agents.codexApp.projectRoot` to override the folder opened by Codex App
deeplinks.

```js
codeIntentInspectorPlugin({
  defaultAgent: 'codex-app',
  agents: {
    codexApp: {
      enabled: true,
      projectRoot: '/absolute/path/to/project',
    },
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

## Recording (rrweb)

Beyond static screenshots, the intent dialog can record **element behavior** with
[rrweb](https://github.com/rrweb-io/rrweb): pick a **scope** (selected node / its
parent / app mount root), click record — the dialog steps aside and the page
becomes interactive while a floating control counts up — interact with the page,
then click stop. The dialog returns and you can review and **trim a clip**
in-browser. A still frame is rasterized from the chosen moment (cropped to the
scope) so the coding agent gets an image it can read; the raw event stream is
saved alongside it for human replay but is never put in the prompt. The
inspector's own UI is excluded from every recording.

Recording is **opt-in** and lazy-loaded. Install rrweb in the target project and
enable it:

```sh
npm i @rrweb/record @rrweb/replay
```

```js
codeIntentInspectorPlugin({
  recording: {
    enabled: true,
    maxDurationMs: 30000, // rolling buffer length (clamped to 5min)
    mask: {
      allInputs: false,   // default off: dev tooling wants real form state
      blockClass: 'rr-block', // elements with this class are blocked from capture
    },
  },
});
```

How it works and what it costs:

- The plugin serves rrweb's ESM build from the host's `node_modules` over
  `/__intent-inspector/vendor/{record,replay}`; the browser imports it by URL
  only when recording is used, so the single-file plugin stays small.
- The still frame reuses the same SVG-`<foreignObject>` → canvas rasterizer as
  screenshots, so it inherits the same limits: cross-origin assets without CORS
  may be blank, web fonts must be loadable, and **`canvas`/WebGL content is not
  captured in v1**.
- Recordings are written under `.intent-inspector/recordings/` (`<id>.rrweb.json`
  + `<id>.webp`) and expire on the same schedule as screenshots.

## Files

- `index.js` exports `codeIntentInspectorPlugin`.
- `plugin.js` is the Vite plugin entry.
- `scripts/build-single-file.js` builds `dist/code-intent-inspector.js` and
  `dist/client.js`.
- `dist/client.js` is the generated browser runtime for source-tree usage.
- `client/`, `server/`, and `shared/` contain readable JS modules for the same
  runtime pieces.
