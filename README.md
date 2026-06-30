# ide-byebye

> ⌘-click any rendered element in your dev server, describe the change in plain
> words, and hand the element's **source location + your intent** straight to
> **Codex App**, **Claude App**, or **Cursor** — no hunting through the IDE.

`ide-byebye` is a Vite **dev-only** plugin. It overlays a source-aware element
picker on your running app: pick a button, type *"make this the primary button
and add a loading state"*, optionally attach screenshots / captured styles / a
short interaction recording, then click an app button. The plugin assembles a
structured prompt (the element's `file:line`, surrounding source context, your
intent, and any attachments) and opens the target app via its deeplink with that
prompt prefilled.

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
3. **Hand off** — click **Codex App / Claude App / Cursor**. The plugin's local
   dev-server endpoint resolves the source context, builds a prompt, and opens
   the chosen app via deeplink with everything prefilled.

Nothing leaves your machine except the deeplink you trigger; the server half
runs as Vite middleware on `127.0.0.1` and is gated by a per-process token.

## Install

```sh
npm i -D ide-byebye code-inspector-plugin
```

`code-inspector-plugin` is a **peer dependency** — it injects the
`data-insp-path` attributes this plugin reads. Without it, elements have no
source mapping and the picker shows *"no source mapping"*.

Behavior recording is **on by default** and lazy-loaded (it only costs anything
when you actually record). For it to work, install rrweb in your project too:

```sh
npm i -D @rrweb/record @rrweb/replay
```

Disable it with `recording: false` if you don't want it.

## Quick start

```js
// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { codeInspectorPlugin } from 'code-inspector-plugin';
import ideByebye from 'ide-byebye';

export default defineConfig({
  plugins: [
    // 1) code-inspector-plugin MUST run before @vitejs/plugin-react so it can
    //    inject data-insp-path onto every element before the JSX transform.
    //    Turn off its own jump/copy hotkeys to avoid clashing with this plugin.
    codeInspectorPlugin({
      bundler: 'vite',
      pathType: 'absolute',
      hotKeys: ['altKey'],
      behavior: { locate: false, copy: false, defaultAction: 'target' },
    }),

    react(),

    // 2) ide-byebye: the intent picker + app handoff.
    //    Zero config works out of the box: all three app agents + clipboard +
    //    file are enabled, recording is on, and Enter submits to Claude App.
    ideByebye({
      clickModifier: 'meta', // ⌘ + click to pick an element (macOS)
    }),
  ],
  server: {
    // Bind IPv4 so it matches the http://127.0.0.1 origin the plugin uses.
    host: '127.0.0.1',
  },
});
```

Everything above is already the default. You only pass options to **override** —
for example to change the Enter-key target, route Cursor to a named workspace, or
turn things off:

```js
ideByebye({
  // The dialog footer always shows Codex App / Claude App / Cursor, so the
  // Enter-key default must be one of those three (defaults to 'claude-app').
  defaultAgent: 'codex-app',
  agents: {
    cursorApp: { workspace: 'my-app' }, // route Cursor by workspace name
    codexApp: false,                    // disable an app agent you don't want
    file: false,                        // disable a backend agent (clipboard/file)
  },
  recording: false, // opt out of element-behavior recording
});
```

> The default export and the named export `codeIntentInspectorPlugin` are the
> same function — use whichever you prefer.

## Requirements

- **Vite** `>=4` (tested on Vite 8) — it's a Vite plugin and only runs in dev.
- **`code-inspector-plugin`** in the host project, ordered **before** your
  framework plugin, with its own hotkeys disabled.
- **macOS** for the three app agents out of the box: they open deeplinks via the
  native `open` command. On Linux/Windows, set `openCommand` per agent (see
  [App-agent options](#app-agent-options)).
- **The target app installed** (Codex App / Claude App / Cursor) so it can
  respond to its deeplink. No extra npm deps are needed for the app agents.

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
| `clickModifier` | `string \| null` | `null` | Hold-to-pick modifier for a normal click (`'meta'`, `'ctrl'`, `'alt'`, `'shift'`). `null` disables click-to-pick (hotkey still works). |
| `defaultAgent` | `string` | `'claude-app'` | Target for the Enter key. **Must be one of `'codex-app'` / `'claude-app'` / `'cursor-app'`** — those are the only agents with footer buttons, so a `clipboard`/`file` value falls back to the first enabled app agent. |
| `applyMode` | `'prompt-only' \| 'agent-edit'` | `'prompt-only'` | Hint recorded with the request: propose a plan vs. allow edits. |
| `outputDir` | `string` | `'.intent-inspector'` | Project-relative dir where the `file` agent and file-mode handoffs write. Must stay inside the project root. |
| `maxSourceContextLines` | `number` | `60` | Source lines of context captured around the element's mapped location. |
| `maxDomSnippetLength` | `number` | `1000` | Max characters of the element's captured DOM/HTML snippet. |
| `apiOrigin` | `string \| null` | auto | Absolute `http(s)` origin the browser uses to reach the inspector server. Auto-detects the Vite loopback origin when unset. A non-origin value is ignored. |
| `recording` | `boolean \| object` | on | Element-behavior recording. On by default; opt out with `recording: false`. See [Recording](#recording-rrweb). |
| `agents` | `object` | `{}` | Per-agent enable flags / overrides. All five agents are on by default; use this to disable or configure them. See [Agents](#agents). |

### Agents

Five agents exist and **all five are on by default**. Disable any of them with
`agents.<name>: false`: `agents.clipboard: false` / `agents.file: false` for the
two backend agents, and `agents.codexApp: false` / `agents.claudeApp: false` /
`agents.cursorApp: false` for the app agents. Only the app agents get footer
buttons — `clipboard`/`file` are reachable through `defaultAgent` / the Enter key.

| Agent (`agents` key) | Adapter name | Default | Footer button | Purpose |
| --- | --- | --- | --- | --- |
| `clipboard` | `clipboard` | **on** | no | Copies the generated prompt to your clipboard. Always available; the safe fallback. |
| `file` | `file` | **on** | no | Writes the request + prompt as Markdown under `outputDir/requests/`. Always available. |
| `codexApp` | `codex-app` | **on** | yes | Opens **Codex App** prefilled. |
| `claudeApp` | `claude-app` | **on** | yes | Opens **Claude App** prefilled; can attach files & folders. |
| `cursorApp` | `cursor-app` | **on** | yes | Opens **Cursor** prefilled (routes by workspace name). |

Each app agent accepts a config object to override its defaults; `false` (or
`{ enabled: false }`) unregisters it, and `true` is the explicit shorthand for
the on-by-default state.

```js
agents: {
  codexApp: false,                      // turn an app agent off
  cursorApp: { workspace: 'my-app' },   // keep it on, but override options
  clipboard: false,                     // turn a backend agent off
}
```

### App-agent options

All three share `openCommand` / `openArgs` (how the deeplink is opened) and a
`promptMode`. They become **unavailable** (button greyed out) when no opener
resolves — i.e. non-macOS without an explicit `openCommand`.

**Common to every app agent**

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `openCommand` | `string` | `'open'` on macOS, else none | Executable used to open the deeplink. Set it on Linux/Windows (e.g. `'xdg-open'`). |
| `openArgs` | `string[]` | `[]` | Extra args placed before the URL when spawning the opener. |
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
| `workspace` | `string \| false` | project folder name | Workspace **name** Cursor routes the prompt window to. Set it if Cursor shows a different name than the folder; `false` omits it. |
| `mode` | `string` | none | Optional Cursor mode passed through as the `mode` param. |
| `promptUrlLimit` | `number` | `10000` | In `auto` `promptMode`, prompts whose encoded length exceeds this switch to a file handoff (Cursor rejects oversized prompt URLs). |
| `scheme` | `string` | `'cursor'` | Deeplink scheme. |
| `authority` | `string` | `'anysphere.cursor-deeplink'` | Deeplink authority — only change for custom Cursor builds. |
| `route` | `string` | `'prompt'` | Deeplink route segment. |

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
  agent and by any app agent in `promptMode: 'file'`.
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

- **Dev-only.** The plugin attaches middleware to the Vite dev server; it is not
  meant for production builds.
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

Source layout: `client/` (browser runtime), `server/` (Vite middleware + agent
adapters), `shared/` (isomorphic constants/helpers), `plugin.js` (Vite plugin
entry), `scripts/build-single-file.js` (bundler).

## License

[MIT](./LICENSE) © dravenLee
