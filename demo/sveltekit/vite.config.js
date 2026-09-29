import { sveltekit } from '@sveltejs/kit/vite';
// Source-tree usage. Real projects: `import inspector from 'ide-byebye'`.
import inspector from '../../dist/index.js';

/**
 * SvelteKit 2 + Vite. `inspector()` is registered before `sveltekit()`.
 * The human CLI passes `--port 5890`; the matrix passes the test port. No browser.
 */
export default {
    plugins: [inspector(), sveltekit()],
    server: {
        host: '127.0.0.1',
        port: Number(process.env.PORT) || 5890,
        strictPort: true,
        open: false,
    },
};
