import { defineConfig } from '@farmfe/core';
// Source-tree usage. Real projects: `import inspector from 'ide-byebye/farm'`.
import inspector from '../../dist/adapters/farm.js';

/**
 * React + Farm. `farm()` returns `[stamp, inspector]`, so the array is spread.
 * The human CLI passes `--port 5850`; the matrix passes the test port. No `--open`.
 */
export default defineConfig({
    compilation: {
        input: {
            index: './index.html',
        },
        output: {
            path: './dist',
            publicPath: '/',
            targetEnv: 'browser',
        },
    },
    server: {
        host: '127.0.0.1',
        port: Number(process.env.PORT) || 5850,
        open: false,
        strictPort: true,
    },
    plugins: [...inspector()],
});
