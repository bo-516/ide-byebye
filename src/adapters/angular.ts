/**
 * Angular CLI entry: `import { angularProxy } from 'ide-byebye/angular'`.
 * Use from a `proxyConfig` module (`export default await angularProxy()`) plus the generated
 * `node_modules/ide-byebye/dist/angular/bootstrap.js` in the development `scripts` of `angular.json`.
 */
export type { AngularIdeByebyeOptions, IdeByebyeOptions } from '../types.js';
export { angularProxy, angularProxy as default } from '../server/angular/proxy.js';
