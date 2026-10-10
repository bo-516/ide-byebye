# AGENTS.md

## Structure & purity

- Prefer pure functions. Side effects (DOM, fs, network, globals) live at the edges, not inside logic.
- `src/shared/` must run unchanged in both browser and Node: no `window`, no `node:*`, no DOM. Cross-env helpers go here so client and server agree on one implementation.
- `src/server/` is Node-only and handles untrusted payloads from the page. Treat every request body as attacker-controlled.
- Split a file once it exceeds 200 lines; it MUST be split once it exceeds 400.

## Module conventions

- ESM only (`import`/`export`). No `require`, no CommonJS. The only exception is code emitted as a string for a CJS host (e.g. the VS Code bridge extension source).
- Named exports only. Use `export default` only where the host tool requires it (webpack / Next.js loaders).
- Reuse existing helpers (`src/shared/util.ts`, `src/client/dialog/dialog-utils.ts`, etc.) before writing a new one. Don't duplicate truncation, whitespace, locale, or path logic.

## Code style

- Declaration order: in one scope, declare every `const` before any `let`.
- No type-check bypass: no `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck`. Fix the type instead.
- New or changed code adds no `any` / `as any`. Use `unknown` plus narrowing, or a real type.
- Nest ternaries at most one level. Anything deeper becomes an early return, a lookup table, or a helper.
- No magic values: route paths, DOM attribute names, storage keys, timeouts, and limits are named `const`s with a doc comment. Values used by both client and server live in `src/shared/constants.ts`.

## Colors & styling

- Colors are defined only as `--cii-*` tokens in `src/client/lib/style-tokens.ts`, each with a light and a dark value. Everything else uses `var(--cii-*)`.
- No hex / `rgb()` / `hsl()` / named color literals outside `style-tokens.ts`. Exceptions: vendor brand marks (`agent-marks.ts`) and console `%c` styles.
- Need a new meaning? Add a new token; don't reuse one whose name means something else.
- Inline `el.style` is only for values computed at runtime (position, size, transform, visibility). Everything else goes through a class.
- Toggle conditional classes with `classList.toggle(cls, cond)`, not string concatenation.

## Security (do not regress)

- Keep path-containment guards: any page-supplied file path must pass `assertPathInsideRoot` before being read. Never `fs` an unresolved path from the page.
- Keep the dev-token check on every privileged route; compare tokens in constant time.
- Never widen what the page can reach (arbitrary files, shell, env). If a change needs new server power, call it out explicitly.
- `innerHTML` is only for clearing (`''`) or trusted static markup (`iconSvg`). Text that comes from the page, an agent, a session, or a file goes through `textContent` / `setAttribute`.

## User-facing text & prompts

- Prompt text sent to an agent stays language-neutral and is built on the server — don't leak UI locale into it.
- Every user-visible string goes through `t()` in `src/client/lib/i18n.ts`, with both `zh` and `en` entries. Brand names stay untranslated.

## Comments

- When you change a function / declared object / component, update its doc comment to match: purpose / responsibility / boundary, each parameter's meaning, the return value, and what breaks if an argument is omitted or wrong.
- Internal (non-exported) units need comments too. So do exported `const`s and module-level variables.
- Use the existing format: `Purpose` / `Boundary` prose, then `@param` / `@returns` / `@type`.
- Comments explain *why* and *boundaries*, not a restatement of the code. Keep them English, matching the surrounding style.

## Before committing

- `pnpm typecheck` is clean.
- `pnpm lint` is clean (ESLint enforces the `any` / `@ts-*` / named-export / 400-line rules above).
