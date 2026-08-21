# Contributing to claude-db

Thanks for being here. This guide covers how the project is built, the rules
that keep it small, and what a change needs before it can be merged.

Bug reports and small, focused pull requests are the most useful contributions.
For anything large, open an issue first so the design can be agreed before you
spend time on it.

## Requirements

- **Node >= 22.5.** Not negotiable: the default store uses `node:sqlite`, which
  is built in from that version. `postinstall` refuses to run on anything older.
- **git**, since `scan` reads tracked files through `git ls-files`.
- Nothing else. Postgres and MongoDB are optional and only needed if you work on
  those adapters.

## Getting set up

```bash
git clone https://github.com/Avijit07x/claude-db
cd claude-db
npm install
npm run build
```

The test suite imports from `dist/`, not `src/`, so **build before you test**
— including after every source change. `npm run dev` keeps `tsc -w` running if
you would rather not think about it.

To try your build against a real Claude Code session:

```bash
npm run build
node dist/cli/index.js install --project   # from the repo you want to track
```

Use the local `dist/` path rather than a global install while developing, so you
are exercising your own code. Undo it with `node dist/cli/index.js uninstall --project`.

## The commands

| command                | what it does                                                   |
| ---------------------- | -------------------------------------------------------------- |
| `npm run build`        | compile to `dist/` and copy assets                             |
| `npm run typecheck`    | `tsc --noEmit`, no output                                      |
| `npm test`             | the full suite: unit, local, filter, transcript, inject, smoke |
| `npm run unit`         | just the unit checks — fastest loop                            |
| `npm run smoke`        | end-to-end against SQLite; pass a URL to test another backend  |
| `npm run format`       | Prettier over everything                                       |
| `npm run format:check` | Prettier in check mode, writing nothing                        |

`npm run smoke postgres://user:pass@localhost:5432/memory` (or a
`mongodb://` URL) runs the same round trip against a real server, if you have
one to point at.

## Code conventions

**No comments.** The codebase carries none, deliberately. Explain a change in
the commit message, the changelog, or the pull request — not in the source. If a
piece of code needs a comment to be understood, that is a signal to rename
something or split the function.

**TypeScript, strict.** `strict`, `noUncheckedIndexedAccess`, and
`exactOptionalPropertyTypes` are all on. Optional properties are spread in
conditionally (`...(tags ? { tags } : {})`) rather than assigned `undefined`.

**ESM with explicit extensions.** Module resolution is `NodeNext`, so relative
imports end in `.js` even though the source is `.ts`.

**Small modules.** Most files sit between 40 and 200 lines. When one grows past
that, split it the way `src/mcp/tools/` and `src/cli/commands/` already are: a
thin dispatch module plus focused modules that each export one entry point.

**Formatting is Prettier's job.** 100 columns, single quotes, semicolons,
trailing commas. Run `npm run format` before committing.

## Where things live

| path           | holds                                                                     |
| -------------- | ------------------------------------------------------------------------- |
| `src/capture/` | transcripts to observations: extraction, classification, redaction, flush |
| `src/store/`   | one adapter interface, three backends (`sqlite/`, `mongo/`, `postgres/`)  |
| `src/search/`  | hybrid keyword + vector retrieval and ranking                             |
| `src/embed/`   | the built-in embedder and the optional local model                        |
| `src/graph/`   | the code graph: language specs, scanning, extraction, queries             |
| `src/hooks/`   | the four hook entry points Claude Code runs                               |
| `src/mcp/`     | the MCP server and its tools                                              |
| `src/cli/`     | the `claude-db` / `cdb` commands, install and uninstall                   |
| `scripts/`     | the test suite and benchmarks                                             |

## Tests

There is no test framework, and adding one is not wanted. Tests are plain `.mjs`
files that import from `dist/` and assert with a shared `check()` helper:

```js
import { check } from '../lib/check.mjs';

export default async function run() {
  check('a label that reads as a sentence', actual === expected, actual);
}
```

To add a unit test, create `scripts/unit/<name>.mjs` exporting a default
function, then register it in `scripts/unit.mjs` — both the import and the call.
Registration is explicit on purpose; there is no glob.

What a test should be:

- **Named as a claim**, not as a function name. `'a piped grep is output
filtering'` beats `'test symbolsGreppedIn 3'`.
- **Failing for one reason.** Pass the actual value as the third argument so a
  failure prints what it got.
- **Cheap.** The whole unit suite runs in seconds and should stay that way.

Every behavioural change needs a check that fails without it. Pure refactors
need the existing suite to stay green.

## Rules that are easy to miss

**All three adapters, always.** Any change to the store interface has to land in
`sqlite/`, `mongo/`, and `postgres/`. Local tests only cover SQLite — the
`adapters` CI job, which runs real Postgres and MongoDB services, is the _only_
verification the other two ever get. Wait for it before merging storage changes.

**Hooks must never break a session.** Everything in `src/hooks/` runs inside
`runHook`, which swallows errors and always exits 0. A memory layer that can
take down someone's session is worse than no memory layer. Hooks also run on a
latency budget: `PreToolUse` fires on every Bash call, so keep work off that
path unless it is genuinely needed.

**Measure before you claim.** Statements about behaviour need numbers behind
them, produced by replaying the real thing rather than a re-implementation of
it, with the accuracy limits stated alongside. "This should be faster" is not a
result; "1,932 replayed commands, 43 to 72 matches, method and caveats below"
is.

**Dependencies are a last resort.** The runtime dependency list is deliberately
short, and every entry has to earn its place against the standard library and
Node's built-ins. Backend drivers (`pg`, `mongodb`) and the local embedding
model are optional peer dependencies precisely so most users never install them.
A pull request adding a runtime dependency should say what it replaces and why a
few lines of our own would not do.

**Nothing leaves the machine.** No telemetry, no phone-home, no hosted service.
The only network calls are the update check against the npm registry and
whatever database URL the user configured themselves.

## Adding a language to the code graph

The graph is driven by small declarative specs, so a new language is usually a
short file rather than a project.

1. Add the grammar package: `npm install @ast-grep/lang-<language>`.
2. Create `src/graph/languages/<language>.ts` exporting a `LanguageSpec` — the
   node kinds that declare symbols and the node kinds that reference them.
   `python.ts` is the shortest example to copy.
3. Register it in `src/graph/languages/index.ts`: add it to `LANGUAGES`, and to
   `DYNAMIC_LANGUAGES` if the grammar ships as a separate package.
4. Bump `SCAN_VERSION` in `src/graph/scan/files.ts` so existing users reparse
   instead of being served a graph built by the old rules.
5. Add extraction checks with a small real-world snippet in the language.

To find the node kinds and field names a grammar exposes, parse a sample file
and print the tree — guessing at them wastes more time than the ten lines of
script it takes to look.

## Commits

Short prefix, imperative, one logical change:

```
feat: catch plain-word and git grep symbol lookups
fix: replace hook registrations on reinstall instead of stacking duplicates
docs: changelog for 0.7.0
refactor: name MCP tool handlers after their tools
chore: bump the ast-grep packages
```

**No trailers.** No `Co-Authored-By`, no "generated with" lines. The message
ends with the last line of the body.

Keep the diff to one concern. A feature, its changelog entry, and a version bump
are three commits, not one.

## Pull requests

Before opening one:

- [ ] `npm run typecheck` is clean
- [ ] `npm run build` succeeds
- [ ] `npm test` passes
- [ ] `npm run format:check` passes
- [ ] a check exists that fails without your change
- [ ] `CHANGELOG.md` has an entry, if the change is user-visible
- [ ] no comments were added to the code

In the description, say what changed and why, how you verified it, and what you
did _not_ cover. Numbers are welcome; guesses stated as facts are not.

CI runs on Ubuntu and macOS against Node 22 and 24, typechecks, builds, tests,
and installs the packed tarball to confirm it works as a real install. Storage
changes additionally need the `adapters` job green. Formatting is not enforced
by CI, so run `npm run format` yourself.

## Releases (maintainers)

- **Patch** (`0.7.1`): direct to `main`.
- **Minor** (`0.8.0`): branch `v0.8`, open a pull request, and wait for the
  `adapters` job before merging.

Either way:

1. The feature commits.
2. A separate `docs: changelog for 0.<minor>.0` commit — `CHANGELOG.md` only.
3. A separate version commit bumping **both** `package.json` and
   `package-lock.json`.
4. From `main`, an **annotated** tag: `git tag -a v0.8.0 -m "0.8.0"`. A
   lightweight tag is skipped silently by `git push --follow-tags`, which then
   reports "Everything up-to-date" and publishes nothing.
5. `git push --follow-tags`, which triggers `publish.yml`.

`publish.yml` refuses to publish when the tag and `package.json` disagree, so
confirm the version matches before pushing. npm burns a version string
permanently — a republish of the same version is rejected.

## Licence

By contributing, you agree that your contributions are licensed under the
[Apache License 2.0](./LICENSE), the same as the project.
