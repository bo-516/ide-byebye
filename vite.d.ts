import type { IdeByebyeOptions, PluginInstance } from './index.js';

/**
 * Vite entry: `import inspector from 'ide-byebye/vite'`.
 * Returns `[codeInspectorPlugin, inspectorVitePlugin]`.
 */
export function vite(options?: IdeByebyeOptions): PluginInstance[];
export default vite;
