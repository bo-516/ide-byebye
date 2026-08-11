# ide-byebye

[English](./README.md) | [中文](./README.zh-CN.md)

> ⌘-点击任意渲染节点，用自然语言描述改动，把 **源码位置 + 意图** 交给
> **Codex App / Claude App / Cursor / Grok Build** —— 不用在 IDE 里翻文件。

仅用于开发环境的多打包器插件（Vite / webpack / rspack / rsbuild / esbuild /
Farm；Turbopack & Mako 仅做路径注入）。在运行中的应用上叠加可感知源码的选取器，
拼出结构化 prompt（`file:line`、周围源码、意图，以及可选截图 / 样式 / 录制），
再通过 deeplink 或 Terminal 打开所选 Agent。

它是胶水，不是模型：不改文件、不内置 AI SDK。真正动手的是你交接出去的 Agent。

---

![⌘-点击元素、描述改动、交给 Agent](./demo-recording.gif)

**录屏演示**（Vue demo → Agent）：

1. **选取** — 按住 ⌘ 点击渲染节点；浮层把 `data-insp-path` 解析到源码
   （录屏中为 `src/App.vue #99-129`）。
2. **描述** — 在弹窗里用自然语言写意图（可选 `@code`、截图、样式或录制）。
3. **交接** — 选择 **Codex App / Claude App / Cursor / Grok Build**；
   loopback 服务拼好结构化 prompt，打开 Agent 时已带上 `file:line` + 意图。

---

## 目录

- [工作原理](#工作原理)
- [安装](#安装)
- [快速开始](#快速开始)
- [演示](#演示)
- [环境要求](#环境要求)
- [意图弹窗](#意图弹窗)
- [配置参考](#配置参考)
  - [最小配置](#最小配置)
  - [可选配置项（逐项）](#可选配置项逐项)
  - [Agents](#agents)
  - [录制（rrweb）](#录制-rrweb)
- [产物](#产物)
- [本地化](#本地化)
- [安全与隐私](#安全与隐私)
- [从源码构建](#从源码构建)
- [许可证](#许可证)

---

## 工作原理

1. **选取** — 快捷键（默认 `Alt+Shift+I`）或按住 `clickModifier`（⌘ / Ctrl）再点击。
   源码来自 [`code-inspector-plugin`](https://github.com/zh-lx/code-inspector)
   注入的 `data-insp-path`。
2. **描述** — 在元素上打开意图弹窗。可附加 `@code` 引用、截图、计算样式或交互录制。
3. **交接** — 点击 **Codex App / Claude App / Cursor / Grok Build**。本地 loopback
   服务（`127.0.0.1`、按进程 token）拼好 prompt，再打开 Agent（deeplink 或 Terminal）。

除你主动触发的 deeplink 外，数据不会离开本机。打包器适配器只向 HTML 注入 bootstrap。

## 安装

```sh
npm i -D ide-byebye code-inspector-plugin
```

`code-inspector-plugin` 是依赖（也单独列出方便你锁定版本）。没有它，元素没有源码映射，
选取器会显示 *"no source mapping"*。

可选 — 元素行为录制（默认开启，懒加载）：

```sh
npm i -D @rrweb/record @rrweb/replay
```

不需要时设 `recording: false` 即可关闭。

## 快速开始

### Vite（默认导出）

```js
// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react'; // 或 @vitejs/plugin-vue
import ideByebye from 'ide-byebye';       // 等同于 'ide-byebye/vite'

export default defineConfig({
  plugins: [
    // 零配置：注册 code-inspector、⌘/Ctrl-点击选取、
    // 全部页脚 Agent + 剪贴板/文件、录制开启、Enter → Claude App。
    ideByebye(),
    react(),
  ],
});
```

### 其他打包器

按子路径导入匹配适配器 — **不要**自己传 `bundler` 字符串：

| 打包器 | 导入 | 说明 |
| --- | --- | --- |
| **Vite** | `ide-byebye` / `ide-byebye/vite` | 完整零配置（默认）。 |
| **webpack** | `ide-byebye/webpack` | 注入到 HtmlWebpackPlugin 输出。 |
| **rspack** | `ide-byebye/rspack` | 与 webpack 同形。 |
| **rsbuild** | `ide-byebye/rsbuild` | `plugins: [inspector()]`。 |
| **esbuild** | `ide-byebye/esbuild` | 若 HTML 不在 `outdir`，传 `htmlFiles: ['./index.html']`。 |
| **Farm** | `ide-byebye/farm` | 返回 `[codeInspector, inspector]` — 展开进 Farm plugins。 |
| **Turbopack**（Next） | `ide-byebye/turbopack` | 仅 rules（`data-insp-path`）；需自行挂载 bootstrap。 |
| **Mako**（Umi） | `ide-byebye/mako` | 同 Turbopack — 仅路径注入。 |

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
  plugins: inspector({ htmlFiles: ['./index.html'] }),
});
```

只覆盖你需要的项：

```js
ideByebye({
  defaultAgent: 'codex-app', // Enter → 四个页脚 Agent 之一
  agents: {
    cursorApp: { workspace: 'my-app' },
    grokBuild: { permissionMode: 'plan' },
    codexApp: false,  // 隐藏某个页脚 Agent
    file: false,      // 关闭后端 Agent（剪贴板 / 文件）
  },
  recording: false,
});
```

> 默认导出与具名导出 `codeIntentInspectorPlugin` 相同（Vite）。按喜好选用即可。

### Vue

DOM → 源码映射对 Vue 2/3 SFC 经 code-inspector 可用。`.vue` 的 prompt 上下文是尽力而为
（模板行切片，不是完整 Vue AST）。JSX/TSX 仍走更完整的 AST 路径。见
[`demo/vue`](./demo/vue)。

## 演示

演示场在 [`demo/`](./demo)（React + Vue × Vite / webpack / rspack）：

```sh
cd demo && pnpm install
pnpm dev                 # react + vite
pnpm dev:vue             # vue + vite
pnpm dev:react:webpack
pnpm dev:react:rspack
```

按住 ⌘ 点击任意元素即可打开意图弹窗。细节见
[`demo/README.md`](./demo/README.md)。

## 环境要求

- **打包器** — Vite `>=4`、webpack `>=5`、rspack、rsbuild、esbuild 或 Farm 可完整零配置。
  Turbopack / Mako 只注入 `data-insp-path`。
- **`code-inspector-plugin`** — 由上述适配器注册；无需手动配置。
- **macOS** 开箱即可用页脚 Agent（`open` 处理 deeplink / launcher）。
  Linux/Windows 需按 Agent 设置 `openCommand`（见 [页脚 Agent 共用选项](#页脚-agent-共用选项)）。
- **目标 Agent 已安装** — Codex App / Claude App / Cursor /
  [Grok Build CLI](https://x.ai/cli)。这些 Agent 无需额外 npm 依赖。

## 意图弹窗

| 能力 | 作用 |
| --- | --- |
| **元素选取** | ⌘-点击（或快捷键 + 点击）。SPA 重渲染后会重新解析 `data-insp-path`。 |
| **Mention 编辑器** | 富文本 contenteditable；已选元素为置顶主引用。有附件时意图可为空。 |
| **`@code` 引用** | 再选一个元素 → 在光标处插入 `@file #range`。去重并保持顺序。 |
| **截图** | `selection` / `parent` / `viewport`（可多选）。作为 UI 偏好持久化。 |
| **渲染样式** | 精选计算 CSS（约 110 项），元素或祖先链。需显式开启；发送时读取。 |
| **录制** | rrweb 元素行为捕获 + 静帧。默认开启；需 `@rrweb/*`。 |
| **Pin** | 收成跨页悬浮球。热恢复保留附件；整页刷新只保留文本。 |

## 配置参考

`ideByebye(options)` — **所有选项均可选**。非法值回退到下方默认。

### 最小配置

```js
// vite.config.js
import ideByebye from 'ide-byebye';

export default {
  plugins: [ideByebye()],
};
```

空调用即可。默认行为：

| 行为 | 默认 |
| --- | --- |
| 插件开启 | `enabled: true`（仅开发环境） |
| 选取 | 按住 ⌘（macOS）/ Ctrl → 点击；快捷键 `Alt+Shift+I` |
| Enter 交接 | **Claude App** |
| 页脚 Agent | Codex App / Claude App / Cursor / Grok Build — 全部开启 |
| 后端 Agent | clipboard + file — 开启（经 Enter / `defaultAgent`） |
| 录制 | 开启（需 `@rrweb/record` + `@rrweb/replay`） |
| UI 语言 | auto（`navigator.language` → 否则 `zh`） |
| 交接文件目录 | `.intent-inspector/` |
| 源码 `@` 路径 | 相对路径；截图 / 静帧用绝对路径 |
| code-inspector | 自动注册（`pathType: 'absolute'`，并关掉其自带快捷键） |

只覆盖你需要的项：

```js
ideByebye({
  defaultAgent: 'cursor-app',
  locale: 'en',
  recording: false,
  agents: {
    codexApp: false,
    cursorApp: { workspace: 'my-app' },
  },
});
```

### 可选配置项（逐项）

#### `enabled`

| | |
| --- | --- |
| **类型** | `boolean` |
| **默认** | `true` |
| **可配** | `false` 完全关闭（不启服务、不注入）。其它值保持开启。 |

#### `locale`

| | |
| --- | --- |
| **类型** | `'zh' \| 'en'` |
| **默认** | auto — `config.locale` → `navigator.language` → `zh` |
| **可配** | `'zh'` / `'en'`，或以 `zh` 开头 → 中文，否则英文。Prompt 文案与品牌名**不**本地化。 |

#### `hotkey`

| | |
| --- | --- |
| **类型** | `string` |
| **默认** | `'Alt+Shift+I'` |
| **可配** | `+` 连接的组合键，大小写不敏感。修饰键：`alt`/`option`、`shift`、`ctrl`/`control`、`meta`/`cmd`/`command`。最后一段是主键。用于切换选取器。 |

#### `clickModifier`

| | |
| --- | --- |
| **类型** | `string \| null \| false` |
| **默认** | `'auto'` → macOS 用 ⌘，其它用 Ctrl |
| **可配** | `'meta'` / `'ctrl'` / `'alt'` / `'shift'` 强制修饰键；`null` / `false` 关闭点击选取（快捷键仍可用）。 |

#### `defaultAgent`

| | |
| --- | --- |
| **类型** | `string` |
| **默认** | `'claude-app'` |
| **可配** | Enter 目标：`'codex-app'` / `'claude-app'` / `'cursor-app'` / `'grok-build'`（或 `'clipboard'` / `'file'`）。未知 / 已禁用则回退到第一个已启用 Agent。 |

#### `applyMode`

| | |
| --- | --- |
| **类型** | `'prompt-only' \| 'agent-edit'` |
| **默认** | `'prompt-only'` |
| **可配** | 写入交接的提示：只出方案 vs 允许 Agent 改文件。 |

#### `outputDir`

| | |
| --- | --- |
| **类型** | `string` |
| **默认** | `'.intent-inspector'` |
| **可配** | 相对项目根的目录，供 `file` Agent / `promptMode: 'file'` / 溢出交接使用。必须落在项目根内。请加入 `.gitignore`。 |

#### `maxSourceContextLines`

| | |
| --- | --- |
| **类型** | `number` |
| **默认** | `60` |
| **可配** | 映射位置周围写入 prompt 的源码行数。 |

#### `maxDomSnippetLength`

| | |
| --- | --- |
| **类型** | `number` |
| **默认** | `1000` |
| **可配** | 捕获的 DOM/HTML 片段最大字符数。 |

#### `apiOrigin`

| | |
| --- | --- |
| **类型** | `string \| null` |
| **默认** | auto（loopback inspector origin） |
| **可配** | 绝对 `http(s)://…` origin（无尾斜杠），页面需打非默认 inspector 时设置。非法值 → auto。 |

#### `pathStyle`

| | |
| --- | --- |
| **类型** | `'relative' \| 'absolute'` |
| **默认** | `'relative'` |
| **可配** | 纯 `@` prompt（剪贴板 / 文件 / Grok）里**源码**路径风格。Grok monorepo 更宜用 `agents.grokBuild.projectRoot`，而不是强行绝对路径。 |

#### `artifactPathStyle`

| | |
| --- | --- |
| **类型** | `'relative' \| 'absolute'` |
| **默认** | `'absolute'` |
| **可配** | `@` prompt 里截图 / 录制静帧路径。绝对路径方便 Agent 不论 cwd 都能打开图；确定 Agent cwd 时才用 `'relative'`。 |

#### `recording`

| | |
| --- | --- |
| **类型** | `boolean \| object` |
| **默认** | 开启 — 见 [录制（rrweb）](#录制-rrweb) |
| **可配** | `false` / `{ enabled: false }` 隐藏 Record；或传对象调缓冲 / 遮罩。 |

#### `agents`

| | |
| --- | --- |
| **类型** | `object` |
| **默认** | `{}`（六个 Agent **全部开启**） |
| **可配** | 按 Agent 启用 / 覆盖 — 见 [Agents](#agents)。未知 key 忽略。 |

#### `codeInspector`

| | |
| --- | --- |
| **类型** | `object` |
| **默认** | `{}`，再与内置默认浅合并 |
| **可配** | 透传给 [`code-inspector-plugin`](https://github.com/zh-lx/code-inspector) 的额外选项（**不要**传 `bundler` — 由适配器填写）。内置默认：`pathType: 'absolute'`、`hotKeys: false`、`behavior: { locate: false, copy: false, defaultAction: 'target' }`。你的 `behavior` 会浅合并上去。 |

#### `htmlFiles`（仅 esbuild）

| | |
| --- | --- |
| **类型** | `string[]` |
| **默认** | 扫描 `outdir` 下 `*.html`，或 `outfile` 旁的 `index.html` |
| **可配** | HTML 不在 `outdir` 时，显式指定要注入 bootstrap 的 HTML 路径。 |

### Agents

六个 Agent，**默认全部开启**。用 `agents.<name>: false` 或 `{ enabled: false }` 关闭。
`true` 显式开启；对象则保持开启并覆盖选项。

只有页脚 Agent 有按钮；`clipboard` / `file` 可通过 `defaultAgent` / Enter 触发。

| 键（`agents.*`） | Adapter id | 页脚 | 用途 |
| --- | --- | --- | --- |
| `clipboard` | `clipboard` | 否 | 复制 prompt 到剪贴板（安全兜底）。 |
| `file` | `file` | 否 | 把请求 + prompt 写成 Markdown，落到 `outputDir/requests/`。 |
| `codexApp` | `codex-app` | 是 | 打开并预填 **Codex App**。 |
| `claudeApp` | `claude-app` | 是 | 打开并预填 **Claude App**；可附带文件与文件夹。 |
| `cursorApp` | `cursor-app` | 是 | 打开并预填 **Cursor**（按 workspace 名路由）。 |
| `grokBuild` | `grok-build` | 是 | 在 Terminal 打开 **Grok Build** 并预填 prompt。 |

```js
agents: {
  codexApp: false,
  cursorApp: { workspace: 'my-app' },
  grokBuild: {
    permissionMode: 'plan',
    // monorepo：grok --cwd 在仓库根 → @apps/desktop/src/…
    projectRoot: path.resolve(__dirname, '../..'),
  },
  clipboard: false,
}
```

找不到 opener 时按钮变灰（非 macOS 且未设 `openCommand`）。
Grok Build 在 PATH 上没有 `grok`（且不在 `~/.grok/bin/grok`）时也会变灰。

#### 页脚 Agent 共用选项

Codex / Claude / Cursor 共用以下项；Grok Build 复用它们做 Terminal launcher。

| 选项 | 类型 | 默认 | 可配内容 |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true`（使用对象时） | `false` 取消注册。 |
| `openCommand` | `string` | macOS 为 `'open'`，否则无 | deeplink / launcher 可执行文件。Linux/Windows 请设置（如 `'xdg-open'`）。 |
| `openArgs` | `string[]` | `[]` | URL / launcher 路径**之前**的额外参数。 |
| `promptMode` | `'auto' \| 'file'` | `'auto'` | `'file'` 写 Markdown 交接文件，并发送指向它的精简 prompt。`'auto'` 下 Cursor / Grok 可能因超长溢出到文件；Claude / Codex 仅在显式 `'file'` 时切换。 |

#### `agents.claudeApp`

| 选项 | 类型 | 默认 | 可配内容 |
| --- | --- | --- | --- |
| `scheme` | `string` | `'claude'` | Deeplink scheme（`claude://…`）。非法 scheme 会导致发送失败。 |
| `route` | `string` | `'code'` | 路径 → `claude://<route>/new`。 |
| `folders` | `string[]` | `[]`（始终再加项目根） | 与项目根一并打开的额外文件夹。相对路径相对进程 cwd 解析。 |
| `attachFiles` | `boolean` | `true` | 把引用源文件（及截图）作为 deeplink `file` 参数附上。 |
| `attachScreenshots` | `boolean` | `true` | 包含截图产物。`attachFiles` 为 `false` 时忽略。 |

#### `agents.codexApp`

| 选项 | 类型 | 默认 | 可配内容 |
| --- | --- | --- | --- |
| `scheme` | `string` | `'codex'` | Deeplink scheme（`codex://new`）。 |
| `projectRoot` | `string` | Vite / 打包器项目根 | deeplink 打开的文件夹。非空字符串覆盖；相对路径相对进程 cwd `path.resolve`。 |

#### `agents.cursorApp`

| 选项 | 类型 | 默认 | 可配内容 |
| --- | --- | --- | --- |
| `workspace` | `string \| false` | 最近 git 根目录 basename（否则为运行目录名） | Cursor 路由用的 workspace **名**（不是路径）。窗口标题不同时请设字符串；`false` 省略该参数。 |
| `projectRoot` | `string` | 未设 | 若设置，用该目录 basename 作 `workspace`（不再向上找 git）。 |
| `mode` | `string` | 无 | 可选的 Cursor `mode` deeplink 参数。 |
| `promptUrlLimit` | `number` | `10000` | `auto` 模式下，URL 编码后超此长度会切到文件交接。 |
| `scheme` | `string` | `'cursor'` | Deeplink scheme。 |
| `authority` | `string` | `'anysphere.cursor-deeplink'` | 仅自定义 Cursor 构建时改。 |
| `route` | `string` | `'prompt'` | Deeplink 路由段。 |

#### `agents.grokBuild`

| 选项 | 类型 | 默认 | 可配内容 |
| --- | --- | --- | --- |
| `command` | `string` | `'grok'`，其次 `~/.grok/bin/grok` | CLI 二进制。若 Node 的 PATH 与登录 shell 不同，请给绝对路径。 |
| `projectRoot` | `string` | Vite / 打包器项目根 | `grok --cwd` 与 launcher 的 `cd`。相对 `@` 引用相对此根剥离。 |
| `pathStyle` | `'relative' \| 'absolute'` | `'relative'` | **仅影响 Grok prompt** 里的源码 `@` 引用（monorepo 优先相对路径 + `projectRoot`）。 |
| `artifactPathStyle` | `'relative' \| 'absolute'` | `'absolute'` | Grok prompt 里截图 / 静帧路径。 |
| `permissionMode` | `string` | 无 | 传给 `--permission-mode`（`plan`、`acceptEdits`、`default` 等）。 |
| `promptArgLimit` | `number` | `12000` | `auto` 模式下，更长 prompt 会切到文件交接（ARGV / ARG_MAX）。 |

### 录制（rrweb）

用 [rrweb](https://github.com/rrweb-io/rrweb) 录制 **元素行为**：选范围 → 录制 → 交互 →
停止 → 浏览器内裁剪。静帧（裁到范围）进 prompt；原始事件流只存盘供回放。Inspector UI
从不进入任何录制。

默认开启、懒加载。项目需有 `@rrweb/record` + `@rrweb/replay`。

```js
ideByebye({
  recording: false, // 或：
  recording: {
    maxDurationMs: 30000, // 滚动缓冲；上限 300000（5 分钟）
    mask: {
      allInputs: false,       // 默认关：开发时保留真实表单状态
      blockClass: 'rr-block', // 带此 class 的元素排除
    },
  },
});
```

| 选项 | 类型 | 默认 | 可配内容 |
| --- | --- | --- | --- |
| `recording` / `recording.enabled` | `boolean` | `true` | `false` / `{ enabled: false }` 隐藏 Record 按钮。 |
| `recording.maxDurationMs` | `number` | `30000` | 滚动缓冲长度；仅采纳正数；上限 ≤ `300000` ms。 |
| `recording.mask.allInputs` | `boolean` | `false` | `true` 时在回放 / 静帧中遮罩输入值。 |
| `recording.mask.blockClass` | `string` | `'rr-block'` | 标记排除元素的 class（非空字符串才覆盖）。 |

rrweb ESM 从你的 `node_modules` 懒服务到
`/__intent-inspector/vendor/{record,replay}`。静帧与截图同路径：
SVG-`<foreignObject>` → canvas。无 CORS 的跨域资源可能空白，字体需已加载，
且 **`canvas` / WebGL 不会被捕获**。

## 产物

写入 `outputDir`（默认 `.intent-inspector/` — 请加入 `.gitignore`）：

| 路径 | 内容 |
| --- | --- |
| `requests/<timestamp>-<id>.md` | 完整请求 + prompt（`file` Agent，或任意页脚 Agent 在 `promptMode: 'file'` / auto 溢出时）。 |
| `launches/<timestamp>-<id>.command` + `.prompt.txt` | Grok Build Terminal launcher + 供 `grok --verbatim` 的 prompt。 |
| `recordings/<id>.rrweb.json` + `<id>.webp` | 事件流 + 静帧（使用录制时）。 |
| 截图产物 | 由 prompt 引用。 |

Prompt 顺序：`@code` 引用 → **Rendered styles**（若附加）→ 意图。
捕获样式里的绝对源码路径不会进入 deeplink prompt 文本。

### 不经 npm 分发（可选）

```sh
npm run build
# → dist/code-intent-inspector.js  （内嵌浏览器运行时）
# → dist/client.js                 （仅浏览器运行时）
```

```js
import codeIntentInspectorPlugin from './code-intent-inspector.js';
```

## 本地化

UI 文案双语（`zh` / `en`）。解析顺序：
`locale` 配置 → `navigator.language` → `zh`。

```js
ideByebye({ locale: 'en' });
```

## 安全与隐私

- **仅开发** — 适配器跳过生产（Vite `apply: 'serve'`、webpack `mode === 'production'` 等）。
- **Token 门禁** — 每个请求带按进程 token；浏览器打 `127.0.0.1`，不是你的应用 origin。
- **项目根约束** — 文件写入不离开项目；deeplink 只携带你选择发送的内容。
- **样式净化** — 捕获的样式值在服务端净化（剥控制字符），避免伪造额外 prompt 行。

## 从源码构建

```sh
npm install
npm run build    # 重新生成 dist/
npm test         # node:test 套件
```

结构：`src/client/`（浏览器）、`src/server/`（loopback 服务 + agents）、
`src/shared/`（同构工具）、`plugin.js`（unplugin 工厂）、
`scripts/build-single-file.js`。

## 许可证

[MIT](./LICENSE) © dravenLee
