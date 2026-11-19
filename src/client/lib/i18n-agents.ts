/**
 * Agent destination picker titles and delivery error copy for `i18n.ts`.
 *
 * Boundary: brand names (`Codex App`, `WorkBuddy`, `TRAE`, `Qoder`, …) remain untranslated per `AGENTS.md`. Every entry
 * carries both `zh` and `en` strings.
 */

export const AGENT_STRINGS: Record<string, { zh: string; en: string }> = {
    'agent.codexApp.title': {
        zh: '在 Codex App 中打开并预填本次 UI 修改意图。',
        en: 'Open Codex App with this UI change intent prefilled.',
    },
    'agent.claudeApp.title': {
        zh: '在 Claude App 中打开并预填本次 UI 修改意图。',
        en: 'Open Claude App with this UI change intent prefilled.',
    },
    'agent.cursorApp.title': {
        zh: '在 Cursor 中打开并预填本次 UI 修改意图。',
        en: 'Open Cursor with this UI change intent prefilled.',
    },
    'agent.grokBuild.title': {
        zh: '在终端打开 Grok Build，并预填本次 UI 修改意图。',
        en: 'Open Grok Build in Terminal with this UI change intent prefilled.',
    },
    'agent.claudeCli.title': {
        zh: '在终端打开 Claude Code CLI，并带上本次 UI 修改意图。',
        en: 'Open Claude Code CLI in a terminal with this UI change intent.',
    },
    'agent.opencode.title': {
        zh: '在 OpenCode 中新建会话，并带上本次 UI 修改意图。',
        en: 'Start a new OpenCode session with this UI change intent.',
    },
    'agent.antigravityIde.title': {
        zh: '在 Antigravity IDE 中打开聊天，并预填本次 UI 修改意图。',
        en: 'Open Antigravity IDE chat with this UI change intent prefilled.',
    },
    'agent.antigravity.title': {
        zh: '在终端打开 Antigravity CLI，并预填本次 UI 修改意图。',
        en: 'Open the Antigravity CLI in Terminal with this UI change intent prefilled.',
    },
    'agent.workbuddyApp.title': {
        zh: '在 WorkBuddy 中打开并预填本次 UI 修改意图。',
        en: 'Open WorkBuddy with this UI change intent prefilled.',
    },
    'agent.workbuddyCli.title': {
        zh: '在终端打开 WorkBuddy CLI，并带上本次 UI 修改意图。',
        en: 'Open WorkBuddy CLI in a terminal with this UI change intent.',
    },
    'agent.traeApp.title': {
        zh: '在 TRAE 中打开聊天，并预填本次 UI 修改意图。',
        en: 'Open TRAE chat with this UI change intent prefilled.',
    },
    'agent.traeCli.title': {
        zh: '在终端打开 TRAE CLI，并带上本次 UI 修改意图。',
        en: 'Open TRAE CLI in a terminal with this UI change intent.',
    },
    'agent.qoderApp.title': {
        zh: '在 Qoder 中打开聊天，并预填本次 UI 修改意图。',
        en: 'Open Qoder chat with this UI change intent prefilled.',
    },
    'agent.qoderCli.title': {
        zh: '在终端打开 Qoder CLI，并带上本次 UI 修改意图。',
        en: 'Open Qoder CLI in a terminal with this UI change intent.',
    },
    'agent.devinCli.title': {
        zh: '在终端打开 Devin，并预填本次 UI 修改意图。',
        en: 'Open Devin in a terminal with this UI change intent prefilled.',
    },
    'agent.devinIde.title': {
        zh: '在 Devin 中打开聊天，并预填本次 UI 修改意图。',
        en: 'Open Devin chat with this UI change intent prefilled.',
    },
    'agent.windsurfIde.title': {
        zh: '在 Windsurf 中打开聊天，并预填本次 UI 修改意图。',
        en: 'Open Windsurf chat with this UI change intent prefilled.',
    },
    'agent.custom.title': {
        zh: '把本次 UI 修改意图发送给 {label}。',
        en: 'Send this UI change intent to {label}.',
    },
    'deliver.noWindow': {
        zh: '无法发送给 {label}：当前页面没有被客户端嵌入（找不到目标窗口）。',
        en: 'Cannot reach {label}: this page is not embedded in the client (no target window).',
    },
    'deliver.failed': {
        zh: '发送给 {label} 失败：{error}',
        en: 'Failed to send to {label}: {error}',
    },
    'agent.clipboard.label': { zh: '复制 Prompt', en: 'Copy prompt' },
    'clipboard.copied': { zh: '已复制', en: 'Copied' },
    'send.title': { zh: '发送到 {label}', en: 'Send to {label}' },
    'agent.menu.title': { zh: '发送到', en: 'Send to' },
    'agent.menu.choose': { zh: '切换发送目标', en: 'Change destination' },
    // Shown right after the destination label; the leading space (en) / full-width bracket (zh) is the gap.
    'agent.menu.unavailable': { zh: '（不可用）', en: ' (unavailable)' },
    'agent.menu.sessions': { zh: '选择已有会话', en: 'Choose an existing session' },
    'clipboard.copyFailed': {
        zh: '自动复制失败，请全选下方内容并手动复制（⌘/Ctrl+C）。',
        en: 'Copy failed — select the text below and copy it manually (⌘/Ctrl+C).',
    },
    'agent.notEnabled': { zh: '{label} 未启用。', en: '{label} is not enabled.' },
    'agent.unavailable': { zh: '{label} 不可用。', en: '{label} is unavailable.' },
    'agent.checkSetup': {
        zh: '请检查适配器配置后重试。',
        en: 'Check the adapter setup and try again.',
    },
    'agent.notEnabledInConfig': {
        zh: '{label} 未在插件配置中启用。',
        en: '{label} is not enabled in the plugin config.',
    },
    'agent.currentlyUnavailable': {
        zh: '{label} 当前不可用。',
        en: '{label} is currently unavailable.',
    },
    'agent.failedHandle': {
        zh: '{label} 处理请求失败。',
        en: '{label} failed to handle the request.',
    },
};
