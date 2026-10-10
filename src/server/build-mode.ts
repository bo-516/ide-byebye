/**
 * Production-build detection for the bundlers whose plugin hooks run in both dev and build.
 *
 * Purpose: one answer to "is this a production build?" so the inspector adapter (bootstrap injection + loopback
 * server) and the stamp adapter (`data-insp-path`) of the same bundler never disagree. A production bundle must not
 * carry the bootstrap, the dev token, or absolute source paths.
 *
 * Boundary: only esbuild and Farm route through here. Vite (`apply: 'serve'`) and webpack / rspack
 * (`compiler.options.mode`) carry their own mode; rsbuild reads `NODE_ENV` through {@link isProductionNodeEnv};
 * Next.js and Mako require `NODE_ENV === 'development'` instead.
 */

/**
 * The `NODE_ENV` / Farm `compilation.mode` value that marks a production build.
 *
 * @type {'production'}
 */
const PRODUCTION_MODE = 'production';

/**
 * esbuild `define` key that production configs set when they leave `process.env.NODE_ENV` itself unset.
 *
 * @type {string}
 */
const NODE_ENV_DEFINE_KEY = 'process.env.NODE_ENV';

/**
 * Whether the process environment says production.
 *
 * @param {Record<string, string | undefined>} [env=process.env] Environment to read. Omitted, the live
 *   `process.env` is read on every call, so a value set after plugin construction still counts.
 * @returns {boolean} `true` only for `NODE_ENV=production`.
 */
export function isProductionNodeEnv(env: Record<string, string | undefined> = process.env): boolean {
    return env.NODE_ENV === PRODUCTION_MODE;
}

/**
 * Whether an esbuild build is a production build.
 *
 * Purpose: esbuild has no mode of its own. Production setups either export `NODE_ENV=production` or inline it with
 * `define: { 'process.env.NODE_ENV': '"production"' }`; either one means the output ships.
 *
 * @param {{ define?: Record<string, string> | null }} initialOptions esbuild `build.initialOptions`. A missing
 *   `define` falls back to `env` alone.
 * @param {Record<string, string | undefined>} [env=process.env] Environment to read.
 * @returns {boolean} `true` when `NODE_ENV` or the `define` names production.
 */
export function isEsbuildProductionBuild(initialOptions: { define?: Record<string, string> | null }, env: Record<string, string | undefined> = process.env): boolean {
    if (isProductionNodeEnv(env))
        return true;
    // esbuild `define` values are JSON source text, so the string `production` arrives as `"production"`.
    return initialOptions.define?.[NODE_ENV_DEFINE_KEY]?.trim() === JSON.stringify(PRODUCTION_MODE);
}

/**
 * Whether a resolved Farm config is a production build (`farm build`, or `compilation.mode: 'production'`).
 *
 * Boundary: Farm 1.7 resolves `compilation.mode` and copies it to `NODE_ENV` before `configResolved`, so the config
 * is the authority. A config without `compilation` (test doubles, foreign callers) is treated as dev.
 *
 * @param {{ compilation?: { mode?: string | null } | null } | null | undefined} config Farm resolved config.
 * @returns {boolean} `true` for `compilation.mode === 'production'`.
 */
export function isFarmProductionBuild(config: { compilation?: { mode?: string | null } | null } | null | undefined): boolean {
    return config?.compilation?.mode === PRODUCTION_MODE;
}
