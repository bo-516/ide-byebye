import type { IdeByebyeOptions, PluginInstance } from './index.js';

/**
 * esbuild entry: `import inspector from 'ide-byebye/esbuild'`.
 * Optional `htmlFiles` rewrites those HTML files after each build.
 */
export function esbuild(options?: IdeByebyeOptions): PluginInstance[];
export default esbuild;
