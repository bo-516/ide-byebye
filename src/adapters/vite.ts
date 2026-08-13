/**
 * Vite entry: `import inspector from 'ide-byebye/vite'`.
 * Returns `[codeInspectorPlugin, inspectorVitePlugin]` typed as `VitePlugin[]`
 * so it nests cleanly under Vite's `plugins: PluginOption[]` without a cast.
 */
export type { IdeByebyeOptions, VitePlugin, PluginInstance } from '../types.js';
export { vite, vite as default } from '../plugin.js';
