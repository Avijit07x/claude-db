<img src="./assets/wordmark.svg" alt="claude-db" width="330">

**Persistent memory for Claude Code. Bring your own database.**

[![npm](https://img.shields.io/npm/v/claude-db.svg)](https://www.npmjs.com/package/claude-db)
[![CI](https://github.com/Avijit07x/claude-db/actions/workflows/ci.yml/badge.svg)](https://github.com/Avijit07x/claude-db/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

---

## What it is

Claude Code forgets everything when a session ends. Next time you open it, you
re-explain the architecture, why you chose X over Y, and what already failed.

claude-db records those decisions as you work and gives them back
automatically. Local by default, no account, no subscription.

It also maps your code: `claude-db scan` builds a graph of every symbol and how
they connect, so "what breaks if I change this" is a query instead of a grep.

## Install

```bash
npm install -g claude-db

cd your-project
claude-db install --project
```

Restart Claude Code. That's it — capture and recall are hooks, so they run
without being asked.

`--project` scopes to one repo instead of every project on the machine. It
writes `.claude/settings.local.json` and `.mcp.json` — add `.mcp.json` to your
`.gitignore`, since it holds a machine-specific path.

## Map your code

```bash
claude-db scan

claude-db usages --mode explain resolveProject
claude-db usages --mode path cmdScan observationId
```

Claude gets the same four modes through MCP: `text` (a live grep, no scan
needed), `usages`, `explain` and `path`. Answers re-check the working tree
before replying, so they never report a line the source has moved past.

Works out of the box on TypeScript, TSX, JavaScript, Python, Go and Rust — the
parser ships with the package, so there is nothing else to install.

## Use another database

SQLite by default, at `~/.claude-memory/memory.db`. No setup, no network. Point
it elsewhere to share memory across machines:

```bash
claude-db use "mongodb+srv://user:pass@cluster.mongodb.net/memory"
claude-db use "postgres://user:pass@host:5432/memory"
```

Install the driver you need (`npm install mongodb` or `pg`); neither ships by
default.

## Commands

`cdb` is a shorter alias for all of them.

| Command                                           | What it does                                           |
| ------------------------------------------------- | ------------------------------------------------------ |
| `claude-db install [--project]`                   | Register hooks and the MCP server                      |
| `claude-db uninstall [--project]`                 | Remove them, keeping your memory                       |
| `claude-db status`                                | Is it wired up, and when did it last record anything   |
| `claude-db doctor [--deep]`                       | Resolved config; `--deep` proves a full round trip     |
| `claude-db search [--all] [--tag <name>] <query>` | Search this project's memory, or every project         |
| `claude-db remember [--key <name>] <text>`        | Record a rule outright, e.g. "always use pnpm here"    |
| `claude-db forget <id>`                           | Delete specific observations by id                     |
| `claude-db seed --from-git`                       | Fill a cold memory from this repo's history            |
| `claude-db scan [--force]`                        | Build the code graph for this repo                     |
| `claude-db usages [--mode <m>] <symbol>`          | What uses a symbol: live `git grep`, or the code graph |
| `claude-db stats`                                 | What this project's memory is made of                  |
| `claude-db projects`                              | Every project with memory stored                       |
| `claude-db merge [<path>]`                        | Move memory from an old project path onto this one     |
| `claude-db use <url>`                             | Switch database and verify it                          |
| `claude-db sync <url>`                            | Two-way merge with another database                    |
| `claude-db flush`                                 | Re-ingest every transcript for this project            |
| `claude-db export [--all]`                        | Dump memory as JSONL, for backup or migration          |
| `claude-db import <file>`                         | Load a dump back in; safe to repeat                    |
| `claude-db reembed`                               | Re-embed everything with the current model             |
| `claude-db prune --older-than <days>`             | Delete old memory (dry run without `--yes`)            |
| `claude-db reset [--project] --yes`               | Delete memory (dry run without `--yes`)                |

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

- [How it works](./docs/how-it-works.md) — what gets captured and injected, how
  the code graph is built and kept current, and how the database backends differ
- [Changelog](./CHANGELOG.md)

## Development

```bash
npm install
npm run build
npm test      # 263 checks
npm run try   # simulate a session, touches nothing
npm run format
```

Releases publish from CI on a version tag:

```bash
npm version patch
git push --follow-tags
```

## License

Apache-2.0
