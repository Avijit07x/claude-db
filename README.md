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

You spent an hour yesterday explaining why the store has three adapters, which
approach you tried and dropped, and why one function must not be touched. Today
Claude knows none of it, so you explain it again.

claude-db gives Claude a memory that lasts, and a map of your code so it stops
working out what calls what from scratch.

## What you get

- **A memory that carries over.** When a chat ends, its decisions, dead ends and
  rules are saved as short facts, and the next chat starts by seeing them.
- **The right memory with each prompt.** Claude Haiku picks the one or two
  earlier memories that fit what you just asked. That costs about 20 tokens a
  prompt on average, and nothing on 69% of prompts.
- **A code graph.** Who defines or calls a symbol, answered in one call: 2.0x
  cheaper than grep and reading files, measured on eight real symbols.
- **Your own database.** SQLite by default, or Postgres or MongoDB to share
  memory across machines. No cloud, no subscription.

## Install

```bash
npm install -g claude-db

cd your-project
claude-db install --project
```

Restart Claude Code. Capture and recall are hooks, so there is nothing else to
run.

`--project` limits it to this repo instead of every project on the machine. Add
`.mcp.json` to your `.gitignore`, since it holds a path that only exists on your
machine.

A fresh install has no history yet. `claude-db scan` builds the code graph, and
the `/cdb-scan` skill maps an existing codebase into memory, so search has
something to find on day one. `/catchup` answers "where did I stop?" and `/handoff` leaves a note for the
next chat. The [setup guide](./docs/setup-guide.md) covers
the settings and habits that give the best results.

## Commands

`cdb` is a shorter alias for all of them.

| Command                         | What it does                                          |
| ------------------------------- | ----------------------------------------------------- |
| `claude-db install [--project]` | Register the hooks and the MCP server                 |
| `claude-db status`              | Is it wired up, and when did it last record anything  |
| `claude-db doctor [--deep]`     | Show the resolved config; `--deep` tests a round trip |
| `claude-db scan`                | Build the code graph for this repo                    |
| `claude-db use <url>`           | Switch database and verify it                         |
| `claude-db distill [on\|off]`   | Turn chats into facts with Haiku                      |
| `claude-db pick [on\|off]`      | Let Haiku pick the memory shown with each prompt      |
| `claude-db view`                | See this project's memory in the browser              |

Every other command, including `search`, `remember`, `sync` and `export`, is in
the [CLI reference](https://claude-db.vercel.app/docs/cli).

## Use another database

```bash
claude-db use "postgres://user:pass@host:5432/memory"
claude-db use "mongodb+srv://user:pass@cluster.mongodb.net/memory"
```

Install the driver first, with `npm install -g pg` or `npm install -g mongodb`.
Neither ships by default.

## Privacy

Memory stays in your own database. Three things use the network, and each has
an off switch:

- **When a chat ends**, its saved, redacted text is sent once to Claude Haiku
  through your own login, to make facts. Turn it off with `claude-db distill off`.
- **When a prompt has related memory**, the prompt, the end of Claude's last
  reply and up to ten saved excerpts go to Haiku, so it can pick what to show.
  Turn it off with `claude-db pick off`.
- **Once a day**, the npm registry is asked for the latest version. Turn it off
  with `"updates": "off"` in the config.

`.env`, `secrets/`, `node_modules` and `.git/` are never stored. Text inside
`<private>...</private>` is stripped, and API keys and tokens are redacted
before anything is written or sent.

## Requirements

Node 22.16 or newer. SQLite comes from Node's builtin `node:sqlite`, so nothing
compiles at install time. For real semantic search, run
`npm install -g @xenova/transformers` and the embedder upgrades itself.

## Documentation

- [Documentation site](https://claude-db.vercel.app/docs): the
  [CLI reference](https://claude-db.vercel.app/docs/cli),
  [MCP tools](https://claude-db.vercel.app/docs/mcp-tools),
  [how it works](https://claude-db.vercel.app/docs/how-it-works),
  [databases](https://claude-db.vercel.app/docs/databases) and
  [troubleshooting](https://claude-db.vercel.app/docs/troubleshooting)
- [Setup guide](./docs/setup-guide.md): settings, habits and costs
- [With and without](./docs/with-and-without.md) and
  [benchmarks](https://claude-db.vercel.app/docs/benchmarks): every number,
  including the symbols where plain grep wins
- [Changelog](./CHANGELOG.md)

## Contributing

```bash
npm install
npm run build
npm test
npm run lint
```

[CONTRIBUTING.md](./CONTRIBUTING.md) has the conventions, the test setup, how to
add a language to the code graph, and how releases are made. Security reports go
through [SECURITY.md](./SECURITY.md), privately.

## License

Apache-2.0
