# Configuration

[English](./CONFIGURATION.md) | [中文](./CONFIGURATION.zh-CN.md)

`ideByebye(options)`: every option is optional, and an invalid value falls back to
its default instead of throwing. The same options object works for every entry
point (`ide-byebye/vite`, `/webpack`, `/next`, `angularProxy(options)`, …), and the
package ships type definitions.

- [Top-level options](#top-level-options)
- [Agents](#agents)
  - [Shared options](#shared-options)
  - [Per-agent options](#per-agent-options)
  - [`agents.custom`](#agentscustom)
  - [Windows](#windows)
- [Send to an existing session](#send-to-an-existing-session)
- [Recording](#recording)
- [Output files](#output-files)
- [Framework notes](#framework-notes)

## Top-level options

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | `false` turns it off completely: no server, no injection. |
| `defaultAgent` | `string` | `'claude-app'` | Enter target: `'codex-app'`, `'claude-app'`, `'cursor-app'`, `'grok-build'`, `'claude-cli'`, `'opencode'`, `'devin-cli'`, `'antigravity-ide'`, `'antigravity'`, `'devin-ide'`, `'windsurf-ide'`, or an [`agents.custom`](#agentscustom) name. Unknown or disabled values, `'clipboard'` and `'file'` fall back to the first enabled footer agent. Once you pick another agent in the dialog, Enter follows that choice (remembered per browser). |
| `theme` | `'light' \| 'auto' \| 'dark'` | `'light'` | Dialog theme. `'auto'` follows the OS. When unset, the page logs a console hint naming this option. |
| `locale` | `'zh' \| 'en'` | auto | UI language: this option, then `navigator.language`, then `zh`. Any string starting with `zh` means Chinese. Prompts are never localized. |
| `hotkey` | `string` | `'Alt+Shift+I'` | Toggles the picker. `+`-joined, case-insensitive. Modifiers: `alt`/`option`, `shift`, `ctrl`/`control`, `meta`/`cmd`/`command`; the last token is the key. |
| `clickModifier` | `string \| null \| false` | `'auto'` | Hold-to-pick key: ⌘ on macOS, Ctrl elsewhere. Force one with `'meta'` / `'ctrl'` / `'alt'` / `'shift'`; `null` / `false` turns click-to-pick off (the hotkey still works). |
| `applyMode` | `'prompt-only' \| 'agent-edit'` | `'prompt-only'` | Hint in the handoff: propose a plan only, or allow edits. |
| `outputDir` | `string` | `'.intent-inspector'` | Where handoff files and media go. Must stay inside the project root. Gitignore it. |
| `maxSourceContextLines` | `number` | `60` | Source lines around the element that go into the prompt. |
| `maxDomSnippetLength` | `number` | `1000` | Max characters of the captured DOM snippet. |
| `apiOrigin` | `string \| null` | auto | Absolute `http(s)` origin (no trailing slash) of the inspector server, when the page can't reach the default loopback one. |
| `pathStyle` | `'relative' \| 'absolute'` | `'relative'` | Source paths in plain `@` prompts (clipboard, file, CLI agents). |
| `artifactPathStyle` | `'relative' \| 'absolute'` | `'absolute'` | Screenshot and still-frame paths in `@` prompts. Absolute so the agent can open them from any cwd. |
| `recording` | `boolean \| object` | off | See [Recording](#recording). |
| `agents` | `object` | `{}` | See [Agents](#agents). Unknown keys are ignored. |
| `sourceStamp` | `false \| { include?, exclude?, escapeTags? }` | on | Built-in `data-insp-path` stamping. `false` turns it off. `include` stamps matching paths even under `node_modules`; `exclude` skips paths; `escapeTags` adds tags to leave unstamped. |
| `codeInspector` | `object` | — | Deprecated in 0.6.0, removed in 0.7.0. Only `include`, `exclude`, `escapeTags` and `close: true` (same as `sourceStamp: false`) are mapped. |
| `htmlFiles` | `string[]` | `*.html` in `outdir` | **esbuild only.** HTML files to inject into when they aren't emitted to `outdir`. |
| `root` | `string` | see notes | **Next.js / Angular only.** The project directory, when it isn't the folder of `next.config.*` (Next.js) or the `ng serve` cwd (Angular). |

For a monorepo, prefer pointing an agent's `projectRoot` at the repo root over
`pathStyle: 'absolute'`: refs then read `@apps/web/src/…`, which is shorter and
still resolves.

## Agents

Thirteen built-in agents; nine are on by default. `agents.<key>: false` (or
`{ enabled: false }`) turns one off; an object keeps it on and overrides its
options. The four opt-in agents stay hidden until you set their key.

| Key | Id | Default | What it does |
| --- | --- | --- | --- |
| `claudeApp` | `claude-app` | on | Opens **Claude App** prefilled; can attach files and folders. |
| `codexApp` | `codex-app` | on | Opens **Codex App** prefilled. |
| `cursorApp` | `cursor-app` | on | Opens **Cursor** prefilled, routed by workspace name. |
| `grokBuild` | `grok-build` | on | Runs **Grok Build** in Terminal with the prompt. |
| `claudeCli` | `claude-cli` | on | Opens **Claude Code CLI**: prefilled via `claude-cli://`, or run in Terminal and submitted. |
| `opencode` | `opencode` | on | Opens **OpenCode**: prefilled in the 1.x desktop app, or the CLI in Terminal, submitted. |
| `devinCli` | `devin-cli` | on | Runs **Devin** in Terminal with the prompt as the first message. |
| `clipboard` | `clipboard` | on | The **Copy prompt** button. Never an Enter target. |
| `file` | `file` | on | Writes the request as Markdown under `outputDir/requests/`. No button; reach it with `promptMode: 'file'`. |
| `antigravityIde` | `antigravity-ide` | opt-in | Opens **Antigravity IDE** on the project, prompt in the agent input. |
| `antigravity` | `antigravity` | opt-in | Opens the **Antigravity** desktop app, prompt in its composer. |
| `devinIde` | `devin-ide` | opt-in | Opens **Devin Desktop**, prompt in the Cascade composer. |
| `windsurfIde` | `windsurf-ide` | opt-in | Opens **Windsurf**, prompt in the Cascade composer. |

```js
agents: {
  codexApp: false,
  cursorApp: { workspace: 'my-app' },
  grokBuild: {
    permissionMode: 'plan',
    projectRoot: path.resolve(__dirname, '../..'), // monorepo root → @apps/web/src/…
  },
  claudeCli: { permissionMode: 'plan' },
  antigravity: { mode: 'plan' },
  windsurfIde: { submit: true },
}
```

A CLI agent's button is greyed out when its binary isn't found; the tooltip says
what to install. Deeplink agents (Claude, Codex, Cursor) stay enabled, and the OS
reports a missing app.

### Shared options

Every footer agent accepts these. The IDE agents (Antigravity IDE, Devin Desktop,
Windsurf) ignore `openCommand` / `openArgs`, since their own CLI starts the app.

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | `false` unregisters the agent. |
| `openCommand` | `string` | `open` / `cmd` / `xdg-open` | Executable that opens the deeplink or launcher. See [Windows](#windows). |
| `openArgs` | `string[]` | platform prefix | Args placed before the URL or launcher path. |
| `promptMode` | `'auto' \| 'file'` | `'auto'` | `'file'` writes the full handoff to `requests/` and sends a short prompt pointing at it. In `'auto'`, agents with a length limit switch to the file on their own when the prompt is too long. |

### Per-agent options

`projectRoot` defaults to the bundler's project root everywhere. Relative `@` refs
are made relative to it. Per-agent `pathStyle` / `artifactPathStyle` override the
top-level ones for that agent's prompt only. `promptArgLimit` (default `12000`)
is the prompt length above which a Terminal agent switches to a file pointer.

#### `agents.claudeApp`

| Option | Default | What it does |
| --- | --- | --- |
| `folders` | `[]` | Extra folders opened with the project root (relative to the process cwd). |
| `attachFiles` | `true` | Attach referenced source files and screenshots. |
| `attachScreenshots` | `true` | Include screenshots. Ignored when `attachFiles` is `false`. |
| `scheme` / `route` | `'claude'` / `'code'` | Deeplink `claude://<route>/new`. |

#### `agents.codexApp`

| Option | Default | What it does |
| --- | --- | --- |
| `projectRoot` | project root | Folder the deeplink opens. |
| `sessions` | on | Existing-thread list. `false` removes it; `{ limit (1–50, 20), lookbackDays (30), home ($CODEX_HOME or ~/.codex) }` tunes it. |
| `scheme` | `'codex'` | Deeplink scheme. |

#### `agents.cursorApp`

| Option | Default | What it does |
| --- | --- | --- |
| `workspace` | git-root folder name | Workspace **name** Cursor routes to (not a path). Set it when Cursor's window title differs; `false` omits it. |
| `projectRoot` | — | Use this folder's name as `workspace`. |
| `mode` | — | Cursor `mode` deeplink param. |
| `promptUrlLimit` | `10000` | Encoded prompts longer than this switch to a file pointer. |
| `scheme` / `authority` / `route` | `'cursor'` / `'anysphere.cursor-deeplink'` / `'prompt'` | Only for custom Cursor builds. |

#### `agents.grokBuild`

| Option | Default | What it does |
| --- | --- | --- |
| `command` | `grok`, then `~/.grok/bin/grok` | CLI path. Use an absolute path if Node's `PATH` differs from your shell's. |
| `projectRoot` | project root | `grok --cwd`. |
| `permissionMode` | — | `--permission-mode` (`plan`, `acceptEdits`, …). |
| `sessions` | on | Existing-session list; only a closed session can be resumed. `false` removes it; `{ limit, home }` tunes it. |
| `pathStyle` / `artifactPathStyle` / `promptArgLimit` | | See above. |

#### `agents.claudeCli`

`launch: 'auto'` opens `claude-cli://` in the terminal you used last, with the
prompt prefilled, when the handler is registered and the prompt fits (5000
characters). Otherwise it runs `claude -- "<prompt>"` in Terminal, which submits.
The CLI registers the handler itself the first time you use an interactive
`claude` session. On Linux and Windows a stale handler can't be detected; set
`launch: 'terminal'` if the link opens nothing.

| Option | Default | What it does |
| --- | --- | --- |
| `launch` | `'auto'` | `'deeplink'` or `'terminal'` pins a route. |
| `command` | `claude`, `~/.local/bin/claude`, `~/.claude/local/claude`, then the handler's CLI | CLI for the Terminal route. |
| `permissionMode` | — | Terminal route only. |
| `projectRoot` / `pathStyle` / `artifactPathStyle` / `promptArgLimit` | | See above. |

#### `agents.opencode`

`launch: 'auto'` reads the macOS desktop app's version. OpenCode 1.x gets an
`opencode://` link with the prompt prefilled. 2.x desktops ignore deeplinks, so
they, CLI-only installs and other platforms run `opencode <dir> --prompt=…` in
Terminal (submitted), using the CLI bundled in the app when `opencode` isn't on
`PATH`. A desktop app connected to a remote server ignores the link; use
`launch: 'terminal'` then.

| Option | Default | What it does |
| --- | --- | --- |
| `launch` | `'auto'` | `'app'` always sends the deeplink (1.x on Windows / Linux); `'terminal'` always uses the CLI. |
| `appPath` | `/Applications/OpenCode.app`, then `~/Applications/…` | Bundle whose version is read. |
| `command` | `opencode`, `~/.opencode/bin/opencode`, then the app's CLI | CLI for the Terminal route. |
| `promptUrlLimit` | `8000` | App route: longer links switch to a file pointer. |
| `projectRoot` / `pathStyle` / `artifactPathStyle` / `promptArgLimit` | | See above. |

#### `agents.devinCli`

Runs `devin -- "<prompt>"`, which submits the prompt as the first message. Long
prompts, and prompts that start with `-`, go through `devin --prompt-file`.

| Option | Default | What it does |
| --- | --- | --- |
| `command` | `devin`, then the CLI inside Devin Desktop | CLI path. |
| `permissionMode` | — | `--permission-mode` (`normal`, `accept-edits`, `smart`, `dangerous`, …). |
| `model` | — | `--model`. |
| `cloud` | — | `true` adds `--cloud`. |
| `sessions` | on | `devin list` sessions for this project. `false` removes it; `{ limit, lookbackDays, home }` tunes it. |
| `projectRoot` / `pathStyle` / `artifactPathStyle` / `promptArgLimit` | | See above. |

#### `agents.antigravityIde`

Opt-in. Opens the project with `antigravity-ide <projectRoot>` and places the
prompt in the agent input without sending it.

| Option | Default | What it does |
| --- | --- | --- |
| `command` | `antigravity-ide`, then the macOS app's CLI | CLI path. |
| `reuseWindow` / `newWindow` | `false` | `--reuse-window` / `--new-window` (`newWindow` wins). |
| `addFiles` | `true` | Mention referenced files that are inside the project root. |
| `experimentalSessions` | `false` | `true` lists IDE conversations and sends straight into the picked one. Off by default because it reads the language server's CSRF token from the IDE process. |
| `projectRoot` / `promptArgLimit` | | See above. `mode`, `maximize` and `profile` are accepted but have no effect. |

#### `agents.antigravity`

Opt-in. Opens the **Antigravity** desktop app and writes the prompt into its
composer. Falls back to the `agy` CLI only when the desktop app isn't installed.

| Option | Default | What it does |
| --- | --- | --- |
| `command` | `agy`, then `~/.local/bin/agy` (Windows: `%LOCALAPPDATA%\agy\bin\agy.exe`) | CLI path. |
| `mode` | — | `agy --mode` (`plan`, `accept-edits`). |
| `projectRoot` / `pathStyle` / `artifactPathStyle` / `promptArgLimit` | | See above. |

#### `agents.devinIde` and `agents.windsurfIde`

Opt-in. Opens the project with `devin-desktop` / `windsurf`, then delivers the
prompt into the Cascade composer through a small bridge extension installed on
first send (under `~/.devin/extensions` / `~/.windsurf/extensions`).

| Option | Default | What it does |
| --- | --- | --- |
| `command` | `devin-desktop` / `windsurf`, then the macOS app's CLI | CLI path. |
| `submit` | `false` | `false` leaves the prompt in the composer; `true` starts a new conversation with it. Older Windsurf builds may not support `true`. |
| `reuseWindow` / `newWindow` | `false` | `--reuse-window` / `--new-window` (`newWindow` wins). |
| `projectRoot` | project root | Folder the IDE opens. |

### `agents.custom`

The built-in agents **open an app**. A custom client does the opposite: it hands
the prompt to an app that's **already running**, so the text lands in that app's
own input box. Use it when your desktop client previews the dev server in a
webview or iframe.

```js
ideByebye({
  agents: {
    custom: [
      // postMessage (default): the previewed page posts to the window embedding it.
      { name: 'my-client', label: 'My Client', targetOrigin: 'http://localhost:1420' },
      // http: the dev server POSTs the payload to your client instead.
      // { name: 'my-client', label: 'My Client', url: 'http://127.0.0.1:8787/api/prompt' },
    ],
  },
  defaultAgent: 'my-client',
});
```

```js
// In your client
window.addEventListener('message', (event) => {
  if (event.origin !== previewOrigin) return;
  const data = event.data;
  if (data?.source !== 'ide-byebye' || data.type !== 'ide-byebye:prompt') return;
  setComposerText(data.prompt);
});
```

| Option | Default | What it does |
| --- | --- | --- |
| `name` | — | **Required.** Adapter id, `[a-z0-9._-]` only. Entries without a usable name, or that shadow a built-in id, are dropped. |
| `label` / `title` | `name` / generic copy | Button text and tooltip. |
| `enabled` | `true` | `false` skips it. |
| `transport` | `'http'` when `url` is set, else `'postMessage'` | How the prompt reaches the client. |
| `pathStyle` / `artifactPathStyle` | top-level values | Path styles for this client. |
| `messageType` | `'ide-byebye:prompt'` | postMessage: payload `type`. |
| `windowTarget` | `'parent'` | postMessage: `'parent'`, `'top'` or `'opener'`. A page with no target window says so instead of dropping the prompt. |
| `targetOrigin` | `'*'` | postMessage: set it to your client's origin. |
| `url` | — | http: **required**, absolute endpoint. Missing or invalid greys the button out. |
| `method` / `headers` / `timeoutMs` | `'POST'` / `{}` / `8000` | http: request settings. A non-2xx response fails the send and shows your endpoint's reply. |

The http request comes from Node, not the browser, so a loopback endpoint needs no
CORS. Both transports deliver the same payload:

```jsonc
{
  "type": "ide-byebye:prompt",
  "source": "ide-byebye",
  "version": 1,
  "agent": "my-client",
  "requestId": "…",
  "createdAt": "2026-05-24T01:30:00.000Z",
  "prompt": "@src/App.tsx #10-20\n\nMake this the primary button\n", // ready to insert
  "intent": "Make this the primary button",
  "applyMode": "prompt-only",
  "projectRoot": "/repo",
  "pageUrl": "http://localhost:5173/settings",
  "selection": { "file": "/repo/src/App.tsx", "line": 12, "column": 3 },
  "files": ["/repo/src/App.tsx"],
  "screenshots": ["/repo/.intent-inspector/screenshots/a.webp"],
  "recordings": ["/repo/.intent-inspector/screenshots/b.webp"]
}
```

### Windows

Pick with **Ctrl-click**. Agents already open links with `cmd /c start "" <url>`,
so no `openCommand` is needed when the apps' URL protocols work. OpenCode uses its
CLI on Windows unless you set `agents.opencode.launch: 'app'`, and a
`claude-cli://` link too long for `cmd` (about 8000 characters) goes through
Terminal instead.

Set `openCommand` / `openArgs` only when the default fails. A non-blank
`openCommand` **replaces** the default, so pass the full argv. Don't use
`'start'` (a `cmd` builtin) or `'xdg-open'` (Linux only). In WSL, use `wslview`
or `explorer.exe`.

```js
const windowsOpener = { openCommand: 'cmd', openArgs: ['/c', 'start', '""'] };

ideByebye({ agents: { cursorApp: windowsOpener, claudeApp: windowsOpener } });
```

## Send to an existing session

Codex App, Grok Build, Devin CLI and (behind a flag) Antigravity IDE can take the
next prompt in a session you already have. In the destination picker next to
Send, these agents show `›`, which lists this project's sessions. Pick one and
Enter goes there; **New session** goes back to a fresh one. The choice is
remembered per agent.

| Agent | Delivery |
| --- | --- |
| Codex App | Opens the thread with the prompt prefilled; you press Enter in Codex. |
| Grok Build | A new terminal runs `grok --resume <id>` and submits. A session open in another terminal can't be targeted. |
| Devin CLI | A new terminal runs `devin -r <id>` and submits. |
| Antigravity IDE | Submits straight into the conversation. Only with `experimentalSessions: true`. |

Only sessions in this project's directory, a child, or a nearby ancestor are
listed (never your home directory or above). The page gets one-line titles only:
no absolute paths, transcripts or tokens. `sessions: false` removes an agent's
list.

## Recording

Records **element behavior** with [rrweb](https://github.com/rrweb-io/rrweb):
pick a scope, record, interact, stop, trim. A still frame cropped to the scope
goes into the prompt; the raw events are saved for replay only. Off by default
and lazy-loaded.

```sh
npm i -D @rrweb/record @rrweb/replay
```

```js
ideByebye({
  recording: {
    maxDurationMs: 30000,     // rolling buffer, capped at 300000 (5 min)
    mask: {
      allInputs: false,       // true masks input values
      blockClass: 'rr-block', // elements with this class aren't recorded
    },
  },
});
```

`recording: true` uses these defaults; `{ enabled: false }` hides the Record
button. Still frames and screenshots share one rasterizer: cross-origin assets
without CORS may come out blank, web fonts must be loadable, and `canvas` /
WebGL isn't captured.

## Output files

Everything goes under `outputDir` (default `.intent-inspector/`). It's per-machine,
regenerated on every send, can be large, and may contain form values or intent
text. Keep it out of git:

```gitignore
.intent-inspector/
```

| Path | Contents |
| --- | --- |
| `requests/` | Full request + prompt as Markdown (`file` agent, `promptMode: 'file'`, or an over-long prompt). |
| `launches/` | Terminal launcher scripts and prompt text for CLI and IDE agents. |
| `screenshots/` | Screenshots referenced by the prompt. |
| `recordings/` | rrweb event streams and still frames. |
| `next/bootstrap.js` | Generated client bootstrap for `next dev`. |

Prompt order: `@code` references, then rendered styles (if attached), then your
intent.

## Framework notes

- **Next.js**: only the `next dev` process is touched; `next build` and
  `next start` get your config back unchanged, and your own `turbopack.rules` /
  `webpack()` are kept. Pass ide-byebye options as the second argument:
  `withIdeByebye(nextConfig, { defaultAgent: 'codex-app' })`. Verified on Next
  14.2, 15.2 and 16.3.
- **Angular**: templates can't carry `data-insp-path`, so the picker reads
  Angular's dev-mode component info and the server matches the element in that
  component's template with your `@angular/compiler`. Exact for typical
  templates; heavily dynamic ones fall back to the whole template. If
  `development` already has `scripts`, append the bootstrap to that list. Spread
  `angularProxy()` next to your own proxy entries if you have any.
- **Nuxt 4**: paths are relative to Vite's root (`app/`), e.g. `app/app.vue #9-13`.
- **Vue**: Pug templates are stamped with your project's `pug`; the prompt then
  uses a line window instead of an exact range.
- **Not stamped**: `.astro` and `.mdx` files.
- **Turbopack rules only**: `ide-byebye/turbopack` in `turbopack.rules` still
  works; switch to `ide-byebye/next` to also cover `--webpack`.
- **Without npm**: `npm run build` writes `dist/ide-byebye.js`, a
  single-file Vite plugin with the browser runtime embedded.
