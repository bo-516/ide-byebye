# Contributing

Thanks for helping out. Bug reports, support for another framework, build tool
or agent, and docs fixes are all welcome.

## Reporting a bug

Open an issue with the **Bug report** template. These details help most:

- ide-byebye version, build tool and framework (with versions), agent, OS and browser.
- What you clicked, the prompt you got, and the prompt you expected. The ⧉
  button in the dialog copies the exact prompt.
- A small reproduction. A copy of one of the [demo apps](./demo) with your
  change is the quickest to debug.

For a feature or a new agent / build tool, open an issue first so we can agree
on the approach before you write code.

## Setup

You need Node.js 22.13+ and pnpm 11 (pinned in `packageManager`; Corepack or
pnpm 10 switches to it).

```sh
pnpm install
pnpm build
pnpm test:unit   # unit tests
pnpm test        # unit tests + the demo matrix (installs demo deps on first run)
```

To try a change in a real app, use the playground in [`demo/`](./demo): run
`pnpm install` and then a `pnpm dev:*` script inside `demo/`
([`demo/README.md`](./demo/README.md) lists them all). The demo configs load
`../../dist`, so run `pnpm build` after changing `src/`. Rebuilding restarts
any demo dev server that is running.

## Where things live

| Path | What it is |
| --- | --- |
| `src/adapters/` | One entry per build tool (`ide-byebye/vite`, `ide-byebye/rspack`, …) |
| `src/server/` | Node side: source stamping, the local `127.0.0.1` server, agent launchers |
| `src/client/` | The in-page picker and dialog, bundled into `dist/client.js` |
| `src/shared/` | Code that runs unchanged in both the browser and Node |
| `demo/` | Playground apps and the cross-framework matrix test |

## Pull requests

- Keep one topic per PR. Say what changed and how you checked it (which demo,
  which build tool, which agent).
- Run `pnpm lint`, `pnpm typecheck` and `pnpm test:unit` before pushing. CI runs
  the same checks, plus the unit tests on Node 20.19.
- Add or update tests next to the code (`*.test.ts`, Node's built-in test runner).
- Follow [AGENTS.md](./AGENTS.md). It is written for coding agents, but its
  style, security and comment rules apply to every change.
- Every user-visible string goes through `t()` with both `en` and `zh` text.
- Keep `README.md` / `README.zh-CN.md` and `CONFIGURATION.md` /
  `CONFIGURATION.zh-CN.md` in sync. Option details belong in CONFIGURATION, not
  in the README.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`, `chore:` …).

## Security

The plugin runs a local server that a web page can talk to, so security bugs
matter here: for example, a page reading files outside the project, or getting
past the dev token. Please don't report them in a public issue. Email
516342558@qq.com instead.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](./LICENSE).
