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

```bash
npm install -g claude-db

cd your-project
claude-db install --project
```

Restart Claude Code. That's it.

## How it works

Claude Code already writes every session to disk as JSONL — your prompts, its
replies, every tool call. claude-db reads that file, so it captures **why** you
did something, not just which files changed.

```
you send a prompt
      │
      ├─ 1. save the previous turn
      │     read new lines from the session transcript
      │     keep turns that changed something
      │     store title + reasoning + files, with an embedding
      │
      └─ 2. search memory using your prompt
            inject the best match above your message
```

Both steps are hooks, so they always run. Nothing depends on Claude deciding to
look something up.

Install also writes a short standing instruction into `CLAUDE.local.md` (or
`~/.claude/CLAUDE.md` for a machine-wide install), telling Claude to search
memory before asking you to re-explain something. Hook output is context the
agent may or may not act on; a memory file is a rule for the whole session,
which is what makes recall the default rather than something you have to ask
for. `claude-db uninstall` takes the block back out.

**What gets saved.** One observation per turn, and only if that turn edited a
file or ran a real command. Questions, `grep`, and "ok" are skipped. A busy day
produces 10 to 20 rows, not hundreds.

**What gets injected.** Recent session summaries at startup, plus the single
best match in full on each prompt. Roughly 350 tokens when something relevant
exists, zero when it doesn't.

**What search returns.** An id, kind, date, title and one line of the matching
body — enough to tell two similarly-titled rows apart without expanding either.
Full bodies come only from `get_observations`, for ids you picked.

An example of one stored memory:

```
[decision] Chose WebSocket over polling for live order updates

Asked: the order feed keeps dropping

Polling at 3s hammered the API and still lagged behind. Switched to a
WebSocket subscription with exponential backoff and a replay flag, so no
order is missed during a drop.

Files: src/ws/client.ts, src/ws/reconnect.ts
Ran: Test run: pnpm test
```

## Commands

`cdb` is a shorter alias for all of them.

| Command | What it does |
| --- | --- |
| `claude-db install [--project]` | Register hooks and the MCP server |
| `claude-db uninstall [--project]` | Remove them, keeping your memory |
| `claude-db status` | Is it wired up, and when did it last record anything |
| `claude-db doctor [--deep]` | Resolved config; `--deep` proves a full round trip |
| `claude-db search [--all] [--tag <name>] <query>` | Search this project's memory, or every project |
| `claude-db remember [--key <name>] <text>` | Record a rule outright, e.g. "always use pnpm here" |
| `claude-db forget <id>` | Delete specific observations by id |
| `claude-db seed --from-git` | Fill a cold memory from this repo's history |
| `claude-db stats` | What this project's memory is made of |
| `claude-db projects` | Every project with memory stored |
| `claude-db merge [<path>]` | Move memory from an old project path onto this one |
| `claude-db use <url>` | Switch database and verify it |
| `claude-db sync <url>` | Two-way merge with another database |
| `claude-db flush` | Re-ingest every transcript for this project |
| `claude-db export [--all]` | Dump memory as JSONL, for backup or migration |
| `claude-db import <file>` | Load a dump back in; safe to repeat |
| `claude-db reembed` | Re-embed everything with the current model |
| `claude-db prune --older-than <days>` | Delete old memory (dry run without `--yes`) |
| `claude-db reset [--project] --yes` | Delete memory (dry run without `--yes`) |

Install also adds a `/cdb-scan` skill: run it once on an existing project and
Claude surveys the codebase into memory — stack, layout, conventions,
workflows — so search has something to find before you have any history. Those
notes are tagged `inferred`, because they are a reading of the code rather than
a record of what happened.

`--project` scopes to one repo instead of every project on the machine. It
writes `.claude/settings.local.json` and `.mcp.json` — add `.mcp.json` to your
`.gitignore`, since it holds a machine-specific path.

## Bring your own database

SQLite by default, at `~/.claude-memory/memory.db`. No setup, no network.

Only needed if you want memory shared across machines:

```bash
claude-db use "mongodb+srv://user:pass@cluster.mongodb.net/memory"
claude-db use "postgres://user:pass@host:5432/memory"
```

The connection string picks the backend. Install the driver you need
(`npm install mongodb` or `pg`); neither ships by default. `CLAUDE_DB_URL`
overrides the config file if you prefer an env var.

Search is hybrid — keyword plus vector — on all three. Memory is partitioned by
project path, so one database serves every repo you work in.

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

## Development

```bash
npm install
npm run build
npm test      # 87 checks
npm run try   # simulate a session, touches nothing
```

Releases publish from CI on a version tag:

```bash
npm version patch
git push --follow-tags
```

## License

Apache-2.0
