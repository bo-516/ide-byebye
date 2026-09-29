# ai-inspector demo

Multi-app / multi-bundler playground for **ide-byebye** (code-intent-inspector).

| App | Bundler | Command | Port |
| --- | --- | --- | --- |
| **React** (`react/`) | Vite | `pnpm dev` / `pnpm dev:react` | 5300 |
| **React** (`react/`) | webpack | `pnpm dev:react:webpack` | 5400 |
| **React** (`react/`) | rspack | `pnpm dev:react:rspack` | 5500 |
| **Vue 3** (`vue/`) | Vite | `pnpm dev:vue` | 5600 |
| **Vue 3** (`vue/`) | webpack | `pnpm dev:vue:webpack` | 5700 |
| **Svelte 5** (`svelte/`) | Vite | `pnpm dev:svelte` | 5800 |
| **Solid** (`solid/`) | Vite | `pnpm dev:solid` | 5810 |
| **Preact** (`preact/`) | Vite | `pnpm dev:preact` | 5820 |
| **React** (`rsbuild/`) | Rsbuild | `pnpm dev:rsbuild` | 5830 |
| **React** (`esbuild/`) | esbuild | `pnpm dev:esbuild` | 5840 |
| **React** (`farm/`) | Farm | `pnpm dev:farm` | 5850 |
| **Next.js 16** (`next/`) | Turbopack | `pnpm dev:next` | 5860 |
| **Next.js 16** (`next/`) | webpack | `pnpm dev:next:webpack` | 5870 |
| **Nuxt 4** (`nuxt/`) | Vite | `pnpm dev:nuxt` | 5880 |
| **SvelteKit 2** (`sveltekit/`) | Vite | `pnpm dev:sveltekit` | 5890 |
| **Angular 22** (`angular/`) | Angular CLI | `pnpm dev:angular` | 5900 |

React and Vue keep the todo pages. Every other app is a title plus one Ping button. Trigger the inspector by **holding ⌘ (Command) and clicking any element** (or `Alt+Shift+I` then click).

> Vue source mapping comes from the built-in stamper (`data-insp-path` on rendered DOM). Prompt context for `.vue` SFCs comes from the project's `@vue/compiler-dom`, so the `@file #range` handed to the agent is the picked element's exact span.

## Run

```sh
pnpm install

pnpm dev                     # react + vite          5300
pnpm dev:react               # react + vite          5300
pnpm dev:react:webpack       # react + webpack       5400
pnpm dev:react:rspack        # react + rspack        5500
pnpm dev:vue                 # vue + vite            5600
pnpm dev:vue:webpack         # vue + webpack         5700
pnpm dev:svelte              # svelte + vite         5800
pnpm dev:solid               # solid + vite          5810
pnpm dev:preact              # preact + vite         5820
pnpm dev:rsbuild             # react + rsbuild       5830
pnpm dev:esbuild             # react + esbuild       5840
pnpm dev:farm                # react + farm          5850
pnpm dev:next                # next + turbopack      5860
pnpm dev:next:webpack        # next + webpack        5870
pnpm dev:nuxt                # nuxt + vite           5880
pnpm dev:sveltekit           # sveltekit + vite      5890
pnpm dev:angular             # angular + cli         5900
```

Or with explicit flags:

```sh
node dev.mjs --app vue --bundler vite
node dev.mjs --app react --bundler rspack
node dev.mjs --app next --bundler webpack
```

From the package root, `npm test` boots each row on ports 35300–35315 and checks injection plus source location. Stop these dev servers first.

## How to test

1. **Hold ⌘** and move the mouse — the hovered element gets a highlight preview.
2. **⌘ + click** any element (heading, button, card, input, list item…).
3. The intent dialog opens with that element's **source location and context**.
4. Type your change request (e.g. "make this button rounded").
5. Click a footer agent: `Codex App` / `Claude App` / `Cursor` / `Grok Build`. The React demo also shows `Antigravity IDE` and `Antigravity` (the CLI).

> After editing a bundler config the dev server restarts — **refresh the browser**.

## Key config

Every app uses zero-config inspector registration. Vite-family configs register `inspector()` before the framework plugin:

```js
// Vite (react/vite.config.js, vue/vite.config.js, svelte, solid, preact)
import inspector from 'ide-byebye'; // demo uses ../../dist/index.js
plugins: [inspector(), react() /* or vue() / svelte() / solid() / preact() */]
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

```js
// rsbuild — demo/rsbuild/rsbuild.config.mjs
import inspector from 'ide-byebye/rsbuild';
plugins: [inspector()]
```

```js
// esbuild — demo/esbuild/dev.mjs rewrites a copy of index.html, not the source file
import inspector from 'ide-byebye/esbuild';
plugins: inspector({ htmlFiles: ['./dist/index.html'] })
```

```js
// Farm — farm() returns [stamp, inspector]
import inspector from 'ide-byebye/farm';
plugins: [...inspector()]
```

```js
// Next.js — demo/next/next.config.mjs
import withIdeByebye from 'ide-byebye/next';
export default withIdeByebye(nextConfig);
```

See the package root `../README.md` for the full option list (agents, recording, locale…).

## How it's wired

This demo imports the built plugin from `dist/` (not TypeScript source):

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
| Turbopack (Next) | `ide-byebye/next` (`withIdeByebye`) |
| Angular CLI | `ide-byebye/angular` (`angularProxy` + dev `scripts`) |
| Mako (Umi) | `ide-byebye/mako` *(data-insp-path only)* |
