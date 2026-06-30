// Package entry. Per-bundler entry points let callers pick the adapter without ever passing a `bundler` string:
//   import inspector from 'ide-byebye'          // Vite (back-compat default)
//   import inspector from 'ide-byebye/webpack'  // webpack
//   import inspector from 'ide-byebye/rspack'   // rspack
export { vite, webpack, rspack, codeIntentInspectorPlugin } from './plugin.js';
export { codeIntentInspectorPlugin as default } from './plugin.js';
