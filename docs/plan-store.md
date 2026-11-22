# Plan: store drift and sync (items 4.4 and 4.5)

Status: bugs 1 to 8 and the sync wording are done (c1b4c95). The contract test is next, in v0.14.

Goal: the three backends return the same results, and a drift is caught by a test before a user sees it.

## Root cause

The `MemoryStore` interface has about 32 members, written three times. Parity is tested by regexes on SQL text
(`scripts/unit/adapters.mjs`), and only SQLite runs locally. Most of the 3,584 lines are dialect, so lifting
logic above the adapter saves only 70 to 90 lines. A contract test does more than abstraction would.

## Bugs to fix now

| #   | Bug                                                                                                           | Fix                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | `get_observations` and `timeline` take any string, so `''` or `*` reads every row in every project            | One shared id schema for the MCP tools that take ids, using the rule `assertValidIds` uses |
| 2   | SQLite `closeObservations` has no `status = 'open'` guard (`sqlite/observations.ts:220`), so a replaced row can become done | Add the guard, as Postgres and Mongo have                                          |
| 3   | Mongo passes raw text to `$text` (`mongo/search.ts:14`), so `-word` and quotes act as operators                | Clean the query once in `src/search/service.ts`, for every backend                     |
| 4   | SQLite matches `dst_name LIKE '%.name'` (`sqlite/graph.ts:146`): it ignores case and treats `_` as a wildcard, so `find_usages` shows false callers. Postgres treats `_` the same way | An exact suffix compare in both                                                       |
| 5   | Two rows with one id in one batch: Mongo's winner is not fixed (`ordered: false`)                             | Keep the last row per id once, in `withProjectScope.insertObservations`               |
| 6   | Postgres caches `vectorEnabled`, so pgvector installed later is never used (`postgres/index.ts:44`)            | When it is cached as off, check `pg_extension` again on `init`                        |
| 7   | Recency decays from `Date.now()`, not `query.until` (`src/search/service.ts:31`). From item 4.2               | `query.until ?? Date.now()`                                                            |
| 8   | `docs/architecture.md` says the three backends give the same results                                          | Say what differs: keyword ranking, and the scan cap for vectors                       |

Item 1 goes in the MCP schema, not in `getObservations`, because test fixtures use non-hex ids and internal
callers pass real ones.

## Sync (4.5): say what it does

`sync` copies rows missing on the other side and moves status forward (`src/cli/commands/sync.ts:36-100`). Edits
to a row with the same id, deletes, graph rows and project links do not travel. Rows have no updated time, so
carrying edits needs a tie rule that could overwrite good data, and carrying deletes needs a new table in three
backends.

- Now: `sync` prints that it adds rows and moves status forward, and the docs say the same.
- Later, only if asked: carry edits by comparing content, newer `createdAt` wins. No tombstones.

## Contract test (v0.14)

- Add `scripts/smoke/contract.mjs`, run by `scripts/smoke.mjs`. `npm test` runs it on SQLite, and the CI
  `adapters` job runs it on Postgres and MongoDB. No new CI job.
- Each check uses a fresh project.
- Checks:
  - every field round-trips
  - a re-save replaces a row, and search sees the new text
  - the last row wins on a duplicate id
  - closed work stays closed unless its files change
  - `closeObservations` only closes open rows
  - bad ids match nothing
  - `remove` by each filter, with empty lists deleting nothing
  - `list` order and cursor ties, and `count` equals `list`
  - `bodies: false` and `vectors: true`
  - keyword search treats `-x`, quotes, `*`, `OR` and `NEAR(` as plain words
  - vector search filters and order
  - sessions keep their summary
  - graph names match exactly
  - project links are symmetric
  - a copy to a second project is equal
- Retire the regex checks in `scripts/unit/adapters.mjs` that the suite covers.
- Done when the suite passes on SQLite locally and on all three in CI.
