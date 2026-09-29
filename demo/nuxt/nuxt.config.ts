// Source-tree usage. Real projects: `import inspector from 'ide-byebye'`.
import inspector from '../../dist/index.js';

/**
 * Nuxt 4 + Vite. The inspector is the first Vite plugin so the Vite browser client receives the bootstrap.
 * Nuxt's dev base is `/_nuxt/`, so the page loads `/_nuxt/@vite/client`. Human port 5880. Does not open a browser.
 */
export default defineNuxtConfig({
    vite: {
        plugins: [inspector()],
    },
    devServer: {
        host: '127.0.0.1',
        port: Number(process.env.PORT) || 5880,
    },
});
