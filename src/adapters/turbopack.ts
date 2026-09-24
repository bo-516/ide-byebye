/**
 * Turbopack (Next.js) entry: `import inspector from 'ide-byebye/turbopack'`.
 * Rules for `turbopack.rules`: `data-insp-path` injection plus automatic bootstrap mounting in `next dev`.
 * Prefer `ide-byebye/next`, which also covers `next dev --webpack` and older Next config keys.
 */
export type { NextIdeByebyeOptions, IdeByebyeOptions, PluginInstance } from '../types.js';
export { turbopack, turbopack as default } from '../plugin.js';
