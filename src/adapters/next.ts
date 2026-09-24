/**
 * Next.js entry: `import withIdeByebye from 'ide-byebye/next'`.
 * Wraps `next.config` for `next dev` under Turbopack and webpack; the inspector mounts itself (App + Pages Router).
 */
export type { IdeByebyeOptions, NextIdeByebyeOptions } from '../types.js';
export { withIdeByebye, withIdeByebye as default } from '../server/next/with-next.js';
