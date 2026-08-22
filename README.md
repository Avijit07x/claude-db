<img src="./assets/wordmark.svg" alt="claude-db" width="330">

**Persistent memory for Claude Code. Bring your own database.**

[![npm](https://img.shields.io/npm/v/claude-db.svg)](https://www.npmjs.com/package/claude-db)
[![CI](https://github.com/Avijit07x/claude-db/actions/workflows/ci.yml/badge.svg)](https://github.com/Avijit07x/claude-db/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

[Documentation](https://claude-db.vercel.app/docs) ·
[Quick start](https://claude-db.vercel.app/docs/quick-start) ·
[CLI reference](https://claude-db.vercel.app/docs/cli)

---

## Every session starts from zero

You spent an hour yesterday explaining why the store uses three adapters, which
approach you already tried and abandoned, and why that one function must not be
touched. Today Claude knows none of it. So you explain it again.

claude-db fixes that, and the other half too. Claude re-derives your codebase
every time, grepping a name and opening files to work out what calls what.

```console
$ claude-db search "why does capture read the transcript"

83cf1246-eb14  decision  2026-08-19  Tested and written up.
    …the old defaults prompt was now cut why does capture read the transcript…
88fab24f-5e59  decision  2026-08-19  Finding 4's other half needs checking…
    …cannot work: 0.029483 "why does capture read…" <- highly relevant…
```

You never run that command. Claude gets the same context injected on every
prompt, so it walks in already knowing. Nothing leaves your machine.

## Install

```bash
npm install -g claude-db

cd your-project
claude-db install --project
```

Restart Claude Code. That's it: capture and recall are hooks, so they run
without being asked.

`--project` scopes to one repo instead of every project on the machine. It
writes `.claude/settings.local.json` and `.mcp.json`. Add `.mcp.json` to your
`.gitignore`, since it holds a machine-specific path.

## Map your code

Memory fills itself as you work. The code graph needs one command:

```bash
claude-db scan
```

Claude then gets four modes through MCP: `text` (a live grep, works with no
scan at all), `usages`, `explain` and `path`. Re-running `scan` is cheap: it
hashes files and re-parses only what changed.

TypeScript, TSX, JavaScript, Python, Go, Rust and Ruby are parsed properly, and
every other language — Java, C, C++, C#, Swift, Kotlin, PHP, Elixir, shell and
twenty more — is read by pattern, which finds declarations and name-matched
references tagged `INFERRED`. Nothing else to install either way.

## Use another database

SQLite by default, at `~/.claude-memory/memory.db`. No setup, no network. Point
it elsewhere to share memory across machines:

```bash
claude-db use "mongodb+srv://user:pass@cluster.mongodb.net/memory"
claude-db use "postgres://user:pass@host:5432/memory"
```

Install the driver you need (`npm install mongodb` or `pg`); neither ships by
default.

## With it, and without it

Asking _who defines and calls `closeObservations`_ by hand means a grep, then
opening three store adapters to see which hits are definitions. One `explain`
call answers it already classified: **2.1x cheaper**, measured across eight
real symbols in this repo.

Recall is the standing cost of ~180 tokens a prompt, skipped entirely on 28% of
prompts because the answer is already in context:

```
  every prompt costs      180 tokens of recall
  every lookup refunds    597 tokens   (1,115 by hand - 518 with)

  so one lookup pays for 3.3 prompts of recall
```

Check it on your own repo with `npm run bench:ab` and `npm run bench:tokens`
from a clone. [With and without](./docs/with-and-without.md) has every number,
including the symbols where plain grep wins.

## Commands

`cdb` is a shorter alias for all of them. These are the ones you actually type:

| Command                                  | What it does                                           |
| ---------------------------------------- | ------------------------------------------------------ |
| `claude-db install [--project]`          | Register hooks and the MCP server                      |
| `claude-db status`                       | Is it wired up, and when did it last record anything   |
| `claude-db doctor [--deep]`              | Resolved config; `--deep` proves a full round trip     |
| `claude-db scan [--force]`               | Build the code graph for this repo                     |
| `claude-db usages [--mode <m>] <symbol>` | What uses a symbol: live `git grep`, or the code graph |
| `claude-db use <url>`                    | Switch database and verify it                          |
| `claude-db view`                         | See this project's memory live in the browser          |

Every other command, including `search`, `remember`, `seed`, `sync`, `export`,
`prune` and `reset`, is in the [CLI reference](https://claude-db.vercel.app/docs/cli).

Install also adds a `/cdb-scan` skill: run it once on an existing project and
Claude maps the codebase into memory, so search has something to find before
you have any history.

## Requirements

Node 22.5 or newer. That's the only hard requirement: SQLite comes from Node's
builtin `node:sqlite`, so nothing compiles at install time.

Embeddings run locally with a zero-dependency embedder. For real semantic
search, `npm install @xenova/transformers` and it upgrades itself.

## Privacy

Nothing leaves your machine unless you point it at a remote database.
`.env`, `secrets/`, `node_modules` and `.git/` are never stored, text wrapped
in `<private>...</private>` is stripped, and API keys and tokens are redacted
before anything is written.

## Documentation

**[claude-db.vercel.app/docs](https://claude-db.vercel.app/docs)** has the rest:
the [CLI reference](https://claude-db.vercel.app/docs/cli),
[MCP tools](https://claude-db.vercel.app/docs/mcp-tools),
[how it works](https://claude-db.vercel.app/docs/how-it-works),
[databases](https://claude-db.vercel.app/docs/databases) and
[troubleshooting](https://claude-db.vercel.app/docs/troubleshooting).

[Benchmarks](https://claude-db.vercel.app/docs/benchmarks) has every number,
including the symbols where plain grep wins. Releases are in the
[changelog](./CHANGELOG.md).

## Development

```bash
npm install
npm run build
npm test      # 415 checks
npm run lint  # house rules: no comments, no any, import extensions
npm run try   # simulate a session, touches nothing
npm run format
```

Releases publish from CI on a version tag:

```bash
npm version patch
git push --follow-tags
```

[CONTRIBUTING.md](./CONTRIBUTING.md) has the conventions, the test setup, and
how to add a language to the code graph. Security reports go through
[SECURITY.md](./SECURITY.md), privately.

## License

Apache-2.0
