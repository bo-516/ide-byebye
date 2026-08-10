// Package entry. Per-bundler entry points let callers pick the adapter without ever passing a `bundler` string:
//   import inspector from 'ide-byebye'           // Vite (back-compat default)
//   import inspector from 'ide-byebye/vite'      // Vite (explicit)
//   import inspector from 'ide-byebye/webpack'   // webpack
//   import inspector from 'ide-byebye/rspack'    // rspack
//   import inspector from 'ide-byebye/rsbuild'   // rsbuild
//   import inspector from 'ide-byebye/esbuild'   // esbuild
//   import inspector from 'ide-byebye/farm'      // Farm
//   import inspector from 'ide-byebye/turbopack' // Next.js Turbopack rules (data-insp-path only)
//   import inspector from 'ide-byebye/mako'      // Umi Mako (data-insp-path only)
export {
    vite,
    webpack,
    rspack,
    rsbuild,
    esbuild,
    farm,
    turbopack,
    mako,
    codeIntentInspectorPlugin,
} from './plugin.js';
export { codeIntentInspectorPlugin as default } from './plugin.js';
