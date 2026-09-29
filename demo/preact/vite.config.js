import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
// Source-tree usage. Real projects: `import inspector from 'ide-byebye'`.
import inspector from '../../dist/index.js';

/**
 * Preact + Vite. `inspector()` is first so JSX is stamped before the Preact preset compiles it.
 * Human port 5820; the matrix sets `PORT`. Does not open a browser.
 */
export default defineConfig({
    plugins: [
        inspector(),
        preact(),
    ],
    server: {
        host: '127.0.0.1',
        port: Number(process.env.PORT) || 5820,
        strictPort: true,
        open: false,
    },
});
