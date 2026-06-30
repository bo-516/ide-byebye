# ai-inspector demo

A minimal Vite + React app for testing the **code-intent-inspector** plugin.
Trigger it by **holding ⌘ (Command) and clicking any element on the page**.

## Run

In this directory:

```sh
pnpm install
pnpm dev
```

The browser opens the demo automatically at `http://localhost:5300`.

## How to test

1. **Hold ⌘** and move the mouse — the hovered element gets a highlight preview.
2. **⌘ + click** any element (heading, button, card, input, list item…).
3. The "intent" dialog opens, already carrying that element's **source location and context**.
4. Type your change request (e.g. "make this button rounded").
5. Click an **app button** at the bottom: `Codex App` / `Claude App` / `Cursor`. The plugin assembles
   "element source + your intent" into a structured prompt and opens the matching app via deeplink with a
   prefilled new conversation. Press **Enter** to submit to `claude-app` by default.

> ⚠️ The dialog's footer buttons are **fixed** to Codex App / Claude App / Cursor (hard-coded on the client —
> see `AGENT_ACTIONS` in `client/dialog-utils.js`). These three app agents are **now enabled by default**, so this
> demo lights them all up with zero config. Whichever button you click, the matching app must be installed locally
> to actually open.
>
> After editing `vite.config.js` the dev server restarts automatically — **remember to refresh the browser page**.

> Alternative trigger: press the hotkey `Alt+Shift+I` to enter/exit pick mode, then click elements normally.

## Key config (see `vite.config.js`)

```js
// Zero config. The plugin registers code-inspector-plugin internally (it injects the data-insp-path source
// location), so you don't add it yourself. The defaults are exactly what this demo wants:
// - ⌘/Ctrl-click to pick (clickModifier defaults to 'auto')
// - recording (rrweb) on
// - clipboard / file + all three app agents (codex / claude / cursor) enabled
// - Enter submits to claude-app
codeIntentInspectorPlugin(),
```

Zero config is enough, so this demo passes no options. If you want to try the override form, add them as needed:

```js
codeIntentInspectorPlugin({
  clickModifier: 'meta',                 // ⌘ to trigger; 'command' / 'cmd' also work
  defaultAgent: 'codex-app',             // change the Enter-key target (defaults to 'claude-app')
  agents: {
    cursorApp: { workspace: 'demo' },    // keep Cursor enabled but route by workspace name
    codexApp: false,                     // disable an app agent you don't want
  },
  recording: false,                      // turn recording off
}),
```

- `clickModifier`: the hold-to-pick modifier, defaults to `'auto'` (⌘ on macOS, Ctrl elsewhere). Pass
  `'meta'`/`'control'`/`'alt'`/`'shift'` to force one, or `null`/`false` to disable click-picking (the
  `Alt+Shift+I` hotkey still works).
- `defaultAgent`: the Enter-key target, **must be one of the three footer app agents**, defaults to `'claude-app'`.

## Agents

- **The footer buttons are fixed to `codex-app` / `claude-app` / `cursor-app`**, and these three app agents are
  **now enabled by default**. All three rely only on the macOS `open` command to launch `codex://` / `claude://` /
  `cursor://` deeplinks, so they need **no extra npm dependencies**, but the matching app must be installed to
  respond. Disable one with `agents.<name>: false`.
- `clipboard` / `file` are also enabled by default but have **no footer button** — they are backend agents
  (`file` writes the request into `.intent-inspector/`). Disable them with `agents.clipboard: false` /
  `agents.file: false`.
- `cursorApp.workspace`: routes by the workspace name shown in Cursor; change it if it differs from the folder name.
- `claudeApp` / `codexApp` also support `projectRoot`, `folders`, and more — see the repo root `../README.md`.

## How it's wired

This demo imports the plugin source directly (so you can edit the plugin and test in place):

```js
import codeIntentInspectorPlugin from '../index.js';
```

In a real project, run `npm run build` at the repo root and copy the single-file
`dist/code-intent-inspector.js` into your project, then import that instead.

The inspector runs on its own loopback server and the page reaches it cross-origin (CORS + a per-process token
handle that), so the demo no longer needs a special `server.host` binding.
