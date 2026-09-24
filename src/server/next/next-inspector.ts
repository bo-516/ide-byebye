/**
 * One inspector runtime per Next project per process, plus the bootstrap module(s) it keeps current.
 *
 * Purpose: Next may evaluate `next.config` more than once in the dev-server process; a process-global registry makes
 * every evaluation reuse the same token, loopback server and bootstrap file. The runtime's server is `unref()`ed, so
 * helper processes that also load the config (telemetry flush, typegen) are never kept alive by it.
 *
 * Boundary: a missing bootstrap module is created as a placeholder synchronously (so the import the loader adds always
 * resolves); an existing one is never downgraded. Once the server listens the live statement is written — unless the
 * current module still points at another live inspector for this project (a second `next dev` that Next is about to
 * reject, or a concurrent one on Next ≤ 15), in which case that working module is kept. Extra target files can be
 * registered (webpack reports the real project dir late); each follows the same rules.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_OUTPUT_DIR } from '../../shared/constants.js';
import { createInspectorRuntime } from '../plugin-runtime.js';
import { NEXT_BOOTSTRAP_FILE, isBootstrapServerAlive, readBootstrapClientSrc, writeBootstrapModule } from './bootstrap-module.js';

/** Registry slot on `globalThis`, shared by every copy of this module loaded in the process. */
const REGISTRY_KEY = Symbol.for('ide-byebye.next.inspectors');

/** Handle the config wrapper and loaders use. */
export interface NextInspector {
    runtime: ReturnType<typeof createInspectorRuntime>;
    root: string;
    /** Primary bootstrap module (`<root>/<outputDir>/next/bootstrap.js`). */
    bootstrapFile: string;
    /** Bootstrap module path for another project dir, written and kept in sync from now on. */
    bootstrapFileFor(projectDir: string): string;
}

/**
 * Get (or start) the inspector for a Next project root.
 *
 * @param {string} root Absolute project root (Next project dir) used for path guards, prompts and the output dir.
 * @param {object} options Plugin options (`IdeByebyeOptions`); only the first call per root is honored.
 * @returns {NextInspector} Shared handle for this process.
 */
export function getNextInspector(root: string, options: object): NextInspector {
    const registry: Map<string, NextInspector> = (globalThis as any)[REGISTRY_KEY] ??= new Map();
    const key = path.resolve(root);
    if (!registry.has(key))
        registry.set(key, startNextInspector(key, options));
    return registry.get(key);
}

/**
 * Create the runtime, write the placeholder bootstrap, and schedule the live rewrite.
 *
 * @param {string} root Absolute project root.
 * @param {Record<string, unknown>} options Plugin options.
 * @returns {NextInspector} New handle.
 */
function startNextInspector(root: string, options: object): NextInspector {
    const runtime = createInspectorRuntime(options);
    runtime.initPaths(root);
    // Relative output dir, reused under any extra project dir; an out-of-root / absolute outputDir falls back to default.
    const relativeOutput = path.relative(root, runtime.outputDirAbs());
    const outputDirName = relativeOutput && !relativeOutput.startsWith('..') && !path.isAbsolute(relativeOutput)
        ? relativeOutput
        : DEFAULT_OUTPUT_DIR;
    const targets = new Set<string>();
    let statement: string | null = null;

    /** Log a write failure without breaking config evaluation. */
    const warn = (file: string, err: unknown) => {
        console.warn(`[code-intent-inspector] could not write ${file}: ${err instanceof Error ? err.message : String(err)}`);
    };
    /** Synchronous part: make sure the import target exists (placeholder only when missing). */
    const ensureExists = (file: string) => {
        try {
            if (!fs.existsSync(file))
                writeBootstrapModule(file, null);
        }
        catch (err) {
            warn(file, err);
        }
    };
    /** Asynchronous part: write the live statement unless another live inspector already backs this module. */
    const syncLive = async (file: string) => {
        if (!statement)
            return;
        let current = null;
        try {
            current = readBootstrapClientSrc(fs.readFileSync(file, 'utf8'));
        }
        catch {
            // missing / unreadable → write below
        }
        if (current && current !== readBootstrapClientSrc(statement) && await isBootstrapServerAlive(current)) {
            console.info(`[code-intent-inspector] ${file} is served by another running inspector; leaving it as is`);
            return;
        }
        try {
            writeBootstrapModule(file, statement);
        }
        catch (err) {
            warn(file, err);
        }
    };
    const bootstrapFileFor = (projectDir: string) => {
        const file = path.join(path.resolve(projectDir), outputDirName, 'next', NEXT_BOOTSTRAP_FILE);
        if (!targets.has(file)) {
            targets.add(file);
            ensureExists(file);
            void syncLive(file);
        }
        return file;
    };

    const bootstrapFile = bootstrapFileFor(root);
    runtime.bootstrapStatement()
        .then(async (live) => {
            statement = live;
            await Promise.all([...targets].map(syncLive));
        })
        .catch((err) => {
            console.warn(`[code-intent-inspector] inspector server failed to start: ${err instanceof Error ? err.message : String(err)}`);
        });
    return { runtime, root, bootstrapFile, bootstrapFileFor };
}
