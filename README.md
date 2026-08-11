# ide-byebye

> ⌘-click any rendered element in your dev server, describe the change in plain
> words, and hand the element's **source location + your intent** straight to
> **Codex App**, **Claude App**, **Cursor**, or **Grok Build** — no hunting
> through the IDE.

`ide-byebye` is a **dev-only** multi-bundler plugin (Vite / webpack / rspack /
rsbuild / esbuild / Farm, plus Turbopack & Mako path injection). It overlays a
source-aware element picker on your running app: pick a button, type *"make this
the primary button and add a loading state"*, optionally attach screenshots /
captured styles / a short interaction recording, then click an agent button. The
plugin assembles a structured prompt (the element's `file:line`, surrounding
source context, your intent, and any attachments) and hands it to the chosen
agent — via app deeplink for Codex / Claude / Cursor, or via a Terminal launcher
for Grok Build.

It is glue, not a model: it never edits your files itself and ships no AI SDK.
The actual change is made by whichever coding agent you hand off to.

---

## Table of contents

- [How it works](#how-it-works)
- [Install](#install)
- [Quick start](#quick-start)
- [Requirements](#requirements)
- [The intent dialog](#the-intent-dialog)
- [Configuration reference](#configuration-reference)
  - [Top-level options](#top-level-options)
  - [Agents](#agents)
  - [App-agent options](#app-agent-options)
  - [Recording](#recording-rrweb)
- [Two ways to ship it](#two-ways-to-ship-it)
- [Where artifacts go](#where-artifacts-go)
- [Localization](#localization)
- [Security & privacy](#security--privacy)
- [Build from source](#build-from-source)
- [License](#license)

---

## How it works

1. **Pick** — press the hotkey (default `Alt+Shift+I`) to enter picker mode, or
   hold a configured `clickModifier` (e.g. `⌘`) and click. The element you click
   is read back through the `data-insp-path` attribute that
   [`code-inspector-plugin`](https://github.com/zh-lx/code-inspector) injects at
   build time, so the plugin knows the exact source `file:line:column`.
2. **Describe** — an intent dialog opens anchored to the element. Type what you
   want changed. Optionally add more `@code` references, screenshots, captured
   computed styles, or an interaction recording.
3. **Hand off** — click **Codex App / Claude App / Cursor / Grok Build**. The
   plugin's local dev-server endpoint resolves the source context, builds a
   prompt, and opens the chosen agent (deeplink or Terminal) with everything
   prefilled.

Nothing leaves your machine except the deeplink you trigger; the server half
runs as a standalone loopback HTTP server on `127.0.0.1` and is gated by a
per-process token. Bundler adapters only inject the bootstrap into your HTML.

## Install

```sh
npm i -D ide-byebye code-inspector-plugin
```

`code-inspector-plugin` is a **dependency** (also listed so you can pin it) — it
injects the `data-insp-path` attributes this plugin reads. Without it, elements
have no source mapping and the picker shows *"no source mapping"*.

Behavior recording is **on by default** and lazy-loaded (it only costs anything
when you actually record). For it to work, install rrweb in your project too:

```sh
npm i -D @rrweb/record @rrweb/replay
```

Disable it with `recording: false` if you don't want it.

## Quick start

### Vite (default export)

```js
// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react'; // or @vitejs/plugin-vue
import ideByebye from 'ide-byebye';       // same as 'ide-byebye/vite'

export default defineConfig({
  plugins: [
    // Zero config. Registers code-inspector-plugin internally (data-insp-path)
    // before the framework transform. Out of the box: ⌘/Ctrl-click to pick,
    // all footer agents + clipboard + file enabled, recording on, Enter → Claude App.
    ideByebye(),
    react(),
  ],
});
```

### Other bundlers

Pick the matching subpath — **never** pass a `bundler` string yourself:

| Bundler | Import | Notes |
| --- | --- | --- |
| **Vite** | `ide-byebye` / `ide-byebye/vite` | Full zero-config (default). |
| **webpack** | `ide-byebye/webpack` | `plugins: [inspector()]` — injects into HtmlWebpackPlugin output. |
| **rspack** | `ide-byebye/rspack` | Same shape as webpack. |
| **rsbuild** | `ide-byebye/rsbuild` | `plugins: [inspector()]`. |
| **esbuild** | `ide-byebye/esbuild` | Pass `htmlFiles: ['./index.html']` if HTML is not in `outdir`. |
| **Farm** | `ide-byebye/farm` | Returns `[codeInspector, inspector]` — spread into Farm plugins. |
| **Turbopack** (Next) | `ide-byebye/turbopack` | Returns **rules only** (`data-insp-path`). Bootstrap must be mounted by the app. |
| **Mako** (Umi) | `ide-byebye/mako` | Same caveat as Turbopack — path injection only. |

```js
// webpack.config.js
import inspector from 'ide-byebye/webpack';
export default {
  plugins: [new HtmlWebpackPlugin({ template: './index.html' }), inspector()],
};
```

```js
// rsbuild.config.ts
import { defineConfig } from '@rsbuild/core';
import inspector from 'ide-byebye/rsbuild';
export default defineConfig({ plugins: [inspector()] });
```

```js
// esbuild
import * as esbuild from 'esbuild';
import inspector from 'ide-byebye/esbuild';
await esbuild.context({
  entryPoints: ['src/main.jsx'],
  bundle: true,
  outdir: 'dist',
  plugins: inspector({ htmlFiles: ['./index.html'] }), // rewrites HTML after build
});
```

Everything above is already the default. You only pass options to **override** —
for example to change the Enter-key target, route Cursor to a named workspace, or
turn things off:

```js
ideByebye({
  // The dialog footer shows Codex App / Claude App / Cursor / Grok Build, so the
  // Enter-key default must be one of those four (defaults to 'claude-app').
  defaultAgent: 'codex-app',
  agents: {
    cursorApp: { workspace: 'my-app' }, // optional: override auto git-root workspace name
    grokBuild: { permissionMode: 'plan' }, // optional Grok Build CLI flags
    codexApp: false,                    // disable an app agent you don't want
    file: false,                        // disable a backend agent (clipboard/file)
  },
  recording: false, // opt out of element-behavior recording
});
```

> The default export and the named export `codeIntentInspectorPlugin` are the
> same function (Vite) — use whichever you prefer.

### Vue

Works with Vue 2/3 SFCs for **DOM → source path** mapping (via code-inspector).
Prompt **source context** for `.vue` files is best-effort: the template around
the click is sliced by line (not a full `@vue/compiler-dom` AST). That is enough
to hand an agent the right file and region; JSX/TSX still get the richer AST path.

See `demo/vue` for a runnable Vue 3 + Vite / webpack playground.

## Requirements

- **A supported bundler in dev** — Vite `>=4`, webpack `>=5`, rspack, rsbuild,
  esbuild, or Farm for the full zero-config experience. Turbopack / Mako only
  provide `data-insp-path` (you mount the bootstrap yourself).
- **`code-inspector-plugin`** is bundled as a dependency; you do not need to
  register it by hand when using the adapters above.
- **macOS** for the footer agents out of the box: app agents open deeplinks via
  the native `open` command, and Grok Build opens a `.command` launcher the same
  way. On Linux/Windows, set `openCommand` per agent (see
  [App-agent options](#app-agent-options)).
- **The target agent installed** (Codex App / Claude App / Cursor / [Grok Build
  CLI](https://x.ai/cli)) so it can respond to the handoff. No extra npm deps are
  needed for these agents.

## The intent dialog

| Feature | What it does | Notes |
| --- | --- | --- |
| **Element pick** | ⌘-click (or hotkey + click) selects an element and opens the dialog anchored to it. | Re-resolves from `data-insp-path` after SPA re-renders. |
| **Mention editor** | The intent field is a rich contenteditable. The picked element is shown as a pinned, non-removable primary reference. | Empty intent is allowed if you attach references. |
| **`@code` references** | The "add reference" button lets you pick **another** element and inserts an inline `@file #range` mention at the caret. | Duplicates are de-duped; order is preserved into the prompt. |
| **Screenshots** | Capture `selection` / `parent` / `viewport` (multi-select, or none). | Choices persist as a local UI preference. |
| **Rendered styles** | Attach the element's **computed** CSS (a curated catalog of ~110 properties) for the selected element only or the whole ancestor chain. | Opt-in (empty by default); read live at send time. |
| **Recording** | rrweb element-behavior capture with a still frame the agent can read. | On by default; needs `@rrweb/*`. Disable with `recording: false`. See below. |
| **Pin** | Collapse the dialog into a floating orb and keep editing across pages. | Warm restore keeps attachments; a full reload keeps text only. |

## Configuration reference

`ideByebye(options)` accepts the following. Every option is optional; invalid
optional values fall back to the documented default.

### Top-level options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | Master on/off switch. Only `false` disables. |
| `locale` | `'zh' \| 'en'` | auto | UI language. Anything starting with `zh` → Chinese, any other value → English. Unset auto-detects: `config.locale` → `navigator.language` → `zh`. (Only UI copy is localized; prompts and brand names are not.) |
| `hotkey` | `string` | `'Alt+Shift+I'` | Combo that toggles picker mode. `+`-joined, case-insensitive. Modifiers: `alt`/`option`, `shift`, `ctrl`/`control`, `meta`/`cmd`/`command`. The last non-modifier token is the key, e.g. `'Meta+Shift+K'`. |
| `clickModifier` | `string \| null` | `'auto'` | Hold-to-pick modifier for a normal click. `'auto'` resolves per-platform (⌘ on macOS, Ctrl elsewhere); pass `'meta'`/`'ctrl'`/`'alt'`/`'shift'` to force one, or `null`/`false` to disable click-to-pick (the hotkey still works). |
| `defaultAgent` | `string` | `'claude-app'` | Target for the Enter key. **Must be one of `'codex-app'` / `'claude-app'` / `'cursor-app'` / `'grok-build'`** — those are the only agents with footer buttons, so a `clipboard`/`file` value falls back to the first enabled footer agent. |
| `applyMode` | `'prompt-only' \| 'agent-edit'` | `'prompt-only'` | Hint recorded with the request: propose a plan vs. allow edits. |
| `outputDir` | `string` | `'.intent-inspector'` | Project-relative dir where the `file` agent and file-mode handoffs write. Must stay inside the project root. |
| `maxSourceContextLines` | `number` | `60` | Source lines of context captured around the element's mapped location. |
| `maxDomSnippetLength` | `number` | `1000` | Max characters of the element's captured DOM/HTML snippet. |
| `apiOrigin` | `string \| null` | auto | Absolute `http(s)` origin the browser uses to reach the inspector server. Auto-detects the Vite loopback origin when unset. A non-origin value is ignored. |
| `pathStyle` | `'relative' \| 'absolute'` | `'relative'` | How source file paths appear in plain `@` prompts (clipboard / file / Grok Build). `'relative'` → `@src/App.tsx`; `'absolute'` → `@/abs/path/src/App.tsx`. For Grok Build monorepos prefer `agents.grokBuild.projectRoot` (relative refs become `@apps/pkg/…`) over forcing absolute. |
| `artifactPathStyle` | `'relative' \| 'absolute'` | `'absolute'` | How screenshots / recording stills appear in plain `@` prompts. Defaults to **absolute** so agents can open images regardless of cwd / monorepo layout; set `'relative'` for short `@.intent-inspector/…` chips under the same root as source. |
| `recording` | `boolean \| object` | on | Element-behavior recording. On by default; opt out with `recording: false`. See [Recording](#recording-rrweb). |
| `agents` | `object` | `{}` | Per-agent enable flags / overrides. All five agents are on by default; use this to disable or configure them. See [Agents](#agents). |

### Agents

Six agents exist and **all six are on by default**. Disable any of them with
`agents.<name>: false`: `agents.clipboard: false` / `agents.file: false` for the
two backend agents, and `agents.codexApp: false` / `agents.claudeApp: false` /
`agents.cursorApp: false` / `agents.grokBuild: false` for the footer agents.
Only the footer agents get buttons — `clipboard`/`file` are reachable through
`defaultAgent` / the Enter key.

| Agent (`agents` key) | Adapter name | Default | Footer button | Purpose |
| --- | --- | --- | --- | --- |
| `clipboard` | `clipboard` | **on** | no | Copies the generated prompt to your clipboard. Always available; the safe fallback. |
| `file` | `file` | **on** | no | Writes the request + prompt as Markdown under `outputDir/requests/`. Always available. |
| `codexApp` | `codex-app` | **on** | yes | Opens **Codex App** prefilled. |
| `claudeApp` | `claude-app` | **on** | yes | Opens **Claude App** prefilled; can attach files & folders. |
| `cursorApp` | `cursor-app` | **on** | yes | Opens **Cursor** prefilled (routes by workspace name). |
| `grokBuild` | `grok-build` | **on** | yes | Opens **Grok Build** in Terminal with the prompt prefilled. |

Each footer agent accepts a config object to override its defaults; `false` (or
`{ enabled: false }`) unregisters it, and `true` is the explicit shorthand for
the on-by-default state.

```js
agents: {
  codexApp: false,                      // turn an app agent off
  cursorApp: { workspace: 'my-app' },   // keep it on, but override options
  grokBuild: {
    permissionMode: 'plan',
    // monorepo: hand off with Grok --cwd at the repo root; @ refs become
    // @apps/desktop/src/… relative to that cwd (no need for pathStyle: 'absolute')
    projectRoot: path.resolve(__dirname, '../..'),
  },
  clipboard: false,                     // turn a backend agent off
}
```

### App-agent options

Codex / Claude / Cursor share `openCommand` / `openArgs` (how the deeplink is
opened) and a `promptMode`. Grok Build reuses the same opener knobs for its
Terminal launcher. They become **unavailable** (button greyed out) when no opener
resolves — i.e. non-macOS without an explicit `openCommand`. Grok Build is also
unavailable when the `grok` CLI is not on PATH (and not at `~/.grok/bin/grok`).

**Common to every footer agent**

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `openCommand` | `string` | `'open'` on macOS, else none | Executable used to open the deeplink / launcher. Set it on Linux/Windows (e.g. `'xdg-open'`). |
| `openArgs` | `string[]` | `[]` | Extra args placed before the URL / launcher path when spawning the opener. |
| `promptMode` | `'auto' \| 'file'` | `'auto'` | `'file'` writes the full context to a Markdown handoff file and sends a compact prompt pointing at it. |

**`agents.claudeApp`**

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `scheme` | `string` | `'claude'` | Deeplink URL scheme (`claude://…`). Validated; an invalid scheme fails the send. |
| `route` | `string` | `'code'` | Path segment → `claude://<route>/new`. |
| `folders` | `string[]` | `[projectRoot]` | Extra **absolute** folders opened alongside the project root (e.g. a sibling backend repo). |
| `attachFiles` | `boolean` | `true` | Attach referenced source files (and screenshots) as deeplink `file` params. `false` disables all attachments. |
| `attachScreenshots` | `boolean` | `true` | Include screenshot artifacts in the attached files. Ignored when `attachFiles` is `false`. |

**`agents.codexApp`**

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `scheme` | `string` | `'codex'` | Deeplink URL scheme (`codex://new`). |
| `projectRoot` | `string` | Vite project root | Overrides the folder opened by the deeplink. Resolved against the Node process cwd. |

**`agents.cursorApp`**

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `workspace` | `string \| false` | nearest git root name (else run-dir name) | Workspace **name** Cursor routes the prompt window to. Default: walk up from the bundler root to the nearest `.git` and use that folder's basename; if none, the run directory basename. Set an explicit string if Cursor's window title differs; `false` omits the param. |
| `mode` | `string` | none | Optional Cursor mode passed through as the `mode` param. |
| `promptUrlLimit` | `number` | `10000` | In `auto` `promptMode`, prompts whose encoded length exceeds this switch to a file handoff (Cursor rejects oversized prompt URLs). |
| `scheme` | `string` | `'cursor'` | Deeplink scheme. |
| `authority` | `string` | `'anysphere.cursor-deeplink'` | Deeplink authority — only change for custom Cursor builds. |
| `route` | `string` | `'prompt'` | Deeplink route segment. |

**`agents.grokBuild`**

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `command` | `string` | `'grok'` (then `~/.grok/bin/grok`) | Grok Build CLI binary. Absolute path recommended if Node's PATH differs from your login shell. |
| `projectRoot` | `string` | Vite project root | Working directory passed to `grok --cwd` and the launcher `cd`. Relative `@` refs are also stripped against this root, so monorepos that point it at the repo root get `@apps/pkg/src/…` instead of long absolute paths. |
| `pathStyle` | `'relative' \| 'absolute'` | `'relative'` | How source paths appear in the Grok prompt `@` refs. Default relative (against `projectRoot` / Grok cwd) keeps chips short (`@src/App.tsx` or `@apps/desktop/src/App.tsx`). Prefer relative + `projectRoot` over absolute for monorepos; use absolute only when files sit outside Grok's cwd. |
| `artifactPathStyle` | `'relative' \| 'absolute'` | `'absolute'` | How screenshots / stills appear in the Grok prompt. Defaults to absolute (cwd-safe); set `'relative'` to match monorepo-rooted source chips. |
| `permissionMode` | `string` | none | Optional `--permission-mode` value (`plan`, `acceptEdits`, `default`, …). |
| `promptArgLimit` | `number` | `12000` | In `auto` `promptMode`, prompts longer than this switch to a file handoff so the Terminal argv stays under ARG_MAX. |

### Recording (rrweb)

Beyond static screenshots, the dialog can record **element behavior** with
[rrweb](https://github.com/rrweb-io/rrweb): pick a scope, click record — the
dialog steps aside and the page becomes interactive while a floating control
counts up — interact, then stop. You can trim the clip in-browser; a still frame
is rasterized from the chosen moment (cropped to the scope) so the agent gets an
image it can read. The raw event stream is saved for human replay but never put
in the prompt, and the inspector's own UI is excluded from every recording.

Recording is **on by default** (opt-out) and lazy-loaded. It only needs rrweb
installed in your project:

```sh
npm i -D @rrweb/record @rrweb/replay
```

Pass `recording: false` to turn it off, or an object to tune it:

```js
ideByebye({
  recording: {
    maxDurationMs: 30000,      // rolling buffer; clamped to 300000 (5 min)
    mask: {
      allInputs: false,        // default off: dev tooling wants real form state
      blockClass: 'rr-block',  // elements with this class are excluded
    },
  },
});
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `recording` | `boolean` | `true` | On by default; `false` (or `{ enabled: false }`) hides the Record button. |
| `recording.maxDurationMs` | `number` | `30000` | In-browser rolling buffer length. Must be positive; clamped to a `300000`ms (5 min) ceiling. |
| `recording.mask.allInputs` | `boolean` | `false` | Mask input values in the replay/still. Off by default (dev tool). |
| `recording.mask.blockClass` | `string` | `'rr-block'` | Class marking elements excluded from capture. |

The rrweb ESM bundles are served lazily from your project's `node_modules` over
`/__intent-inspector/vendor/{record,replay}`, so the plugin stays small and only
pays the cost when recording is actually used. The still frame reuses the same
SVG-`<foreignObject>` → canvas rasterizer as screenshots, so it shares the same
limits: cross-origin assets without CORS may be blank, web fonts must be
loadable, and **`canvas`/WebGL content is not captured**.

## Two ways to ship it

**1. npm package (recommended)** — install and import as shown above. The
package ships the prebuilt browser runtime (`dist/client.js`) and the server
middleware.

**2. Single-file copy** — for projects that don't want a dependency, build a
portable single file and copy it in:

```sh
npm run build
# → dist/code-intent-inspector.js  (embeds the browser runtime)
# → dist/client.js                 (browser runtime for source-tree usage)
```

```js
import codeIntentInspectorPlugin from './code-intent-inspector.js';
```

## Where artifacts go

Everything is written under `outputDir` (default `.intent-inspector/`, inside
your project root — add it to `.gitignore`):

- `requests/<timestamp>-<id>.md` — full request + prompt, written by the `file`
  agent and by any footer agent in `promptMode: 'file'` (or auto size overflow).
- `launches/<timestamp>-<id>.command` + `.prompt.txt` — Grok Build Terminal
  launcher and the prompt body it feeds to `grok --verbatim`.
- `recordings/<id>.rrweb.json` + `<id>.webp` — recording event stream and still
  frame (when recording is used).
- screenshot artifacts referenced by the prompt.

The prompt itself groups, in order: `@code` references, a **Rendered styles**
block (when styles are attached), then your intent. Absolute source paths in
captured styles are intentionally kept out of deeplink prompt text.

## Localization

All UI copy lives in one bilingual table (`zh` / `en`). The locale resolves from
`locale` config → `navigator.language` → `zh`. Set `locale: 'en'` to force
English regardless of the browser:

```js
ideByebye({ locale: 'en' });
```

## Security & privacy

- **Dev-only.** Adapters refuse production mode (Vite `apply: 'serve'`, webpack
  `mode === 'production'` skip, etc.); the inspector is not meant for production
  builds.
- **Token-gated.** Every inspector request carries a per-process token; the
  browser fetches go to an explicit `127.0.0.1` origin, not your app's domain.
- **Stays in the project root.** File writes are guarded to remain inside the
  project; the deeplink only carries what you chose to send.
- **Captured style values are sanitized** server-side (control characters
  stripped) so they can't forge extra prompt lines.

## Build from source

```sh
npm install      # or pnpm install
npm run build    # regenerate dist/
npm test         # node:test suite
```

Source layout: `src/client/` (browser runtime), `src/server/` (loopback inspector
server + agent adapters), `src/shared/` (isomorphic constants/helpers),
`plugin.js` (multi-bundler unplugin factory), `scripts/build-single-file.js`.

## License

[MIT](./LICENSE) © dravenLee
