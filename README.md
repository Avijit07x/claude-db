<img src="./assets/wordmark.svg" alt="claude-db" width="330">

**Free, open-source memory for Claude Code. Your own database, no cloud, no subscription.**

[![npm](https://img.shields.io/npm/v/claude-db.svg)](https://www.npmjs.com/package/claude-db)
[![CI](https://github.com/Avijit07x/claude-db/actions/workflows/ci.yml/badge.svg)](https://github.com/Avijit07x/claude-db/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

[Documentation](https://claude-db.vercel.app/docs) ·
[Quick start](https://claude-db.vercel.app/docs/quick-start) ·
[CLI reference](https://claude-db.vercel.app/docs/cli)

---

## Why

Every Claude Code chat starts from zero. You explain the same decisions, dead
ends and rules again, and Claude works out what calls what from scratch.

claude-db fixes that. It keeps what you decided and a map of your code, and
gives Claude the right part of it at the right time.

## What it does

- **Remembers across chats.** Decisions, dead ends and rules are saved when a
  chat ends, and the next chat starts by seeing them.
- **Recalls what fits.** Each prompt gets the one or two earlier memories that
  match it, and nothing when none fit.
- **Maps your code.** Who defines or calls a symbol is answered in one call,
  instead of grep and reading files.
- **Keeps it yours.** SQLite on your machine by default, or Postgres or MongoDB
  to share across machines. No cloud, no subscription.

## Install

You need Node 22.16 or newer and a git repository.

```bash
npm install -g claude-db
cd your-project
claude-db install --project
```

Restart Claude Code. There is nothing else to run, because capture and recall
are hooks.

Then load what already exists with `claude-db flush` and `claude-db scan`. The
[setup guide](./docs/setup-guide.md) has the rest.

## Everyday use

| Where                 | What it does                                      |
| --------------------- | ------------------------------------------------- |
| `/catchup`            | Answers "where did I stop?" when you come back    |
| `/handoff`            | Leaves a short note for the next chat or a mate   |
| `/cdb-scan`           | Maps an existing codebase into memory             |
| `claude-db status`    | Shows whether it is wired up and what it recorded |
| `claude-db doctor`    | Checks the setup, and finds what is wrong         |
| `claude-db use <url>` | Switches to Postgres or MongoDB (`pg`/`mongodb`)  |

`cdb` is a shorter alias. Every command is in the
[CLI reference](https://claude-db.vercel.app/docs/cli).

## Privacy

Memory stays in your own database. Two features call Claude Haiku through your
own login, and each has an off switch: `claude-db distill off` for making facts
from finished chats, and `claude-db pick off` for choosing memory per prompt.
Once a day it asks npm for the latest version (`"updates": "off"` stops that).

`.env`, `secrets/`, `node_modules` and `.git/` are never stored. Text inside
`<private>...</private>` is stripped, and API keys and tokens are redacted
before anything is written or sent.

## Documentation

- [Setup guide](./docs/setup-guide.md): install, head start and habits
- [Documentation site](https://claude-db.vercel.app/docs): CLI, MCP tools,
  databases and troubleshooting
- [With and without](./docs/with-and-without.md) and
  [benchmarks](https://claude-db.vercel.app/docs/benchmarks): the numbers,
  including where plain grep wins
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
