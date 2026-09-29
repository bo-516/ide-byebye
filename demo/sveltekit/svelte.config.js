import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/**
 * SvelteKit config for the dev demo.
 * `adapt` is never called by `vite dev`; the noop keeps Kit from requiring a production adapter.
 */
export default {
    preprocess: vitePreprocess(),
    kit: {
        adapter: {
            name: 'demo-noop',
            adapt() {},
        },
    },
};
