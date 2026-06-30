# AGENTS.md

## Structure & purity

- Prefer pure functions. Side effects (DOM, fs, network, globals) live at the edges, not inside logic.
- `shared/` must run unchanged in both browser and Node: no `window`, no `node:*`, no DOM. Cross-env helpers go here so client and server agree on one implementation.
- `server/` is Node-only and handles untrusted payloads from the page. Treat every request body as attacker-controlled.
- Split a file once it exceeds 200 lines; it MUST be split once it exceeds 400.

## Module conventions

- ESM only (`import`/`export`). No `require`, no CommonJS.
- Named exports by default;
- Reuse existing helpers (`shared/util.js`, `dialog-utils.js`, etc.) before writing a new one. Don't duplicate truncation, whitespace, locale, or path logic.

## Security (do not regress)

- Keep path-containment guards: any page-supplied file path must pass `assertPathInsideRoot` before being read. Never `fs` an unresolved path from the page.
- Keep the dev-token check on every privileged route; compare tokens in constant time.
- Never widen what the page can reach (arbitrary files, shell, env). If a change needs new server power, call it out explicitly.

## User-facing text & prompts

- Prompt text sent to an agent stays language-neutral and is built on the server — don't leak UI locale into it.

## Comments

- When you change a function / declared object / component, update its doc comment to match: purpose / responsibility / boundary, each parameter's meaning, the return value, and what breaks if an argument is omitted or wrong.
- Internal (non-exported) units need comments too.
- Comments explain *why* and *boundaries*, not a restatement of the code. Keep them English, matching the surrounding style.
