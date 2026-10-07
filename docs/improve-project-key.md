# Improve: match projects by git link

Item 7 of [next-improvements.md](./next-improvements.md). This file holds the design and the steps. Each step is
one commit, and a step is marked done only after its checks ran and passed.

Status: step 1 of 10 done.

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

| #   | Step                                                                   | Status |
| --- | ---------------------------------------------------------------------- | ------ |
| 1   | Inventory and design (this file)                                       | done   |
| 2   | Normalize a remote into a key: forms, credentials, origin, config      |        |
| 3   | The project map in SQLite: table, read, write                          |        |
| 4   | The project map in Postgres and MongoDB                                |        |
| 5   | Reads that accept a list of projects, in all three adapters            |        |
| 6   | The store context: writes use the key, reads follow the map            |        |
| 7   | Duplicates of facts and handoffs across old and new rows               |        |
| 8   | A moved remote, no remote, and rows saved before the change            |        |
| 9   | End to end: two clones share, hooks, MCP, CLI, and a copy of real data |        |
| 10  | Docs, changelog and the release note                                   |        |

## Risks

- It changes how every row is matched to a project. It ships in 0.11.0 with the other items, decided on 2026-10-07, and the release note gives it its own section.
- Reads become `IN (...)` lists. Search ranks and limits must still be right with a list.
- Test a copy of the real database before any release. Never the real file.
- The Postgres and MongoDB adapters only run in CI here, so steps 4, 5 and 6 depend on that run.

## What was not checked yet

Everything above is a design from reading the code. No behaviour has changed.
