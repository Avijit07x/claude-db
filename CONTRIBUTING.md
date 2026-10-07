# Contributing to claude-db

Thanks for helping. Bug reports and small, focused pull requests help most. For anything large, open an
issue first, so the design is agreed before you spend time on it.

## Set up

You need Node 22.16 or newer and git. Postgres and MongoDB are only needed to work on those stores.

```bash
git clone https://github.com/Avijit07x/claude-db
cd claude-db
npm install
npm run build
```

Tests run against `dist/`, so build after every change. `npm run dev` rebuilds on save.

To try your build in a real Claude Code session, run this in the repository you want to track, and undo it
with `uninstall --project`:

```bash
node /path/to/claude-db/dist/cli/index.js install --project
```

## Everyday commands

| Command          | What it does                      |
| ---------------- | --------------------------------- |
| `npm run build`  | Compile to `dist/`                |
| `npm run unit`   | The unit checks, the fastest loop |
| `npm test`       | The full suite                    |
| `npm run lint`   | House rules and ESLint            |
| `npm run format` | Prettier over everything          |

The others, such as `typecheck`, `knip`, `coverage`, `smoke` and `bench:usages`, are in `package.json`.

## Where things live

| Path           | Holds                                                                  |
| -------------- | ---------------------------------------------------------------------- |
| `src/capture/` | Chats to saved memory: extraction, redaction, flush                    |
| `src/store/`   | One store interface, three backends (`sqlite/`, `mongo/`, `postgres/`) |
| `src/search/`  | Keyword and vector search, and ranking                                 |
| `src/embed/`   | The built-in embedder and the optional local model                     |
| `src/graph/`   | The code graph: languages, scanning, queries                           |
| `src/hooks/`   | The hooks Claude Code runs                                             |
| `src/mcp/`     | The MCP server and its tools                                           |
| `src/cli/`     | The `claude-db` and `cdb` commands                                     |
| `scripts/`     | Tests and benchmarks                                                   |

## Rules

- **No comments in code.** Explain a change in the commit message or the pull request. If code needs a
  comment, rename or split it instead.
- **Strict TypeScript and ESM.** Relative imports end in `.js`. Optional properties are spread in
  (`...(tags ? { tags } : {})`), never set to `undefined`.
- **Small files.** Most are 40 to 200 lines. Split a bigger one into focused modules.
- **Hooks never break a session.** Hook code runs inside `runHook`, which catches every error.
  `PreToolUse` runs on every Bash call, so keep it fast.
- **All three stores.** A store change goes into `sqlite/`, `mongo/` and `postgres/`. Only the `adapters`
  CI job tests the last two; `npm run smoke <postgres:// or mongodb:// URL>` tries one locally.
- **Few dependencies.** A pull request that adds one says what it replaces and why our own code would not do.
- **Nothing leaves the machine.** No telemetry. The only network calls are the update check and the
  database the user chose.
- **Measure before you claim.** A claim about behaviour needs numbers from the real thing.

## Tests

There is no test framework. A test is a plain `.mjs` file that imports from `dist/`:

```js
import { check } from '../lib/check.mjs';

export default async function run() {
  check('a piped grep is output filtering', actual === expected, actual);
}
```

Add it as `scripts/unit/<name>.mjs` and register it in `scripts/unit.mjs`. Name each check as a claim, pass
the actual value last so a failure shows it, and keep it fast. Every change in behaviour needs a check that
fails without it. Code graph tests are fixture files, see [Adding a language](./docs/adding-a-language.md).

## Commits and pull requests

A commit is one change with a short prefix: `feat:`, `fix:`, `docs:`, `refactor:` or `chore:`, then an
imperative line, such as `fix: replace hook registrations on reinstall`. No `Co-Authored-By` or "generated
with" lines.

Before you open a pull request:

- [ ] `npm run typecheck`, `npm run build` and `npm test` pass
- [ ] `npm run lint`, `npm run knip` and `npm run format:check` are clean
- [ ] a check fails without your change
- [ ] examples are invented, and `npm run check:fixtures -- --local` shows nothing of yours
- [ ] `CHANGELOG.md` has an entry, if users will notice the change

In the description, say what changed, how you checked it, and what you did not cover. CI runs the suite on
Ubuntu and macOS with Node 22 and 24.

## More

- [Adding a language to the code graph](./docs/adding-a-language.md)
- [Releasing](./docs/releasing.md), for maintainers

## Licence

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](./LICENSE),
the same as the project.
