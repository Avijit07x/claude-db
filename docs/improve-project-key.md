# Improve: match projects by git link

Item 7 of [next-improvements.md](./next-improvements.md). This file holds the design and the steps. Each step is
one commit, and a step is marked done only after its checks ran and passed.

Status: all 8 steps done, verified 2026-10-07. Not committed or released.

## Problem

A project is keyed by its folder, for example `/home/dev/Code/shop`. The same repository in another folder, or
on another machine, is a different project with no shared memory. `claude-db merge` moves rows by hand.

## What the code does today

Measured by reading the code on 2026-10-07.

- `resolveProject()` returns the repository root folder. 44 places call it.
- That one value is used for two different jobs:
  - As a **memory key**. Every store method that takes a project, and every row, uses it. The filters in the
    three adapters compare it with equality.
  - As a **folder**. About 20 places join it with a file name or pass it to a program: the hook settings and
    the MCP file (`settingsPathFor`, `mcpPathFor`, `instructionsPathFor`), `git -C`, the Claude transcripts
    folder (`transcriptsFor`), the code graph scan (`repoRootFor`) and `.gitignore`.
- Fact ids and handoff ids are computed from the project string (`factId`, and the `manual` id with a key). A
  different project string gives a different id for the same fact.
- The code graph rows hold absolute file paths of one machine.

So the plan's line "key a project as `github.com/acme/shop`" cannot be done by changing `resolveProject()`.
That would turn every one of those folder uses into a broken path.

## Design

1. **Keep `resolveProject()` as it is.** It still answers "which folder". No call site that needs a folder
   changes.
2. **Add a key.** `projectKey(folder)` returns the normalized git remote, for example `github.com/acme/shop`,
   or the folder path when there is no remote.
   - The remote is `origin`. A config setting can name another remote.
   - `ssh`, `scp`-style and `https` forms of one remote give one key. A trailing `.git`, a port, a user name
     and letter case do not change it.
   - Credentials are stripped before anything is stored. An `https` remote can hold a token.
3. **A project map** in the database links each folder to its key: `folder -> key`, with the first time it was
   seen. It lives in the database, so a second machine sees the folders of the first.
4. **Reads follow the map.** A read for a folder matches every row whose project is the key or any folder
   mapped to that key. Rows saved before the change stay where they are and are still found. Nothing moves.
5. **Writes use the key.** New rows are saved under the key.
6. **The boundary is the store context**, not the 44 call sites. The context turns the folder it is given into
   a key for writes and a key list for reads. The call sites keep passing folders.
7. **The code graph stays per folder.** It holds absolute paths that mean nothing on another machine.
8. **Duplicates.** A fact or a handoff saved under the key gets a new id, so the old row under the folder is a
   second copy. Reads keep one per fact key or handoff key, the newest.
9. **Where it is not the same project:** a fork and its upstream have different remotes and stay separate. A
   monorepo is one project, as today. A folder with no remote keeps its path as the key.

## Steps

The plan was cut from 10 steps to 8 on 2026-10-07 to keep it simple. Moved remotes and rows saved before the change are covered by the tests in steps 6 and 8, not by separate steps.

| #   | Step                                                                                           | Status |
| --- | ---------------------------------------------------------------------------------------------- | ------ |
| 1   | Inventory and design (this file)                                                               | done   |
| 2   | Normalize a remote into a key: forms, credentials, origin, config                              | done   |
| 3   | The project map in SQLite: table, read, write                                                  | done   |
| 4   | The project map in Postgres and MongoDB                                                        | done   |
| 5   | Reads that accept a list of projects, in all three adapters                                    | done   |
| 6   | The store context: writes use the key, reads follow the map, with tests on all three databases | done   |
| 7   | Show a project's own memory correctly in `status` and `projects`, and drop duplicate facts     | done   |
| 8   | One end-to-end test with two real clones, then docs and the release note                       | done   |

## Risks

- It changes how every row is matched to a project. It ships in 0.11.0 with the other items, decided on 2026-10-07, and the release note gives it its own section.
- Reads become `IN (...)` lists. Search ranks and limits must still be right with a list.
- Test a copy of the real database before any release. Never the real file.
- The Postgres and MongoDB adapters only run in CI here, so steps 4, 5 and 6 depend on that run.

## What was not checked yet

Everything above is a design from reading the code. No behaviour has changed.

## Step 2: the remote becomes a key (done, verified 2026-10-07)

**What was built.**

- `src/util/remote-key.ts`: `normalizeRemote(url)` turns a remote address into `host/owner/repo`, or `null`
  when the address is not a shared one. `isRemoteName(name)` checks a remote name.
- `src/util/project-key.ts`: `projectKey(folder, options)` reads the remote with `git config --get
remote.<name>.url` and returns the key, or the folder when there is no usable remote. `readRemoteUrl` is the
  real reader. A test can pass its own reader.
- The setting `project.remote` in the config, default `origin`. A name that is not letters, digits, `.`, `_`
  or `-` is refused by the schema and, as a second guard, by `projectKey`.
- Nothing calls these yet. Step 6 does. No behaviour of the program changed.

**Rules the key follows.**

- The scheme, the user name, the password or token, the port, a query, a fragment, a trailing slash and a
  trailing `.git` are dropped. The host and the path are lower-cased.
- The `https`, `http`, `ssh`, `git+ssh`, `git` and `scp` (`git@host:owner/repo`) forms are accepted.
- A key needs a host and at least an owner and a repository. Sub-groups are kept.
- These give no key, so the folder is used: a local path, a `file://` address, a Windows path, an address with
  only a host or only an owner, an address with `..`, and an unknown scheme.

**What was verified.**

- 17 new checks, in `scripts/unit/project-key.mjs`, pass. They cover 17 spellings of one remote, 13 addresses
  that must give no key, no credential or port in any key, sub-groups, three different repositories giving three
  keys, the origin default, a configured remote, a bad remote name, the config setting, and real temporary git
  repositories: two clones in different folders, a repository with no remote, a folder that is not a
  repository, a missing folder, and a fork with `origin` and `upstream`.
- Full `npm test`, `npm run lint`, `typecheck`, `knip` and the format check pass. No comments in the new code.

**What was not tested.**

- A remote that `git` rewrites with `url.<base>.insteadOf` in the config. `git config --get` returns the
  address as written, before the rewrite, so a rewritten address gives the key of the written one.
- A repository with more than one URL on the remote. Only the first one is read.
- Case-sensitive hosts. Lower-casing the path would join two repositories that differ only by case. This is
  rare, and it is the price of treating `Acme/Shop` and `acme/shop` as one repository on GitHub.
- A self-hosted server where two different ports serve different repositories at the same path. The port is
  dropped, so those would share a key.
- Windows and macOS. The code only calls `git`, but it was run on Linux only.

## Step 3: the project map in SQLite (done, verified 2026-10-07)

**What was built.**

- A table `project_links(folder, project_key, first_seen)`, primary key on the pair, with an index on the key.
  It is added with `CREATE TABLE IF NOT EXISTS` in `schema.sql`, which runs on every `init`, so an existing
  database gets it on its next start. No version bump and no change to any existing table.
- `linkProject(folder, key, now)` stores a link once and keeps the first time it was seen. It stores nothing
  when the folder and the key are the same (a folder with no remote), or when either is blank.
- `projectScope(folder)` returns the folder first, then every key linked to the folder, then every other
  folder linked to any of those keys, sorted and without repeats. A folder that was never linked gets a scope
  of itself.
- `src/store/project-scope.ts` holds the two shared rules (`isLinkable`, `orderScope`), so the Postgres and
  MongoDB adapters in step 4 follow the same rules.
- The two methods are on the SQLite store only. They join the shared `MemoryStore` interface in step 4, when
  the other two adapters have them, so the build stays whole at every step.
- Nothing calls them yet. No behaviour of the program changed.

**A rule worth reviewing.** The scope is two hops, on purpose: folder, its keys, and the other folders of
those keys. If one folder is linked to two keys, for example after a repository moved, that folder sees both
keys. A clone that knows only the old key does not see the new key until its own remote is updated and linked.
A full chain of links would be simpler to explain, but one folder reused for an unrelated repository would
then join two unrelated sets of memory for everyone.

**What was verified.**

- 15 new checks, in `scripts/unit/project-links.mjs`, pass. They cover: an unlinked folder, a linked folder, two
  clones sharing a scope both ways, linking twice, a different repository staying out, a moved remote, a clone
  that knows only the old key, a folder with no remote, blank values, quotes and SQL text in a name, closing and
  reopening, and a database made before the table existed.
- Full `npm test`, `npm run lint`, `typecheck`, `knip` and the format check pass. No comments in the new code.

**What was not tested.**

- Postgres and MongoDB. Step 4.
- Many links. The test used about ten. The query is two index lookups, but it was not timed on thousands.
- Two processes linking at the same moment. `INSERT OR IGNORE` on a primary key is safe by design, and a test
  of it was not written.
- A database that is read-only. `linkProject` would throw there. The caller in step 6 must catch it.

## Step 4: the project map in Postgres and MongoDB (done, verified 2026-10-07)

**What was built.**

- `linkProject` and `projectScope` are now part of the shared `MemoryStore` interface, with the same rules in
  all three adapters (`isLinkable` and `orderScope` from `src/store/project-scope.ts`).
- Postgres: the table `project_links` with the same columns and primary key, an index on the key, and
  `INSERT ... ON CONFLICT DO NOTHING`. `SCHEMA_VERSION` went from 4 to 5. Postgres only re-runs its table setup
  when the version changes, so without the bump an existing database would never get the table. The setup uses
  `CREATE TABLE IF NOT EXISTS`, so running it again is harmless.
- MongoDB: the collection `project_links` with a unique index on `(folder, projectKey)` and an index on
  `projectKey`. A link is an upsert with `$setOnInsert`, so the first time it was seen is kept.
- `project_links` was added to the list of tables that belong to claude-db (`foreignNames`). Without it, a
  database that has the map would have looked like it held someone else's tables, and `claude-db use` could
  have refused it.
- Nothing calls the map yet. No behaviour of the program changed.

**What was verified, on real databases.**

- Postgres 16 with pgvector in Docker, and MongoDB from the system `mongod`, both on this machine. The same
  10 checks in `scripts/smoke/project-links.mjs` pass on SQLite, Postgres and MongoDB. CI runs the same file.
  They cover the table being ours, an unlinked folder, a shared scope both ways, six links of the same pair at
  the same time, a different repository staying out, a moved remote, a clone that knows only the old key, a
  folder with no remote and blank values, quotes and SQL text in a name, and non-ASCII names.
- On both databases the first time seen stayed at its first value (1000) after six later links with 9000, and
  there were no duplicate links.
- Postgres upgrade: the schema went from 4 to 5 on a database that already had data, and setting the version
  back to 4 and starting again also worked.
- The MongoDB indexes were created: `folder_1_projectKey_1` and `projectKey_1`.
- Full `npm test`, `npm run lint`, `typecheck`, `knip` and the format check pass. No comments in the new code.

**What was not tested.**

- MongoDB Atlas, and Postgres without the pgvector extension.
- A very large number of links, and links written from two separate processes at once. Six parallel calls from
  one process were tested.
- An older claude-db opening a database that is already at schema 5. It would set the version back to 4 and
  run the same harmless setup, so the two versions flip the number. That was reasoned from the code, not run.
- `export`, `import`, `sync`, `reset` and `merge` do not know about the map yet. They are handled in steps 8 and
  9, and the step table now says so.

## Step 5: reads that accept a list of projects (done, verified 2026-10-07)

**What was built.**

- A new type, `ProjectFilter`, is one name or a list of names. `ListFilter.project`, `SearchQuery.project`,
  `RemoveFilter.project` and `recentSessions(project, limit)` accept it. A single name behaves exactly as before.
- SQLite turns a list into `project IN (...)`. The full-text scope token becomes `scope:(a OR b)`. Postgres uses
  `project = ANY($n::text[])`. MongoDB uses `{ project: { $in: [...] } }`. All three build the clause in one
  place per adapter (`projectClause` or `projectMatch`), and `projectsOf` removes repeats and empty names.
- **An empty list matches nothing.** Without this rule, an empty list would have meant "no filter", so a
  bug that produced an empty scope would have made `remove` delete everything and made reads show every
  project. The rule applies to `list`, keyword search, vector search, `recent chats` and `remove`. It lives in
  the adapter functions, not in a wrapper. An empty string still means "no filter", as it did before.
- `remove` with a list also clears the chats of every project in the list, as it already did for one project.
  What it clears for the code graph is described in the open items of step 6.
- The code graph queries (`findSymbols`, `findEdges`, `scannedFiles`, `removeGraph`) still take one folder.
  The graph stays per folder, as the design says. `timeline` still follows the project of the note it starts from.
- Nothing passes a list yet. Step 6 does. No behaviour of the program changed.

**What was verified, on real databases.**

- 21 checks in `scripts/smoke/project-lists.mjs` pass on SQLite, Postgres 16 with pgvector, and MongoDB, on this
  machine. CI runs the same file. They cover: one name unchanged, two names, a repeat and an empty name, an empty
  list, names with quotes, SQL text and non-ASCII, 302 names at once, keyword search over a list, over one name
  and over an empty list, vector search over the same three, recent chats over a list with the limit applied to
  the whole list, `remove` with an empty list and with a list, and the project left alone staying whole.
- Two unit checks for `projectsOf` and `noProjects`.
- Full `npm test`, `npm run lint`, `typecheck`, `knip` and the format check pass. No comments in the new code.

**What was not tested.**

- Ranking quality over a list. The checks prove the right rows are found, not that two projects rank fairly
  against each other. A list only widens the filter, and the ranking formula is the same as before.
- A very long list. 302 names worked on all three. SQLite's limit on query parameters is far above that, and
  Postgres sends the list as one array, so the real limit is not known to be reached.
- MongoDB Atlas vector search. The local MongoDB uses the scan path, and the Atlas path shares the same
  `scopeFilter`, but it was not run.
- Postgres without pgvector. The vector checks ran with it installed.

## Steps 6 to 8: wire it in, finish, check (done, verified 2026-10-07)

**What was built.** Small, on purpose.

- `src/store/project-resolver.ts` and `src/store/scoped-store.ts`: a wrapper that `createContext` puts around
  the store. A project value is changed only when it is a real folder. Writes use the key. Reads, recent chats
  and `remove` use the whole scope from the project map. Fake names, the `@you:` scope and folders with no
  remote pass through untouched, so no call site changed. Ids did not change, so a folder's old rows are
  simply saved again under the key.
- The scope is asked from the database on each read, not cached. A cached scope missed a clone that linked
  later. This was found by the test and fixed.
- `status` and `projects` look at the whole scope. `onePerKey` shows a fact once when two clones saved it.
- Config `project.remote`, and a paragraph and a row in the setup guide.

**What was verified.**

- `scripts/smoke/scoped-store.mjs` (13 checks) passes on SQLite, Postgres 16 and MongoDB. CI runs it.
- `scripts/unit/isolated/project-key-run.mjs` uses real git clones through the real context: two clones share
  memory and search, a token never reaches the database, a different repository and a folder with no remote
  stay apart, a moved remote keeps every earlier note, a fact saved twice shows once, and `status` counts it.
  It also passes against real Postgres and MongoDB, run by hand.
- On a copy of the real database: the 169 old rows of this project were still found, a new note was saved under
  `github.com/avijit07x/claude-db`, and the other project and the personal rules were untouched.
- Full `npm test`, `lint`, `typecheck`, `knip` and the format check pass.

**Known limits.**

- A fact saved by two clones has two ids, so a retire from one clone does not retire the other copy. It is
  shown once, but it is not removed. The fix is to derive ids from the key, which changes every fact id.
- `sync`, `export`, `import` and `merge` use the raw database, so they see keys and folders as separate names.
  They work as before, and they were not changed.
- `reset --project` removes the whole scope, which for a shared project is every clone's memory.
- Not run: macOS, Windows, Atlas, and a second machine on a real shared database.
