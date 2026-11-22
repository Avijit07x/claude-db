# Plan: keep the daemon, and fix its causes (item 4.1)

Status: researched and measured on SQLite. Recommendation: keep it, opt-in, and fix the three causes below.
The owner decides.

## Why it exists

Issue #40 and PR #41, by an outside contributor:

- On a remote Postgres such as Neon, each hook is a new process. Before its first query it spends about 250 ms
  starting node, 330 to 540 ms opening TLS, and 280 ms to 2 s loading the embedding model when it embeds.
- The prompt hook blocks the prompt, and the grep hook runs on every Bash and Grep call.
- The contributor measured on Neon:

| Hook   | Without daemon | With daemon |
| ------ | -------------- | ----------- |
| Prompt | 1,630 ms       | 1,083 ms    |
| Grep   | 849 ms         | 229 ms      |
| Stop   | 128 ms         | 44 ms       |

- It is off by default. The owner reviewed it, five problems were fixed, and it shipped in 0.13.0.

## Measured here (SQLite, temp home, 25 runs)

| Hook          | Off, median | On and warm, median |
| ------------- | ----------- | ------------------- |
| session-start | 127 ms      | 41 ms               |
| user-prompt   | 142 ms      | 45 ms               |
| turn-end      | 79 ms       | 32 ms               |
| prefer-usages | 117 ms      | 40 ms               |

On SQLite the saving is about 85 ms per hook. The default embedder loads no model.

## Keep or remove

- **Keep:** it saves about 0.5 s per prompt and 0.6 s per grep for anyone who shares memory through Postgres
  or MongoDB, which is a headline feature. It also helps users of the local embedding model. Users who never
  turn it on never pay its runtime cost.
- **Remove:** it saves little on SQLite, costs about 510 source and 225 test lines, and brings the bug class
  below.

## Root causes of its bugs, and the fixes

1. **`process.env` is wrong inside the daemon.** It holds the daemon's environment, not the hook's.
   `withWorkerEnv` (`src/hooks/detached.ts`) only covers detached workers. Places that still read the daemon's
   environment:
   - Haiku calls (`src/util/claude-cli.ts:112-117`, `claude-binary.ts`)
   - the chat-log folder (`src/util/claude-dir.ts:5`, added in e84fca6)

   **Fix:** one helper returns the current hook's environment (the request's store, else `process.env`).
   Every env read uses it, and a lint rule rejects `process.env` anywhere else.
2. **A hung daemon blocks a hook for 8 to 50 s** (`src/hooks/route.ts:6-19`). After sending, the hook never
   falls back.

   **Fix:** a short reply deadline, then the hook does its own work. A repeat save is safe because ids come
   from content.
3. **State cached for the daemon's life:** a failed embedder load (`src/context.ts:52`, `src/embed/local.ts:36`)
   and the git email for "you" facts (`src/facts/model.ts:47`).

   **Fix:** retry a failed load on the next call, and give the email cache the one-minute life the project
   scope cache already has.

## Done when

- Tests show:
  - a hook served by the daemon uses its own `CLAUDE_CONFIG_DIR` and `CLAUDE_CODE_EXECPATH`
  - a stopped daemon (SIGSTOP) costs a hook at most the deadline, after which the hook answers itself
  - a failed embedder load is retried
  - a changed git email is seen within a minute
- The lint rule fails on a new `process.env` read outside the helper.
- `npm test` passes. The owner or the contributor re-measures on Postgres.
