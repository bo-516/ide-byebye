import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
// Source-tree usage. Real projects: `import inspector from 'ide-byebye/rsbuild'`.
import inspector from '../../dist/adapters/rsbuild.js';

/**
 * React + Rsbuild. `inspector()` is registered before the React plugin.
 * The human CLI passes `--port 5830`; the matrix passes the test port.
 * `open` stays off — this demo never launches a browser.
 */
export default defineConfig({
    plugins: [inspector(), pluginReact()],
    source: {
        entry: { index: './src/main.jsx' },
    },
    html: {
        template: './index.html',
    },
    server: {
        host: '127.0.0.1',
        port: Number(process.env.PORT) || 5830,
        strictPort: true,
        open: false,
    },
});
