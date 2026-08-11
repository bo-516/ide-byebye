import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'rolldown';
import { EMBEDDED_CLIENT_CODE_GLOBAL } from '../src/server/client-code.js';
import { createCssTemplateMinifyPlugin } from './client-css-minifier.js';

const ROOT_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const CLIENT_ENTRY = path.join(ROOT_DIR, 'src/client/boot/entry.js');
const SINGLE_FILE_ENTRY = path.join(DIST_DIR, 'code-intent-inspector.entry.tmp.js');
const CLIENT_OUTPUT_FILE = path.join(DIST_DIR, 'client.js');
const SINGLE_FILE_OUTPUT = path.join(DIST_DIR, 'code-intent-inspector.js');

/**
 * Legacy browser bundle path used before all generated artifacts moved under `dist`.
 *
 * Boundary: this path is deleted during builds only to prevent stale root-level `client.js` from masking
 * `dist/client.js`. Passing it to write helpers would recreate the deprecated artifact layout.
 *
 * @type {string} Absolute path to the old generated browser bundle.
 */
const LEGACY_CLIENT_OUTPUT_FILE = path.join(ROOT_DIR, 'client.js');

/**
 * Browser style modules whose CSS template exports should be compacted only in generated client artifacts.
 *
 * Boundary: these paths must stay absolute so Rolldown transform ids match. Adding a non-style module can compact an
 * unrelated template export and change runtime text, so only CSS-only template modules belong here.
 *
 * @type {string[]} Absolute source files for build-time CSS template minification.
 */
const CLIENT_CSS_TEMPLATE_MODULES = [
    path.join(ROOT_DIR, 'src/client/lib/style.js'),
    path.join(ROOT_DIR, 'src/client/dialog/dialog-reference-style.js'),
];

/**
 * Optional runtime packages that must stay external to the single-file plugin.
 *
 * Boundary: these dependencies are only required when their matching agent is enabled in the host project. Bundling
 * them would make default clipboard/file usage fail unless every optional SDK is installed.
 */
const OPTIONAL_AGENT_EXTERNALS = [
    '@anthropic-ai/claude-agent-sdk',
];

/**
 * Bundler-integration packages that must stay external to the single-file plugin.
 *
 * Boundary: `unplugin` and `code-inspector-plugin` are the multi-bundler runtime deps. `code-inspector-plugin` resolves
 * its own per-bundler sub-packages through dynamic requires, so inlining it into one file is fragile and huge. Keeping
 * them external means the single-file artifact still needs them installed (`npm i unplugin code-inspector-plugin`),
 * which npm consumers already get as declared dependencies.
 *
 * @type {string[]} Package names kept as external imports in the single-file Node bundle.
 */
const BUNDLER_RUNTIME_EXTERNALS = [
    'unplugin',
    'code-inspector-plugin',
];

/**
 * Native (napi) modules that cannot be inlined into the single-file bundle.
 *
 * Boundary: `oxc-parser` ships a platform-specific `.node` binary through optional deps. Bundling it
 * would produce a file that throws at import time on every platform. Keeping it external means the
 * single-file artifact needs `oxc-parser` installed, which npm consumers get as a declared dependency.
 *
 * @type {string[]} Package names kept as external imports in the single-file Node bundle.
 */
const NATIVE_MODULE_EXTERNALS = [
    'oxc-parser',
];

/**
 * Remove a generated file when it exists.
 *
 * Boundary: this helper only unlinks the exact file path passed to it. Passing a directory or an unrelated path will
 * either throw through `fs.unlink` or delete that file, so callers must supply only known build-temp paths.
 *
 * @param {string} file Absolute file path to remove.
 * @returns {Promise<void>} Resolves after the file is absent.
 */
async function removeIfExists(file) {
    try {
        await fs.unlink(file);
    }
    catch (err) {
        if (err?.code !== 'ENOENT') {
            throw err;
        }
    }
}

/**
 * Bundle the browser runtime into a self-contained script.
 *
 * Boundary: `src/client/boot/entry.js` must be browser-safe and must not rely on unresolved imports. If that entry is missing or
 * imports unsupported browser code, the single-file build fails before producing the Node plugin bundle. CSS template
 * exports from `CLIENT_CSS_TEMPLATE_MODULES` are compacted before JS minification. The generated `dist/client.js` is a
 * compatibility artifact for source-tree usage: comments are stripped by the bundler, and the file should not be
 * hand-edited.
 *
 * @returns {Promise<string>} JavaScript source for the bundled browser client.
 */
async function buildClientBundle() {
    await build({
        input: CLIENT_ENTRY,
        output: {
            file: CLIENT_OUTPUT_FILE,
            format: 'esm',
            minify: true,
            comments: false,
        },
        platform: 'browser',
        plugins: [createCssTemplateMinifyPlugin(CLIENT_CSS_TEMPLATE_MODULES)],
    });

    return fs.readFile(CLIENT_OUTPUT_FILE, 'utf8');
}

/**
 * Write the temporary Node entry that embeds the browser client.
 *
 * Boundary: the returned file is generated inside `dist` and imports the source `index.js`. Passing non-JavaScript
 * client text would still be embedded, but the served browser route would fail when Vite loads it.
 *
 * @param {string} clientCode Bundled browser client JavaScript.
 * @returns {Promise<string>} Absolute path to the generated temporary entry file.
 */
async function writeSingleFileEntry(clientCode) {
    const entry = [
        `import { EMBEDDED_CLIENT_CODE_GLOBAL } from '../src/server/client-code.js';`,
        `globalThis[EMBEDDED_CLIENT_CODE_GLOBAL] = ${JSON.stringify(clientCode)};`,
        `export { codeIntentInspectorPlugin } from '../index.js';`,
        `export { default } from '../index.js';`,
        '',
    ].join('\n');

    await fs.writeFile(SINGLE_FILE_ENTRY, entry, 'utf8');
    return SINGLE_FILE_ENTRY;
}

/**
 * Bundle the Node-side Vite plugin and embedded browser runtime into one compact ESM file.
 *
 * Boundary: Node built-ins remain external through `platform: "node"`. Optional agent SDKs,
 * bundler runtime packages, and native napi modules stay external via
 * `OPTIONAL_AGENT_EXTERNALS` / `BUNDLER_RUNTIME_EXTERNALS` / `NATIVE_MODULE_EXTERNALS`.
 * Output comments are stripped and code is minified; removing those externals can make the
 * bundle require optional packages even when their agents are disabled, or break on wrong platforms.
 *
 * @param {string} entry Absolute path to the temporary single-file entry.
 * @returns {Promise<void>} Resolves after `dist/code-intent-inspector.js` is written.
 */
async function buildPluginBundle(entry) {
    await build({
        input: entry,
        output: {
            file: SINGLE_FILE_OUTPUT,
            format: 'esm',
            minify: true,
            comments: false,
        },
        platform: 'node',
        external: [
            ...OPTIONAL_AGENT_EXTERNALS,
            ...BUNDLER_RUNTIME_EXTERNALS,
            ...NATIVE_MODULE_EXTERNALS,
        ],
    });
}

/**
 * Build the copy-friendly one-file inspector plugin.
 *
 * Boundary: this command writes generated artifacts under `dist` and removes the deprecated root-level `client.js`.
 * If any build step fails, temporary files are still cleaned up and the process exits non-zero through the caller's
 * unhandled rejection.
 *
 * @returns {Promise<void>} Resolves after the single-file artifact is ready.
 */
async function buildSingleFile() {
    await fs.mkdir(DIST_DIR, { recursive: true });
    await removeIfExists(LEGACY_CLIENT_OUTPUT_FILE);
    await removeIfExists(SINGLE_FILE_OUTPUT);

    try {
        const clientCode = await buildClientBundle();
        const entry = await writeSingleFileEntry(clientCode);
        await buildPluginBundle(entry);
    }
    finally {
        await removeIfExists(SINGLE_FILE_ENTRY);
    }

    console.log(`Built ${path.relative(ROOT_DIR, SINGLE_FILE_OUTPUT)}`);
}

await buildSingleFile();
