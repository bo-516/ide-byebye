# ai-inspector demo

Multi-app / multi-bundler playground for **ide-byebye** (code-intent-inspector).

| App | Bundlers | Default port |
| --- | --- | --- |
| **React** (`react/`) | Vite · webpack · rspack | 5300 / 5400 / 5500 |
| **Vue 3** (`vue/`) | Vite · webpack | 5600 / 5700 |

Trigger the inspector by **holding ⌘ (Command) and clicking any element** (or `Alt+Shift+I` then click).

> Vue source mapping works via `code-inspector-plugin` (`data-insp-path` on rendered DOM). Prompt context for `.vue` SFCs is **best-effort** (template line slices, not a full Vue compiler) — good enough to hand an agent the right file + region, not a perfect AST.

## Run

```sh
pnpm install

pnpm dev                     # react + vite   (default)
pnpm dev:vue                 # vue + vite
pnpm dev:react:webpack       # react + webpack
pnpm dev:react:rspack        # react + rspack
pnpm dev:vue:webpack         # vue + webpack
```

Or with explicit flags:

```sh
node dev.mjs --app vue --bundler vite
node dev.mjs --app react --bundler rspack
```

## How to test

1. **Hold ⌘** and move the mouse — the hovered element gets a highlight preview.
2. **⌘ + click** any element (heading, button, card, input, list item…).
3. The intent dialog opens with that element's **source location and context**.
4. Type your change request (e.g. "make this button rounded").
5. Click a footer agent: `Codex App` / `Claude App` / `Cursor` / `Grok Build`.

> After editing a bundler config the dev server restarts — **refresh the browser**.

## Key config

Every app uses zero-config inspector registration:

```js
// Vite (react/vite.config.js, vue/vite.config.js)
import inspector from 'ide-byebye'; // demo uses ../../dist/index.js
plugins: [inspector(), react() /* or vue() */]
```

```js
// webpack
import inspector from 'ide-byebye/webpack';
plugins: [new HtmlWebpackPlugin(...), inspector()]
```

```js
// rspack
import inspector from 'ide-byebye/rspack';
plugins: [new rspack.HtmlRspackPlugin(...), inspector()]
```

See the package root `../README.md` for the full option list (agents, recording, locale…).

## How it's wired

This demo imports the plugin **source tree** directly so you can edit the plugin and test in place:

```js
import codeIntentInspectorPlugin from '../../dist/index.js';
```

In a real project, install the package and import the matching adapter:

| Bundler | Import |
| --- | --- |
| Vite | `ide-byebye` or `ide-byebye/vite` |
| webpack | `ide-byebye/webpack` |
| rspack | `ide-byebye/rspack` |
| rsbuild | `ide-byebye/rsbuild` |
| esbuild | `ide-byebye/esbuild` |
| Farm | `ide-byebye/farm` |
| Turbopack (Next) | `ide-byebye/turbopack` *(data-insp-path only)* |
| Mako (Umi) | `ide-byebye/mako` *(data-insp-path only)* |
