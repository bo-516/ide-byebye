import fs from 'node:fs';
import path from 'node:path';
import { assertPathInsideRoot } from './security.js';
const LEGACY_LOG_ARTIFACTS = ['audit.log', 'requests'];
export function cleanupNonScreenshotArtifacts(outputDir, projectRoot) {
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
