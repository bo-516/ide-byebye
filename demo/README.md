# ai-inspector demo

一个用来测试 **code-intent-inspector** 插件的最小 Vite + React 项目。
触发方式：**按住 ⌘（Command）点击页面上任意元素**。

## 运行

在本目录下：

```sh
pnpm install
pnpm dev
```

浏览器会自动打开 `http://127.0.0.1:5300`。

## 怎么测试

1. 在页面上**按住 ⌘**，移动鼠标 —— 悬停的元素会被高亮预览。
2. **⌘ + 点击**任意元素（标题、按钮、卡片、输入框、列表项……）。
3. 弹出「意图」对话框，里面已带上该元素的**源码位置与上下文**。
4. 输入你的修改意图（例如“把这个按钮改成圆角”）。
5. 点对话框底部的 **app 按钮**：`Codex App` / `Claude App` / `Cursor`。插件会把
   「元素源码 + 你的意图」整理成结构化 Prompt，并用 deeplink 打开对应 app、
   预填一个新对话。按 **回车** 默认提交到 `claude-app`。

> ⚠️ 对话框底部的按钮**固定**就是 Codex App / Claude App / Cursor 这三个
> （客户端写死的，见 `client/dialog-utils.js` 的 `AGENT_ACTIONS`）。要让按钮可用，
> 必须在 `vite.config.js` 里启用对应 agent（本 demo 已三个全开），否则点击会提示
> `… is not enabled.`。点哪个按钮，就要本机装了对应 app 才能真正被打开。
>
> 改动 `vite.config.js` 后 dev server 会自动重启，**记得刷新浏览器页面**再测。

> 另一种触发方式：直接按快捷键 `Alt+Shift+I` 进入/退出拾取模式，再普通点击元素。

## 关键配置（见 `vite.config.js`）

```js
// 编译期注入 data-insp-path（源码定位），关掉它自己的点击行为避免冲突
codeInspectorPlugin({
  bundler: 'vite',
  pathType: 'absolute',
  hotKeys: ['altKey'],
  behavior: { locate: false, copy: false, defaultAction: 'target' },
}),

// 本插件：⌘ + 点击 触发
codeIntentInspectorPlugin({
  defaultAgent: 'claude-app',     // 回车提交的默认目标
  clickModifier: 'meta',          // ⌘；也可写 'command' / 'cmd'
  agents: {
    claudeApp: true,                              // 打开 Claude
    codexApp: { enabled: true },                  // 打开 Codex App
    cursorApp: { enabled: true, workspace: 'demo' }, // 打开 Cursor（按 workspace 名路由）
  },
}),
```

- `clickModifier`：触发修饰键。`'meta'` = ⌘，`'alt'` = Option，`'control'` = Ctrl，`'shift'` = Shift。
- `defaultAgent`：按回车时提交的目标，必须是底部三个 app agent 之一。

## agent 说明

- **对话框底部按钮固定 = `codex-app` / `claude-app` / `cursor-app`**。三者都只依赖
  macOS 的 `open` 命令打开 `codex://` / `claude://` / `cursor://` deeplink，**无需安装额外
  npm 依赖**，但需要本机装了对应 app 才能真正响应。
- `clipboard` / `file` 默认也启用，但**没有对话框按钮入口**，属于后端 agent
  （`file` 会把请求写到 `.intent-inspector/`）。
- `cursorApp.workspace`：按 Cursor 里显示的 workspace 名路由，若与文件夹名不同请修改。
- `claudeApp` / `codexApp` 还支持 `projectRoot`、`folders` 等选项，详见仓库根目录
  `../README.md`。Codex 网页 dock / Codex SDK 等需要额外安装依赖。

## 它是怎么接上的

本 demo 直接相对 import 了插件源码（方便边改插件边测）：

```js
import codeIntentInspectorPlugin from '../index.js';
```

在你自己的真实项目里，应改为在仓库根运行 `npm run build` 后，把
`dist/code-intent-inspector.js` 单文件复制进项目再 import。

另外 `server.host` 显式设为 `'127.0.0.1'`：插件内部把浏览器请求固定指向
`127.0.0.1`，而 vite 默认 `host: localhost` 在不少系统会走 IPv6(`::1`)，
不对齐会导致插件客户端连不上、UI 不加载。
