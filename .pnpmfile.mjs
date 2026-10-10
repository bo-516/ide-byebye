/**
 * pnpm install hook.
 *
 * Purpose: the repo typechecks and builds with the native TypeScript 7 toolchain, which does not
 * ship the classic JS compiler API that `typescript-eslint` needs to parse sources. This hook
 * turns the `typescript` peer of the typescript-eslint packages (and `ts-api-utils`) into a real
 * dependency pinned to a classic TypeScript 5.x build, so ESLint gets a working parser while
 * `pnpm typecheck` / `pnpm build` keep using typescript@7. It also pins every `@typescript-eslint/*`
 * dependency of a typescript-eslint package to that package's own version: the family is released
 * in lockstep, and caret ranges would otherwise pull in siblings newer than the pinned
 * `typescript-eslint` devDependency.
 *
 * Boundary: runs only during `pnpm install`; affects lockfile resolution, not published output.
 *
 * @param {{ name?: string, version?: string, dependencies?: Record<string, string>, peerDependencies?: Record<string, string>, peerDependenciesMeta?: Record<string, unknown> }} pkg
 *   package.json manifest being resolved.
 * @returns {object} the mutated manifest.
 */
function readPackage(pkg) {
    const name = pkg.name;
    const peers = pkg.peerDependencies;
    const isTsEslintFamily = typeof name === 'string' && (name.startsWith('@typescript-eslint/') || name === 'typescript-eslint');
    const isTsEslint = isTsEslintFamily || name === 'ts-api-utils';
    if (isTsEslint && peers && typeof peers.typescript === 'string') {
        pkg.dependencies = { ...pkg.dependencies, typescript: 'npm:typescript@5.9.3' };
        delete peers.typescript;
        if (pkg.peerDependenciesMeta && pkg.peerDependenciesMeta.typescript) {
            delete pkg.peerDependenciesMeta.typescript;
        }
    }
    if (isTsEslintFamily && pkg.dependencies && typeof pkg.version === 'string') {
        for (const dep of Object.keys(pkg.dependencies)) {
            if (dep.startsWith('@typescript-eslint/'))
                pkg.dependencies[dep] = pkg.version;
        }
    }
    return pkg;
}

export const hooks = { readPackage };
