import type { IdeByebyeOptions, PluginInstance } from './index.js';

/**
 * Farm entry: `import inspector from 'ide-byebye/farm'`.
 * Returns `[codeInspectorPlugin, inspectorFarmPlugin]`.
 */
export function farm(options?: IdeByebyeOptions): PluginInstance[];
export default farm;
