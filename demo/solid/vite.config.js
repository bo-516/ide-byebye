import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
// Source-tree usage. Real projects: `import inspector from 'ide-byebye'`.
import inspector from '../../dist/index.js';

/**
 * Solid + Vite. `inspector()` is first so JSX is stamped before `vite-plugin-solid` compiles it.
 * Human port 5810; the matrix sets `PORT`. Does not open a browser.
 */
export default defineConfig({
    plugins: [
        inspector(),
        solid(),
    ],
    server: {
        host: '127.0.0.1',
        port: Number(process.env.PORT) || 5810,
        strictPort: true,
        open: false,
    },
});
