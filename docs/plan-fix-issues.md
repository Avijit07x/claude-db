# Fix plan

Status: Phases 1 to 3, 4.6 and 4.7 are done and tested, on branch `v0.13.1`. The rest of Phase 4 has its own
plans, listed below.

## Root causes

Most of the findings come from eight causes. Fixing a cause removes the whole group of symptoms under it.

| #   | Root cause                                                                                    | Items         |
| --- | --------------------------------------------------------------------------------------------- | ------------- |
| A   | Deletes and closes had no guard: ids were not checked, and a folder was widened to its scope | 1.1, 1.2, 1.3 |
| B   | The grep hook guessed intent from the command text, then blocked the real grep                | 2.1           |
| C   | The graph had two meanings of "stale", and its two entry points copied each other             | 2.2, 2.3      |
| D   | Each flush re-reads the last turn, and five triggers flush the same chat                      | 2.4, 2.5, 4.3 |
| E   | Haiku calls start a full Claude Code, with every hook                                         | 2.6           |
| F   | claude-db wrote into files the user owns, and the same advice lived in four places            | 3.1, 3.2      |
| G   | Each feature is built three times (one per backend) on tag conventions in one table           | 4.4, 4.5      |
| H   | Speed and ranking machinery that was never measured                                           | 4.1, 4.2      |

## Done: Phases 1 to 3

| #   | Problem                                                                    | Fix                                                                                                                                  | Tests                                              |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| 1.1 | `forget` with `''`, `*`, `_` or a short id deleted rows in every project   | `assertValidIds` (8 to 36 hex characters or dashes) in `withProjectScope.remove` and `cmdForget`                                     | `mcp-run.mjs`, `cli-run.mjs`                       |
| 1.2 | `merge <subfolder> --yes` deleted the destination's memory                 | The sweep deletes only rows still stored under the exact old path                                                                    | `cli-run.mjs`                                      |
| 1.3 | A flush closed open work from other clones                                 | Only rows whose files are all inside this folder are closed                                                                          | `progress.mjs`                                     |
| 2.1 | The grep hook blocked greps by default                                     | Default `directive`. Quiet for files, paths outside the repo, `-c`, `-v`, pipes and revisions. One-line header                        | `prefer-usages.mjs`, `graph-hook-run.mjs`          |
| 2.2 | `find_usages` took its root from `path`, and could rescan another repo     | One shared `usagesAnswer`. The root comes from the project and `path` only filters. `regex` and `context` are for text mode only     | `graph-answer.mjs`                                 |
| 2.3 | A scanner upgrade or a deleted file kept the graph stale                   | Refresh compares one file's hash with the stored one. Deleted files are skipped                                                      | `graph-refresh.mjs`                                |
| 2.4 | A flush that stopped halfway lost the chat summary                         | `.written` is saved after the session                                                                                                | `flush-run.mjs`                                    |
| 2.5 | `CLAUDE_CONFIG_DIR` made the daily sweep delete every read position        | `claudeProjectsDir()` reads it. A chat folder that cannot be read sweeps nothing                                                     | `store.mjs`                                        |
| 2.6 | Haiku calls ran the full start hook                                        | `session-start` returns after the skill repair when capture is off                                                                   | `graph-hook-run.mjs`, `refresh.mjs`                |
| 3.1 | Install wrote a block into CLAUDE.md                                       | Install writes nothing. Refresh and uninstall remove an old block                                                                    | `install.mjs`, `refresh.mjs`, `cli-run.mjs`        |
| 3.2 | The tool text was long                                                     | `find_usages` 1,885 to 827 characters, `search` 865 to 557                                                                           | `mcp-run.mjs`                                      |
| 3.3 | `capture.tools` was never read                                             | Removed. An old config that has it still loads                                                                                       | `inject-defaults.mjs`                              |

Checks: typecheck, lint, prettier, knip, build and `npm test` pass (1,412 checks; the baseline had 1,343). The
Postgres and MongoDB suites were not run.

## Corrections found while coding

- 1.1: the guard is above the adapter, not in `partitionIds`. Dropping ids there would leave an empty `OR` clause.
- 1.2: `reset --project` and `prune` also call `remove({ project })` and need the widening, so only `merge`
  changed.
- 1.3: the calls on flushes that save nothing stay. They close work after a commit (3b0ffe9).
- 3.2: Claude Code defers MCP tool text by default (tool search), so the saving applies only when a tool is
  loaded. Removing the CLAUDE.md block (3.1) saves tokens in every chat.

## Open from this round

- `get_observations` with `''` reads every row. Fixed by `docs/plan-store.md`, bug 1.
- A `find_usages` `path` filter runs after a 1,000-edge fetch, so a symbol with more edges can show a partial
  folder answer. Accepted: it is rare.
- `search` and `find_usages` stay deferred by Claude Code's tool search, not loaded upfront. That costs fewer
  tokens, the hooks deliver most memory, and the server instructions name the tools.
- Test Claude Code's Code Mode (`CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1`) in one real chat. Done when we know
  whether the `<memory>` pick and the grep hook's context still arrive. Both depend on `PreToolUse`, and the
  docs do not say whether it fires for tool calls made from code. Needs the owner.

## Phase 4

| #   | Item                     | Plan                          | Status                                                     |
| --- | ------------------------ | ----------------------------- | ---------------------------------------------------------- |
| 4.1 | Daemon                   | `docs/plan-daemon.md`         | Researched. Recommend keep and fix its causes; owner decides |
| 4.2 | Search ranking           | `docs/plan-search-ranking.md` | Recency fix done. The bench is in progress; the decision needs the owner's run |
| 4.3 | Flush with no lock       | `docs/plan-flush.md`          | Done on v0.14 (a96ae12)                                    |
| 4.4 | Store drift              | `docs/plan-store.md`          | Bugs done (c1b4c95). The contract test is next, in v0.14   |
| 4.5 | `sync`                   | `docs/plan-store.md`          | Done (c1b4c95)                                             |
| 4.6 | Start block, nothing twice | `docs/plan-start-block.md`  | Done (629439b)                                             |
| 4.7 | `npm test` builds first  | -                             | Done (204bd38)                                             |

## Leave alone

Content-addressed observation ids, redaction, the pick handoff, the git-grep text mode, grammar packaging, the
SQLite adapter and schema, `project_links`, and the CI run against real Postgres and MongoDB.

## Not adopted

Building Cloudflare-style Code Mode into claude-db. Claude Code has its own experimental Code Mode
(`CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1`), which works with any MCP server, so claude-db needs nothing.

## Order

Phase 4 starts only after its measurement.

Next round: 4.6. The goal is that Claude gets only what it needs at chat start, with nothing shown twice. Measure
the injected text with `npm run bench:tokens` before and after.
