/**
 * Bundler adapters for the stamp transform.
 *
 * Purpose: Vite, Farm, webpack, rspack, rsbuild, and esbuild share one unplugin. Mako only accepts
 * `{ name, enforce, transform }`, so it gets a small wrapper. esbuild 0.28 has no `onTransform`,
 * so that adapter loads the file itself and returns stamped contents.
 *
 * Boundary: stamping follows the same switch as bootstrap injection. `sourceStamp: false` and
 * `enabled: false` return the original source. Vite `apply: 'serve'` keeps production builds clean.
 * esbuild also skips `NODE_ENV=production`, and skips `node_modules` unless `include` matches.
 * The Vite order warning fires once when a framework plugin is registered before this one.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createUnplugin } from 'unplugin';
import type { IdeByebyeOptions } from '../../types.js';
import { isUnincludedNodeModule, stampModule, type StampFamily } from './stamp-module.js';
import { resolveStampOptions, type ResolvedStampOptions } from './stamp-options.js';

export const STAMP_NAME = 'ide-byebye:stamp';

const ID_FILTER = /\.(?:jsx|tsx|js|mjs|ts|mts|vue|svelte|html)(?:\?.*)?$/;
const ESBUILD_FILTER = /\.(?:jsx|tsx|js|mjs|ts|mts)$/;

/** Framework plugins that compile JSX / SFC markup and therefore must run after stamping. */
const FRAMEWORKS = [
    { name: 'vite:react-babel', pkg: '@vitejs/plugin-react' },
    { name: 'vite:react-swc', pkg: '@vitejs/plugin-react-swc' },
    { name: 'vite:react-oxc:config', pkg: '@vitejs/plugin-react-oxc' },
    { name: 'solid', pkg: 'vite-plugin-solid' },
    { name: 'vite-plugin-qwik', pkg: 'qwikVite' },
    { name: 'vite-plugin-qwik-city', pkg: 'qwikCity' },
    { name: 'vite-plugin-qwik-react', pkg: 'qwikReact' },
    { name: 'vite:preact-jsx', pkg: '@preact/preset-vite' },
    { name: 'vite-plugin-svelte', pkg: '@sveltejs/vite-plugin-svelte' },
];

let orderWarned = false;

/**
 * Allow the Vite plugin-order warning to fire again. Tests only; production keeps the once-per-process flag.
 *
 * @returns {void}
 */
export function resetVitePluginOrderWarning() {
    orderWarned = false;
}

/**
 * unplugin instance. `vite` / `farm` / `webpack` / `rspack` / `esbuild` each call the factory
 * with their framework name so Vue subrequests are classified correctly.
 */
export const stampUnplugin = createUnplugin((options: IdeByebyeOptions = {}, meta: { framework?: string } = {}) => {
    const resolved = resolveStampOptions(options, (message) => console.warn(message));
    const framework = meta.framework ?? '';
    if (framework === 'esbuild') {
        return {
            name: STAMP_NAME,
            enforce: 'pre' as const,
            esbuild: {
                setup(build) {
                    installEsbuild(build, options, resolved);
                },
            },
        };
    }
    return {
        name: STAMP_NAME,
        enforce: 'pre' as const,
        transform: {
            filter: { id: ID_FILTER },
            handler(code: string, id: string) {
                if (options?.enabled === false || !resolved.enabled)
                    return null;
                return stampModule({
                    code,
                    id,
                    family: familyOf(framework),
                    options: resolved,
                    warnOnce: (_key, message) => console.warn(message),
                });
            },
        },
        vite: {
            apply: 'serve' as const,
            configResolved(config) {
                warnIfAfterFramework(config?.plugins);
            },
        },
    };
});

/**
 * Mako plugin. Same shape code-inspector returned: `{ name, enforce, transform }`.
 * Active only when `NODE_ENV === 'development'`, matching Mako's dev server.
 *
 * @param {IdeByebyeOptions} [options] Plugin options.
 * @returns {{ name: string, enforce: 'pre', transform: Function }}
 */
export function createMakoStampPlugin(options: IdeByebyeOptions = {}) {
    const resolved = resolveStampOptions(options, (message) => console.warn(message));
    return {
        name: STAMP_NAME,
        enforce: 'pre' as const,
        transform(code: string, id: string) {
            if (process.env.NODE_ENV !== 'development' || options?.enabled === false || !resolved.enabled)
                return null;
            return stampModule({
                code,
                id,
                family: 'rollup',
                options: resolved,
                warnOnce: (_key, message) => console.warn(message),
            });
        },
    };
}

/**
 * @param {string} framework unplugin meta framework.
 * @returns {StampFamily} `webpack` for compiler pipelines, `rollup` for in-process transforms.
 */
function familyOf(framework: string): StampFamily {
    return framework === 'webpack' || framework === 'rspack' || framework === 'rsbuild' ? 'webpack' : 'rollup';
}

/**
 * Load and stamp esbuild inputs. Returning null lets esbuild read the file itself.
 *
 * `node_modules` returns null before the read unless `include` matches that path or its query.
 * A bad include pattern falls through so {@link stampModule} can fail open.
 *
 * @param {object} build esbuild plugin build object.
 * @param {IdeByebyeOptions} options Raw options; `enabled: false` skips every file.
 * @param {ResolvedStampOptions} resolved Stamp switch from {@link resolveStampOptions}.
 * @returns {void}
 */
function installEsbuild(build, options: IdeByebyeOptions, resolved: ResolvedStampOptions) {
    build.onLoad({ filter: ESBUILD_FILTER }, async (args) => {
        if (process.env.NODE_ENV === 'production' || options?.enabled === false || !resolved.enabled)
            return null;
        const id = `${args.path || ''}${args.suffix || ''}`;
        try {
            if (isUnincludedNodeModule(String(args.path || ''), id, resolved.include))
                return null;
        }
        catch {
            // stampModule warns once and returns null for the same bad pattern.
        }
        let code: string;
        try {
            code = await fs.promises.readFile(args.path, 'utf8');
        }
        catch {
            return null;
        }
        const stamped = stampModule({
            code,
            id: `${args.path}${args.suffix || ''}`,
            family: 'rollup',
            options: resolved,
            warnOnce: (_key, message) => console.warn(message),
        });
        if (stamped == null)
            return null;
        return { contents: stamped, loader: esbuildLoader(args.path) };
    });
}

function esbuildLoader(file: string) {
    const ext = path.extname(file).toLowerCase();
    if (ext === '.tsx')
        return 'tsx';
    if (ext === '.jsx')
        return 'jsx';
    if (ext === '.ts' || ext === '.mts')
        return 'ts';
    return 'js';
}

function warnIfAfterFramework(plugins) {
    if (orderWarned || !Array.isArray(plugins))
        return;
    const mine = plugins.findIndex((plugin) => plugin?.name === STAMP_NAME);
    if (mine < 0)
        return;
    for (const framework of FRAMEWORKS) {
        const index = plugins.findIndex((plugin) => plugin?.name === framework.name);
        if (index !== -1 && index < mine) {
            orderWarned = true;
            console.warn(`[code-intent-inspector] put inspector() before ${framework.pkg} so source stamps run before the framework transform`);
            return;
        }
    }
}
