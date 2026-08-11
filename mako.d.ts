import type { IdeByebyeOptions, PluginInstance } from './index.js';

/**
 * Mako (Umi) entry: path injection only; bootstrap still needs an HTML entry.
 */
export function mako(options?: IdeByebyeOptions): PluginInstance;
export default mako;
