/**
 * Public TypeScript types for `ide-byebye`.
 *
 * Boundary: these mirror the documented plugin options. Runtime still normalizes invalid values;
 * the types describe the intended config surface for editors and `tsc`. Built into published `.d.ts`
 * via `declaration: true` — do not reintroduce hand-written root declaration files.
 *
 * The declarations live in `./types/` by domain; this barrel keeps the historical `./types.js`
 * import path stable.
 */

export type * from './types/primitives.js';
export type * from './types/agents.js';
export type * from './types/options.js';
