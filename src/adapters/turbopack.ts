/**
 * Turbopack (Next.js) entry: `import inspector from 'ide-byebye/turbopack'`.
 * Rules only for `data-insp-path` injection; bootstrap must still be mounted by the app.
 */
export type { IdeByebyeOptions, PluginInstance } from '../types.js';
export { turbopack, turbopack as default } from '../plugin.js';
