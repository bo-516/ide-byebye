import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { codeInspectorPlugin } from 'code-inspector-plugin';
// Demo 直接相对 import 插件源码（source-tree usage），方便边改插件边测试。
// 在真实项目里，应改成把 ../dist/code-intent-inspector.js 单文件复制进项目后 import。
import codeIntentInspectorPlugin from '../index.js';

export default defineConfig({
  plugins: [
    // 1) code-inspector-plugin 必须放在 @vitejs/plugin-react 之前，才能在 JSX
    //    转换前给每个 DOM 元素注入 data-insp-path（源码 文件:行:列）。这里关掉
    //    它自带的快捷键跳转 / 复制，只保留“注入定位信息”的能力，避免与下面我们
    //    插件的 ⌘ + 点击 手势冲突。
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

    react(),

    // 2) ai-inspector（本插件）：⌘ + 点击 任意元素 → 选中并弹出“意图”对话框 →
    //    填写意图后，点对话框底部的 app 按钮把「元素源码 + 你的意图」整理成
    //    结构化 Prompt 并打开对应 app 预填。
    //    注意：对话框底部的按钮固定是 Codex App / Claude App / Cursor 三个，
    //    所以这里必须把对应的 app agent 打开，按钮才可用（否则点了会提示
    //    “… is not enabled.”）。这三个 agent 仅依赖 macOS 的 `open` 命令、
    //    无需安装额外 npm 依赖，装了对应 app 即可响应 deeplink。
    codeIntentInspectorPlugin({
      defaultAgent: 'claude-app', // 回车提交的默认目标
      clickModifier: 'meta', // macOS 的 ⌘；也可写 'command' / 'cmd'
      agents: {
        claudeApp: true, // 打开 Claude，预填新对话
        codexApp: { enabled: true }, // 打开 Codex App
        cursorApp: { enabled: true, workspace: 'demo' }, // 打开 Cursor（按 workspace 名路由）
      },
    }),
  ],
  server: {
    // 显式绑 IPv4：与插件内部固定使用的 http://127.0.0.1 origin 对齐。否则
    // vite 默认 host=localhost 可能只解析到 IPv6(::1)，导致浏览器对插件
    // /__intent-inspector 接口的 fetch 连不上。
    host: '127.0.0.1',
    port: 5300,
    open: true,
  },
});
