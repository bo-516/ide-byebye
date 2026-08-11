import type { IdeByebyeOptions, PluginInstance } from './index.js';

/**
 * Turbopack (Next.js) entry: rules only for `data-insp-path` injection.
 * Bootstrap must still be mounted by the app.
 */
export function turbopack(options?: IdeByebyeOptions): PluginInstance;
export default turbopack;
