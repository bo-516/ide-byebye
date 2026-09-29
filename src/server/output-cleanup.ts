import fs from 'node:fs';
import path from 'node:path';
import { assertPathInsideRoot } from './security.js';
const LEGACY_LOG_ARTIFACTS = ['audit.log', 'requests'];

/**
 * Remove leftover log artifacts from an inspector output directory.
 *
 * Purpose: screenshots stay; `audit.log` and `requests` from older builds are deleted so the directory only keeps
 * files the current server still writes.
 * Boundary: each target must resolve inside `projectRoot`. A path that fails the guard, or a file that is already
 * gone, is skipped. Passing a directory outside the project deletes nothing.
 *
 * @param {string} outputDir Absolute inspector output directory.
 * @param {string} projectRoot Absolute project root used as the containment boundary.
 * @returns {void}
 */
export function cleanupNonScreenshotArtifacts(outputDir: string, projectRoot: string) {
    for (const name of LEGACY_LOG_ARTIFACTS) {
        const target = path.join(outputDir, name);
        try {
            assertPathInsideRoot(target, projectRoot);
            fs.rmSync(target, { recursive: true, force: true });
        }
        catch {
            // Best effort: stale logs should not block the inspector.
        }
    }
}
