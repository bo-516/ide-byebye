// Source-tree usage. Real projects: `import withIdeByebye from 'ide-byebye/next'`.
import withIdeByebye from '../../dist/adapters/next.js';

/**
 * Next.js 16 App Router. One config covers `next dev` (Turbopack, port 5860)
 * and `next dev --webpack` (port 5870). The CLI passes `--hostname` and `--port`.
 */
export default withIdeByebye({});
