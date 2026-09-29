/**
 * The 16 demo processes, shared by `demo/dev.mjs` and the HTTP matrix.
 *
 * Purpose: one description of cwd, command, arguments, and ports. A human launch
 * uses `launchArgs(row, row.humanPort)`. The matrix uses `launchArgs(row, row.testPort)`.
 * `portFlag: 'env'` rows leave the port out of the arguments so the tool reads `PORT`
 * or its own default. `portFlag: 'argv'` rows append `portArgs(port)`.
 *
 * Boundary: marker checks are `{ includes, path?, crawl?, match? }`. `path` is one GET.
 * `crawl` searches the ready document, its script URLs, then one static-import level.
 * `{ session: true }` is only the Angular session JSON. This file does not spawn processes.
 */
import path from 'node:path';

const BOOT = 'window.__CODE_INTENT_INSPECTOR__=';
const STAMP = 'data-insp-path';
const VITE_KEY = 'var key = "__CODE_INTENT_INSPECTOR__"';
const READY = 90_000;

/**
 * CLI host and port flags. `extra` is appended after `--port` (for example `--strictPort`).
 *
 * @param {'--host' | '--hostname'} hostFlag The tool's host flag.
 * @param {string[]} [extra] Flags that follow the port.
 * @returns {(port: number) => string[]}
 */
function hostPort(hostFlag, extra = []) {
    return (port) => [hostFlag, '127.0.0.1', '--port', String(port), ...extra];
}

/** @type {Array<Record<string, unknown>>} */
export const demos = [
    {
        id: 'C-01',
        title: 'react + vite',
        app: 'react',
        bundler: 'vite',
        cwd: 'react',
        command: 'vite',
        args: ['--config', 'vite.config.js'],
        portFlag: 'env',
        humanPort: 5300,
        testPort: 35300,
        readyMs: READY,
        injection: { includes: [BOOT] },
        source: { path: '/src/components/AddTask.jsx', includes: [STAMP, 'AddTask.jsx:'] },
    },
    {
        id: 'C-02',
        title: 'react + webpack',
        app: 'react',
        bundler: 'webpack',
        cwd: 'react',
        command: 'webpack',
        args: ['serve', '--mode', 'development', '--config', 'webpack.config.mjs'],
        portFlag: 'env',
        humanPort: 5400,
        testPort: 35301,
        readyMs: READY,
        injection: { includes: [BOOT] },
        source: { crawl: true, match: 'all', includes: [STAMP, 'AddTask.jsx:'] },
    },
    {
        id: 'C-03',
        title: 'react + rspack',
        app: 'react',
        bundler: 'rspack',
        cwd: 'react',
        command: 'rspack',
        args: ['serve', '--mode', 'development', '--config', 'rspack.config.mjs'],
        portFlag: 'env',
        humanPort: 5500,
        testPort: 35302,
        readyMs: READY,
        injection: { includes: [BOOT] },
        source: { crawl: true, match: 'all', includes: [STAMP, 'AddTask.jsx:'] },
    },
    {
        id: 'C-04',
        title: 'vue + vite',
        app: 'vue',
        bundler: 'vite',
        cwd: 'vue',
        command: 'vite',
        args: ['--config', 'vite.config.js'],
        portFlag: 'env',
        humanPort: 5600,
        testPort: 35303,
        readyMs: READY,
        injection: { includes: [BOOT] },
        source: { path: '/src/App.vue', includes: [STAMP, 'App.vue:'] },
    },
    {
        id: 'C-05',
        title: 'vue + webpack',
        app: 'vue',
        bundler: 'webpack',
        cwd: 'vue',
        command: 'webpack',
        args: ['serve', '--mode', 'development', '--config', 'webpack.config.mjs'],
        portFlag: 'env',
        humanPort: 5700,
        testPort: 35304,
        readyMs: READY,
        injection: { includes: [BOOT] },
        source: { crawl: true, match: 'all', includes: [STAMP, 'App.vue:'] },
    },
    {
        id: 'C-06',
        title: 'svelte + vite',
        app: 'svelte',
        bundler: 'vite',
        cwd: 'svelte',
        command: 'vite',
        args: ['--config', 'vite.config.js'],
        portFlag: 'env',
        humanPort: 5800,
        testPort: 35305,
        readyMs: READY,
        injection: { includes: [BOOT] },
        source: { path: '/src/lib/Ping.svelte', includes: [STAMP, 'Ping.svelte:'] },
    },
    {
        id: 'C-07',
        title: 'solid + vite',
        app: 'solid',
        bundler: 'vite',
        cwd: 'solid',
        command: 'vite',
        args: ['--config', 'vite.config.js'],
        portFlag: 'env',
        humanPort: 5810,
        testPort: 35306,
        readyMs: READY,
        injection: { includes: [BOOT] },
        source: { path: '/src/Ping.jsx', includes: [STAMP, 'Ping.jsx:'] },
    },
    {
        id: 'C-08',
        title: 'preact + vite',
        app: 'preact',
        bundler: 'vite',
        cwd: 'preact',
        command: 'vite',
        args: ['--config', 'vite.config.js'],
        portFlag: 'env',
        humanPort: 5820,
        testPort: 35307,
        readyMs: READY,
        injection: { includes: [BOOT] },
        source: { path: '/src/Ping.jsx', includes: [STAMP, 'Ping.jsx:'] },
    },
    {
        id: 'C-09',
        title: 'react + rsbuild',
        app: 'react',
        bundler: 'rsbuild',
        cwd: 'rsbuild',
        command: 'rsbuild',
        args: ['dev'],
        portFlag: 'argv',
        portArgs: hostPort('--host'),
        humanPort: 5830,
        testPort: 35308,
        readyMs: READY,
        injection: { includes: [BOOT] },
        source: { crawl: true, match: 'all', includes: [STAMP, 'Ping.jsx:'] },
    },
    {
        id: 'C-10',
        title: 'react + esbuild',
        app: 'react',
        bundler: 'esbuild',
        cwd: 'esbuild',
        command: 'node',
        args: ['dev.mjs'],
        portFlag: 'env',
        humanPort: 5840,
        testPort: 35309,
        readyMs: READY,
        injection: { includes: [BOOT] },
        source: { path: '/main.js', includes: [STAMP, 'Ping.jsx:'] },
    },
    {
        id: 'C-11',
        title: 'react + farm',
        app: 'react',
        bundler: 'farm',
        cwd: 'farm',
        command: 'farm',
        args: [],
        portFlag: 'argv',
        portArgs: hostPort('--host', ['--strictPort']),
        humanPort: 5850,
        testPort: 35310,
        readyMs: READY,
        injection: { includes: [BOOT] },
        source: { crawl: true, match: 'all', includes: [STAMP, 'Ping.jsx:'] },
    },
    {
        id: 'C-12',
        title: 'next + turbopack',
        app: 'next',
        bundler: 'turbopack',
        cwd: 'next',
        command: 'next',
        args: ['dev'],
        portFlag: 'argv',
        portArgs: hostPort('--hostname'),
        humanPort: 5860,
        testPort: 35311,
        readyMs: READY,
        injection: {
            crawl: true,
            match: 'any',
            includes: ['__IdeByebyeBootstrap', '__CODE_INTENT_INSPECTOR__'],
        },
        source: { crawl: true, match: 'all', includes: [STAMP, 'page.tsx:'] },
    },
    {
        id: 'C-13',
        title: 'next + webpack',
        app: 'next',
        bundler: 'webpack',
        cwd: 'next',
        command: 'next',
        args: ['dev', '--webpack'],
        portFlag: 'argv',
        portArgs: hostPort('--hostname'),
        humanPort: 5870,
        testPort: 35312,
        readyMs: READY,
        injection: {
            crawl: true,
            match: 'any',
            includes: ['__IdeByebyeBootstrap', '__CODE_INTENT_INSPECTOR__'],
        },
        source: { crawl: true, match: 'all', includes: [STAMP, 'page.tsx:'] },
    },
    {
        id: 'C-14',
        title: 'nuxt + vite',
        app: 'nuxt',
        bundler: 'vite',
        cwd: 'nuxt',
        command: 'nuxt',
        args: ['dev'],
        portFlag: 'argv',
        portArgs: hostPort('--host'),
        humanPort: 5880,
        testPort: 35313,
        readyMs: READY,
        injection: { path: '/_nuxt/@vite/client', includes: [VITE_KEY] },
        source: { path: '/app/app.vue', includes: [STAMP, 'app.vue:'] },
    },
    {
        id: 'C-15',
        title: 'sveltekit + vite',
        app: 'sveltekit',
        bundler: 'vite',
        cwd: 'sveltekit',
        command: 'vite',
        args: ['dev', '--config', 'vite.config.js'],
        portFlag: 'argv',
        portArgs: hostPort('--host', ['--strictPort']),
        humanPort: 5890,
        testPort: 35314,
        readyMs: READY,
        injection: { path: '/@vite/client', includes: [VITE_KEY] },
        source: { path: '/src/lib/Ping.svelte', includes: [STAMP, 'Ping.svelte:'] },
    },
    {
        id: 'C-16',
        title: 'angular + cli',
        app: 'angular',
        bundler: 'cli',
        cwd: 'angular',
        command: 'ng',
        args: ['serve'],
        portFlag: 'argv',
        portArgs: hostPort('--host'),
        humanPort: 5900,
        testPort: 35315,
        readyMs: 180_000,
        injection: { session: true },
        source: { crawl: true, match: 'all', includes: ['debugInfo', 'app.ts'] },
    },
];

/**
 * Arguments for one launch. Env rows ignore `port` (the process reads `PORT` or the config default).
 * Argv rows append `portArgs(port)`. An argv row without `portArgs` throws.
 *
 * @param {object} row A {@link demos} entry.
 * @param {number} port Human port or test port.
 * @returns {string[]}
 */
export function launchArgs(row, port) {
    if (row.portFlag === 'argv')
        return row.args.concat(row.portArgs(port));
    return row.args.slice();
}

/**
 * Executable for a catalog `command`. `node` is this process; every other name is a demo bin.
 *
 * @param {string} demoDir Absolute `demo/` directory.
 * @param {string} command Catalog `command` (`node`, `vite`, `farm`, …).
 * @returns {string} Absolute executable path.
 */
export function commandBin(demoDir, command) {
    if (command === 'node')
        return process.execPath;
    return path.join(demoDir, 'node_modules', '.bin', command);
}
