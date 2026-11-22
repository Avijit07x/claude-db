# Plan: keep or remove the daemon (item 4.1)

Status: measured on SQLite. The decision waits for the owner: is the daemon used with a remote Postgres?

## Measured

On SQLite in a temp home, with 400 rows, 50 facts and a 30-file graph, over 25 runs (milliseconds):

| Hook          | Daemon off, median | Daemon on and warm, median |
| ------------- | ------------------ | -------------------------- |
| session-start | 127                | 41                         |
| user-prompt   | 142                | 45                         |
| turn-end      | 79                 | 32                         |
| prefer-usages | 117                | 40                         |

- The saving is module loading and opening the store. The default embedder loads no model.
- The daemon holds 78 to 112 MB of memory.
- On a remote Postgres, its own commit (a689313) measured a further 0.3 to 0.5 s per hook for the TLS
  connection. That was not measured here.

## Cost

- About 510 source lines: `src/daemon/`, the route, local and run layers, `cli/commands/daemon.ts` and the
  worker env plumbing. Plus 225 test lines.
- 6 fix commits since 0.13.0.
- Four open bugs, all checked in the code:
  - **A hung daemon blocks a hook** for 8 s (prefer-usages) to 50 s (session-start), with no local fallback
    (`src/hooks/route.ts:6-19`).
  - **The daemon's own environment is used** for Haiku calls and the chat-log folder (`src/util/claude-cli.ts:112-117`,
    `src/util/claude-dir.ts:5`).
  - **A failed embedder load is cached as a no-op** for the daemon's life (`src/context.ts:52`,
    `src/embed/local.ts:36`).
  - **The git email for "you" facts is cached forever** (`src/facts/model.ts:47`).

## Options

- **Remove it (recommended if no one uses it with a remote database).** Delete the files above, collapse each
  hook back into one file, and drop the `daemon` setting. An old config that has it still loads. All four bugs
  go with it.
- **Keep it, off by default.** Fix the four bugs: fall back to local work when the daemon does not answer, pass
  each request's environment to everything it starts, retry a failed embedder load, and expire the email
  cache. Then benchmark on Postgres.

## Done when

The owner has decided, and the chosen option ships in v0.14 with its tests.
