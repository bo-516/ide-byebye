// esbuild entry: `import inspector from 'ide-byebye/esbuild'`. Bundler is fixed to esbuild; pass no `bundler`.
// Optional: `inspector({ htmlFiles: ['./index.html'] })` rewrites those HTML files after each build with the bootstrap.
export { esbuild, esbuild as default } from './plugin.js';
