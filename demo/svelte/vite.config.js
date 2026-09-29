import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
// Source-tree usage. Real projects: `import inspector from 'ide-byebye'`.
import inspector from '../../dist/index.js';

/**
 * Svelte 5 + Vite. `inspector()` is first so the stamp runs before the Svelte compile.
 * Human port 5800; the matrix sets `PORT`. The dev server does not open a browser.
 */
export default defineConfig({
    plugins: [
        inspector(),
        svelte(),
    ],
    server: {
        host: '127.0.0.1',
        port: Number(process.env.PORT) || 5800,
        strictPort: true,
        open: false,
    },
});
