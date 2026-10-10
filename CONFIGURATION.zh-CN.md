# 配置

[English](./CONFIGURATION.md) | [中文](./CONFIGURATION.zh-CN.md)

`ideByebye(options)`：所有选项都可省略，非法值会回退到默认值，不会抛错。同一个配置对象
适用于所有入口（`ide-byebye/vite`、`/webpack`、`/next`、`angularProxy(options)` 等），包里
自带类型定义。

- [顶层选项](#顶层选项)
- [Agent](#agent)
  - [共用选项](#共用选项)
  - [各 Agent 选项](#各-agent-选项)
  - [`agents.custom`](#agentscustom)
  - [Windows](#windows)
- [发送到已有会话](#发送到已有会话)
- [录制](#录制)
- [输出文件](#输出文件)
- [框架说明](#框架说明)

## 顶层选项

| 选项 | 类型 | 默认 | 作用 |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | `false` 完全关闭：不启服务、不注入。 |
| `defaultAgent` | `string` | `'claude-app'` | Enter 目标：`'codex-app'`、`'claude-app'`、`'cursor-app'`、`'grok-build'`、`'claude-cli'`、`'opencode'`、`'devin-cli'`、`'antigravity-ide'`、`'antigravity'`、`'devin-ide'`、`'windsurf-ide'`，或 [`agents.custom`](#agentscustom) 里的名字。未知或已禁用的值、`'clipboard'`、`'file'` 都回退到第一个已启用的页脚 Agent。在弹窗里换过 Agent 后，Enter 沿用那次的选择（记在当前浏览器里）。 |
| `theme` | `'light' \| 'auto' \| 'dark'` | `'light'` | 弹窗主题。`'auto'` 跟随系统。未设置时，页面会在控制台打印一条提示，说明这个选项。 |
| `locale` | `'zh' \| 'en'` | 自动 | 界面语言：本选项 → `navigator.language` → `zh`。以 `zh` 开头即中文。prompt 永远不做本地化。 |
| `hotkey` | `string` | `'Alt+Shift+I'` | 切换选取器。用 `+` 连接，大小写不敏感。修饰键：`alt`/`option`、`shift`、`ctrl`/`control`、`meta`/`cmd`/`command`；最后一段是主键。 |
| `clickModifier` | `string \| null \| false` | `'auto'` | 按住选取的键：macOS 是 ⌘，其他平台是 Ctrl。可用 `'meta'` / `'ctrl'` / `'alt'` / `'shift'` 强制指定；`null` / `false` 关闭点击选取（快捷键仍可用）。 |
| `applyMode` | `'prompt-only' \| 'agent-edit'` | `'prompt-only'` | 写进交接里的提示：只出方案，还是允许改文件。 |
| `outputDir` | `string` | `'.intent-inspector'` | 交接文件和媒体的目录，必须在项目根内。请加入 gitignore。 |
| `maxSourceContextLines` | `number` | `60` | 元素周围写进 prompt 的源码行数。 |
| `maxDomSnippetLength` | `number` | `1000` | 捕获的 DOM 片段最大字符数。 |
| `apiOrigin` | `string \| null` | 自动 | 页面连不上默认 loopback 服务时，指定 inspector 服务的绝对 `http(s)` origin（无尾斜杠）。 |
| `pathStyle` | `'relative' \| 'absolute'` | `'relative'` | 纯 `@` prompt（剪贴板、文件、CLI 类 Agent）里的源码路径。 |
| `artifactPathStyle` | `'relative' \| 'absolute'` | `'absolute'` | `@` prompt 里截图和静帧的路径。用绝对路径，Agent 不管 cwd 在哪都能打开。 |
| `recording` | `boolean \| object` | 关闭 | 见 [录制](#录制)。 |
| `agents` | `object` | `{}` | 见 [Agent](#agent)。未知 key 会被忽略。 |
| `sourceStamp` | `false \| { include?, exclude?, escapeTags? }` | 开启 | 内置的 `data-insp-path` 打点。`false` 关闭。`include` 让匹配的路径即使在 `node_modules` 下也打点；`exclude` 跳过路径；`escapeTags` 追加不打点的标签。 |
| `codeInspector` | `object` | — | 0.6.0 弃用，0.7.0 删除。只映射 `include`、`exclude`、`escapeTags` 和 `close: true`（等同 `sourceStamp: false`）。 |
| `htmlFiles` | `string[]` | `outdir` 下的 `*.html` | **仅 esbuild。** HTML 不输出到 `outdir` 时，指定要注入的 HTML 文件。 |
| `root` | `string` | 见说明 | **仅 Next.js / Angular。** 项目目录不是 `next.config.*` 所在目录（Next.js）或 `ng serve` 的 cwd（Angular）时指定。 |

monorepo 里，与其设 `pathStyle: 'absolute'`，不如把 Agent 的 `projectRoot` 指到仓库根：
引用会变成 `@apps/web/src/…`，更短，也能正确解析。

## Agent

内置 13 个 Agent，其中 9 个默认开启。`agents.<key>: false`（或 `{ enabled: false }`）关闭；
传对象则保持开启并覆盖选项。4 个可选 Agent 不设置对应 key 就不会出现。

| Key | Id | 默认 | 作用 |
| --- | --- | --- | --- |
| `claudeApp` | `claude-app` | 开启 | 打开并预填 **Claude App**；可附带文件和文件夹。 |
| `codexApp` | `codex-app` | 开启 | 打开并预填 **Codex App**。 |
| `cursorApp` | `cursor-app` | 开启 | 打开并预填 **Cursor**，按 workspace 名路由。 |
| `grokBuild` | `grok-build` | 开启 | 在 Terminal 运行 **Grok Build** 并带上 prompt。 |
| `claudeCli` | `claude-cli` | 开启 | 打开 **Claude Code CLI**：经 `claude-cli://` 预填，或在 Terminal 运行并直接提交。 |
| `opencode` | `opencode` | 开启 | 打开 **OpenCode**：1.x 桌面版里预填，或在 Terminal 运行 CLI 并直接提交。 |
| `devinCli` | `devin-cli` | 开启 | 在 Terminal 运行 **Devin**，prompt 作为第一条消息。 |
| `clipboard` | `clipboard` | 开启 | **复制 Prompt** 按钮。永远不是 Enter 目标。 |
| `file` | `file` | 开启 | 把请求写成 Markdown 放到 `outputDir/requests/`。没有按钮，用 `promptMode: 'file'` 触发。 |
| `antigravityIde` | `antigravity-ide` | 需开启 | 用 **Antigravity IDE** 打开项目，prompt 放进 agent 输入框。 |
| `antigravity` | `antigravity` | 需开启 | 打开 **Antigravity** 桌面应用，prompt 放进输入框。 |
| `devinIde` | `devin-ide` | 需开启 | 打开 **Devin Desktop**，prompt 放进 Cascade 输入框。 |
| `windsurfIde` | `windsurf-ide` | 需开启 | 打开 **Windsurf**，prompt 放进 Cascade 输入框。 |

```js
agents: {
  codexApp: false,
  cursorApp: { workspace: 'my-app' },
  grokBuild: {
    permissionMode: 'plan',
    projectRoot: path.resolve(__dirname, '../..'), // monorepo 根 → @apps/web/src/…
  },
  claudeCli: { permissionMode: 'plan' },
  antigravity: { mode: 'plan' },
  windsurfIde: { submit: true },
}
```

找不到 CLI 时对应按钮置灰，tooltip 会写明要装什么。Deeplink 类 Agent（Claude、Codex、
Cursor）始终可点，没装 App 时由系统报错。

### 共用选项

所有页脚 Agent 都接受这些选项。IDE 类 Agent（Antigravity IDE、Devin Desktop、Windsurf）
忽略 `openCommand` / `openArgs`，由它们自己的 CLI 启动应用。

| 选项 | 类型 | 默认 | 作用 |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | `false` 取消注册。 |
| `openCommand` | `string` | `open` / `cmd` / `xdg-open` | 打开 deeplink 或 launcher 的可执行文件。见 [Windows](#windows)。 |
| `openArgs` | `string[]` | 平台前缀 | 放在 URL 或 launcher 路径之前的参数。 |
| `promptMode` | `'auto' \| 'file'` | `'auto'` | `'file'` 把完整交接写进 `requests/`，只发一条指向它的短 prompt。`'auto'` 下，有长度限制的 Agent 在 prompt 过长时会自动改用文件。 |

### 各 Agent 选项

`projectRoot` 默认都是打包器的项目根，相对 `@` 引用以它为基准。各 Agent 的 `pathStyle` /
`artifactPathStyle` 只覆盖该 Agent 的 prompt。`promptArgLimit`（默认 `12000`）是 Terminal
类 Agent 改用文件指针的长度阈值。

#### `agents.claudeApp`

| 选项 | 默认 | 作用 |
| --- | --- | --- |
| `folders` | `[]` | 与项目根一起打开的额外文件夹（相对进程 cwd 解析）。 |
| `attachFiles` | `true` | 附带引用的源文件和截图。 |
| `attachScreenshots` | `true` | 附带截图。`attachFiles` 为 `false` 时忽略。 |
| `scheme` / `route` | `'claude'` / `'code'` | Deeplink `claude://<route>/new`。 |

#### `agents.codexApp`

| 选项 | 默认 | 作用 |
| --- | --- | --- |
| `projectRoot` | 项目根 | deeplink 打开的文件夹。 |
| `sessions` | 开启 | 已有线程列表。`false` 去掉；`{ limit（1–50，默认 20）, lookbackDays（默认 30）, home（$CODEX_HOME 或 ~/.codex） }` 可调。 |
| `scheme` | `'codex'` | Deeplink scheme。 |

#### `agents.cursorApp`

| 选项 | 默认 | 作用 |
| --- | --- | --- |
| `workspace` | git 根目录名 | Cursor 路由用的 workspace **名**（不是路径）。Cursor 窗口标题不一样时设置；`false` 省略。 |
| `projectRoot` | — | 用这个目录的名字作为 `workspace`。 |
| `mode` | — | Cursor 的 `mode` deeplink 参数。 |
| `promptUrlLimit` | `10000` | 编码后超过这个长度改用文件指针。 |
| `scheme` / `authority` / `route` | `'cursor'` / `'anysphere.cursor-deeplink'` / `'prompt'` | 仅自定义 Cursor 构建时修改。 |

#### `agents.grokBuild`

| 选项 | 默认 | 作用 |
| --- | --- | --- |
| `command` | `grok`，其次 `~/.grok/bin/grok` | CLI 路径。Node 的 `PATH` 与 shell 不一致时给绝对路径。 |
| `projectRoot` | 项目根 | `grok --cwd`。 |
| `permissionMode` | — | `--permission-mode`（`plan`、`acceptEdits` 等）。 |
| `sessions` | 开启 | 已有会话列表；只能恢复已关闭的会话。`false` 去掉；`{ limit, home }` 可调。 |
| `pathStyle` / `artifactPathStyle` / `promptArgLimit` | | 见上文。 |

#### `agents.claudeCli`

`launch: 'auto'` 下，handler 已注册且 prompt 不超过 5000 字符时，在你最近用过的终端里打开
`claude-cli://`，prompt 只预填；否则在 Terminal 运行 `claude -- "<prompt>"`，直接提交。
handler 由 CLI 自己注册：第一次在交互式 `claude` 会话里使用时完成。Linux 和 Windows 上
无法识别残留的失效 handler，链接点了没反应时请设 `launch: 'terminal'`。

| 选项 | 默认 | 作用 |
| --- | --- | --- |
| `launch` | `'auto'` | `'deeplink'` 或 `'terminal'` 固定路线。 |
| `command` | `claude`、`~/.local/bin/claude`、`~/.claude/local/claude`，最后是 handler 指向的 CLI | Terminal 路线用的 CLI。 |
| `permissionMode` | — | 只对 Terminal 路线生效。 |
| `projectRoot` / `pathStyle` / `artifactPathStyle` / `promptArgLimit` | | 见上文。 |

#### `agents.opencode`

`launch: 'auto'` 会读取 macOS 桌面版的版本号。OpenCode 1.x 收到 `opencode://` 链接，prompt
只预填。2.x 桌面版会丢弃 deeplink，所以 2.x、只装了 CLI 的环境以及其他平台，都在 Terminal
运行 `opencode <dir> --prompt=…` 并直接提交；PATH 上没有 `opencode` 时用 App 自带的 CLI。
桌面版连着远程 server 时会忽略链接，此时请设 `launch: 'terminal'`。

| 选项 | 默认 | 作用 |
| --- | --- | --- |
| `launch` | `'auto'` | `'app'` 总是发 deeplink（Windows / Linux 上的 1.x）；`'terminal'` 总是用 CLI。 |
| `appPath` | `/Applications/OpenCode.app`，其次 `~/Applications/…` | 读取版本号的 bundle。 |
| `command` | `opencode`、`~/.opencode/bin/opencode`，最后是 App 自带的 CLI | Terminal 路线用的 CLI。 |
| `promptUrlLimit` | `8000` | App 路线：链接超过这个长度改用文件指针。 |
| `projectRoot` / `pathStyle` / `artifactPathStyle` / `promptArgLimit` | | 见上文。 |

#### `agents.devinCli`

运行 `devin -- "<prompt>"`，prompt 作为第一条消息直接提交。过长的 prompt，以及以 `-` 开头的
prompt，改走 `devin --prompt-file`。

| 选项 | 默认 | 作用 |
| --- | --- | --- |
| `command` | `devin`，其次 Devin Desktop 里自带的 CLI | CLI 路径。 |
| `permissionMode` | — | `--permission-mode`（`normal`、`accept-edits`、`smart`、`dangerous` 等）。 |
| `model` | — | `--model`。 |
| `cloud` | — | `true` 时加 `--cloud`。 |
| `sessions` | 开启 | 本项目的 `devin list` 会话。`false` 去掉；`{ limit, lookbackDays, home }` 可调。 |
| `projectRoot` / `pathStyle` / `artifactPathStyle` / `promptArgLimit` | | 见上文。 |

#### `agents.antigravityIde`

需开启。用 `antigravity-ide <projectRoot>` 打开项目，把 prompt 放进 agent 输入框，不自动发送。

| 选项 | 默认 | 作用 |
| --- | --- | --- |
| `command` | `antigravity-ide`，其次 macOS App 里的 CLI | CLI 路径。 |
| `reuseWindow` / `newWindow` | `false` | `--reuse-window` / `--new-window`（`newWindow` 优先）。 |
| `addFiles` | `true` | 一并提及项目根内的引用文件。 |
| `experimentalSessions` | `false` | `true` 时列出 IDE 里的会话，并直接发进选中的那个。默认关闭，因为要从 IDE 进程读取 language server 的 CSRF token。 |
| `projectRoot` / `promptArgLimit` | | 见上文。`mode`、`maximize`、`profile` 仍接受，但不起作用。 |

#### `agents.antigravity`

需开启。打开 **Antigravity** 桌面应用，把 prompt 写进输入框。只有没装桌面应用时才改用
`agy` CLI。

| 选项 | 默认 | 作用 |
| --- | --- | --- |
| `command` | `agy`，其次 `~/.local/bin/agy`（Windows：`%LOCALAPPDATA%\agy\bin\agy.exe`） | CLI 路径。 |
| `mode` | — | `agy --mode`（`plan`、`accept-edits`）。 |
| `projectRoot` / `pathStyle` / `artifactPathStyle` / `promptArgLimit` | | 见上文。 |

#### `agents.devinIde` 与 `agents.windsurfIde`

需开启。用 `devin-desktop` / `windsurf` 打开项目，再通过第一次发送时安装的小型桥接扩展
（位于 `~/.devin/extensions` / `~/.windsurf/extensions`）把 prompt 放进 Cascade 输入框。

| 选项 | 默认 | 作用 |
| --- | --- | --- |
| `command` | `devin-desktop` / `windsurf`，其次 macOS App 里的 CLI | CLI 路径。 |
| `submit` | `false` | `false` 只把 prompt 放进输入框；`true` 用它开一个新对话。较老的 Windsurf 可能不支持 `true`。 |
| `reuseWindow` / `newWindow` | `false` | `--reuse-window` / `--new-window`（`newWindow` 优先）。 |
| `projectRoot` | 项目根 | IDE 打开的文件夹。 |

### `agents.custom`

内置 Agent 都是**打开一个 app**。自定义客户端反过来：把 prompt 交给**已经在运行**的 app，
落到它自己的输入框里。适合用 webview 或 iframe 预览 dev server 的桌面客户端。

```js
ideByebye({
  agents: {
    custom: [
      // postMessage（默认）：被预览的页面 post 给嵌入它的窗口。
      { name: 'my-client', label: 'My Client', targetOrigin: 'http://localhost:1420' },
      // http：改由 dev server 把 payload POST 给你的客户端。
      // { name: 'my-client', label: 'My Client', url: 'http://127.0.0.1:8787/api/prompt' },
    ],
  },
  defaultAgent: 'my-client',
});
```

```js
// 客户端侧
window.addEventListener('message', (event) => {
  if (event.origin !== previewOrigin) return;
  const data = event.data;
  if (data?.source !== 'ide-byebye' || data.type !== 'ide-byebye:prompt') return;
  setComposerText(data.prompt);
});
```

| 选项 | 默认 | 作用 |
| --- | --- | --- |
| `name` | — | **必填。** Adapter id，只允许 `[a-z0-9._-]`。没有可用名字、或与内置 id 重名的条目会被丢弃。 |
| `label` / `title` | `name` / 通用文案 | 按钮文字和 tooltip。 |
| `enabled` | `true` | `false` 跳过。 |
| `transport` | 设了 `url` 为 `'http'`，否则 `'postMessage'` | prompt 送达客户端的方式。 |
| `pathStyle` / `artifactPathStyle` | 顶层值 | 这个客户端的路径风格。 |
| `messageType` | `'ide-byebye:prompt'` | postMessage：payload 的 `type`。 |
| `windowTarget` | `'parent'` | postMessage：`'parent'`、`'top'` 或 `'opener'`。页面没有目标窗口时会提示，不会悄悄丢掉 prompt。 |
| `targetOrigin` | `'*'` | postMessage：请设成你客户端的 origin。 |
| `url` | — | http：**必填**，绝对地址。缺失或非法时按钮置灰。 |
| `method` / `headers` / `timeoutMs` | `'POST'` / `{}` / `8000` | http：请求设置。非 2xx 响应会让发送失败，并显示你接口的返回内容。 |

http 请求由 Node 发出，不经过浏览器，所以 loopback 接口不用处理 CORS。两种方式送达的
payload 相同：

```jsonc
{
  "type": "ide-byebye:prompt",
  "source": "ide-byebye",
  "version": 1,
  "agent": "my-client",
  "requestId": "…",
  "createdAt": "2026-05-24T01:30:00.000Z",
  "prompt": "@src/App.tsx #10-20\n\nMake this the primary button\n", // 可直接填入
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

用 **Ctrl-点击** 选取。Agent 默认已用 `cmd /c start "" <url>` 打开链接，只要各 App 的 URL
协议能唤起，就不需要设 `openCommand`。Windows 上 OpenCode 默认走 CLI，除非设
`agents.opencode.launch: 'app'`；`claude-cli://` 链接超过 `cmd` 能承载的长度（约 8000 字符）
时改走 Terminal。

只有默认方式失败时才设 `openCommand` / `openArgs`。非空的 `openCommand` 会**整个替换**默认值，
所以要传完整参数。不要写 `'start'`（`cmd` 内置命令）或 `'xdg-open'`（仅 Linux）。WSL 里用
`wslview` 或 `explorer.exe`。

```js
const windowsOpener = { openCommand: 'cmd', openArgs: ['/c', 'start', '""'] };

ideByebye({ agents: { cursorApp: windowsOpener, claudeApp: windowsOpener } });
```

## 发送到已有会话

Codex App、Grok Build、Devin CLI，以及（需开关）Antigravity IDE，可以把下一条 prompt 发进
已有的会话。在发送按钮旁的目标选择器里，这些 Agent 会显示 `›`，点开列出本项目的会话。
选中后 Enter 就发到那里；「新会话」则回到新开。选择按 Agent 分别记住。

| Agent | 投递方式 |
| --- | --- |
| Codex App | 打开该线程并预填 prompt，你在 Codex 里回车。 |
| Grok Build | 新终端运行 `grok --resume <id>` 并直接提交。已在别的终端开着的会话不能作为目标。 |
| Devin CLI | 新终端运行 `devin -r <id>` 并直接提交。 |
| Antigravity IDE | 直接提交进该会话。仅在 `experimentalSessions: true` 时可用。 |

只列出本项目目录、子目录或附近祖先目录里的会话（home 目录及以上永远不算）。页面只拿到单行
标题：没有绝对路径、会话正文或 token。`sessions: false` 去掉该 Agent 的列表。

## 录制

用 [rrweb](https://github.com/rrweb-io/rrweb) 录制**元素行为**：选范围 → 录制 → 交互 → 停止 →
裁剪。裁到范围的静帧会进 prompt；原始事件流只存下来供回放。默认关闭，开启后懒加载。

```sh
npm i -D @rrweb/record @rrweb/replay
```

```js
ideByebye({
  recording: {
    maxDurationMs: 30000,     // 滚动缓冲，上限 300000（5 分钟）
    mask: {
      allInputs: false,       // true 时遮罩输入值
      blockClass: 'rr-block', // 带这个 class 的元素不录
    },
  },
});
```

`recording: true` 使用上面的默认值；`{ enabled: false }` 隐藏录制按钮。静帧和截图共用同一套
栅格化：没有 CORS 的跨域资源可能是空白，web 字体必须能加载，`canvas` / WebGL 不会被捕获。

## 输出文件

所有文件都写在 `outputDir`（默认 `.intent-inspector/`）下。这些内容和本机绑定、每次发送都会
重新生成、体积可能不小，还可能包含表单值或你写的意图。不要提交到 git：

```gitignore
.intent-inspector/
```

| 路径 | 内容 |
| --- | --- |
| `requests/` | Markdown 格式的完整请求 + prompt（`file` Agent、`promptMode: 'file'`，或 prompt 过长时）。 |
| `launches/` | CLI 和 IDE 类 Agent 的 Terminal launcher 脚本与 prompt 文本。 |
| `screenshots/` | prompt 引用的截图。 |
| `recordings/` | rrweb 事件流和静帧。 |
| `next/bootstrap.js` | 为 `next dev` 生成的客户端 bootstrap。 |

prompt 顺序：`@code` 引用 → 渲染样式（如有）→ 你的意图。

## 框架说明

- **Next.js**：只作用于 `next dev` 进程；`next build` 和 `next start` 拿回的是原样的配置，
  你自己的 `turbopack.rules` / `webpack()` 都会保留。ide-byebye 的选项作为第二个参数传入：
  `withIdeByebye(nextConfig, { defaultAgent: 'codex-app' })`。已在 Next 14.2、15.2、16.3 上验证。
- **Angular**：模板里加不了 `data-insp-path`，所以选取器读取 Angular 开发模式的组件信息，
  服务端再用你项目里的 `@angular/compiler` 在该组件模板中匹配元素。常规模板是精确的；极度
  动态的模板会退回到整个模板。`development` 已有 `scripts` 时，把 bootstrap 追加进去。已有
  代理配置时，把 `angularProxy()` 和你的条目展开合并。
- **Nuxt 4**：路径相对 Vite 的 root（`app/`），形如 `app/app.vue #9-13`。
- **Vue**：pug 模板用你项目里的 `pug` 打点；prompt 里用行窗口，而不是精确范围。
- **不打点**：`.astro` 和 `.mdx` 文件。
- **只用 Turbopack rules**：`turbopack.rules` 里的 `ide-byebye/turbopack` 仍可用；换成
  `ide-byebye/next` 可以同时覆盖 `--webpack`。
- **不经 npm**：`npm run build` 会生成 `dist/code-intent-inspector.js`，一个内嵌浏览器运行时的
  单文件 Vite 插件。
