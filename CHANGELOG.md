# Changelog

## 0.3.0

Every defect shipped so far was silent — hooks swallow their errors so a memory
layer can never break a session, which is the right call and means nothing ever
reports that capture has stopped. This release is mostly about the tool proving
it works, plus the first two answers to "it knows nothing yet".

### Added

- **`status` reports when memory was last written**, and warns when this project
  has been worked in for two days with nothing recorded. Work happening while
  capture doesn't is the signal every failure so far has left, and nothing
  surfaced it
- **`doctor --deep`** writes an observation, searches for it, expands it and
  deletes it — through the real adapter, embedder and index. Reachability was
  all `doctor` ever proved, and every silent failure had a reachable database
- **`claude-db seed --from-git`** builds memory from commit history: subject,
  body, changed files, author and date. A fresh install knows nothing for weeks,
  which is the worst moment to ask anyone to trust it. Merges and releases are
  skipped, and ids come from the sha, so re-running adds rather than duplicates
- **`claude-db sync <url>`** two-way merges with another database. Content-derived
  ids make it nearly free: an id on one side and not the other is memory the
  other has never seen. Session recaps travel with it. Dry run without `--yes`
- **`/cdb-scan`**, installed alongside the hooks: Claude surveys the codebase
  once into five notes — stack, layout, conventions, workflows, architecture.
  Tagged `inferred`, because everything else in the database is a record of what
  happened and this is a reading of the code
- **`search --tag <name>`**, and `tag` over MCP. Tags recorded the repository or
  directory an observation touched and only ever nudged ranking, so a workspace
  pooling several repositories could not ask about one of them
- **`remember --key <name>`**, and `key` over MCP: a stable identity, so a note
  meant to be kept current is replaced rather than duplicated on every run

- **A snippet of the matching body in every search result.** The index was
  built on the assumption that a title tells you which row holds the answer,
  and it often does not: fifteen results dated the same day, titled things like
  "Committed as 30daa92", leave nothing to choose on, so you expand two at
  random and pay a full body for each guess. Measured over five real searches,
  snippets add about 19 tokens a row and one avoided expansion saves about
  1000. FTS5 `snippet()` and `ts_headline` centre the fragment on the match;
  MongoDB's `$text` has no equivalent and returns the head of the body. Rows
  found by vector similarity alone carry none — there are no query terms in
  them to centre on — and were 20% of results in that measurement
- **`get_observations` takes a `chars` limit**, default 2000. The cost argument
  that made the index terse was never applied one layer down, where a single
  call may ask for twenty-five bodies at once. The remainder is counted rather
  than dropped in silence

### Fixed

- **Titles still fell back to narration.** 0.2.2 skipped sentences that announce
  the work; a sentence that merely says nothing still won, so "Working through
  the improvements now." was a stored title. Titles now take the first sentence
  carrying evidence — a filename, a number, a past-tense verb — and fall back
  only when none does
- **`use` stranded your memory in silence.** Switching backends left everything
  already recorded behind and started the new one empty. It now says so, and
  says how to bring it across
- **`use` wrote into whatever it was pointed at.** One in anger resolved to a
  live application database; two tables were created inside it without a word.
  It now reports what else is in there, before adding anything
- **`kind` barely filtered.** `decision` matched on the bare word *because*,
  which explains as readily as it decides — 98 of 471 stored decisions matched
  on nothing else, and half the database was one kind. It now needs a weighed
  alternative
- A certificate error from a managed Postgres now names the fix, not just the
  problem
- Cursors for transcripts that no longer exist are swept during `flush`.
  `clearCursor` landed in 0.2.0 and never covered anything written before it

### Changed

- **Postgres `init()` costs one round trip instead of four.** Every hook is its
  own process, so nothing is pooled and the whole setup ran again on every
  prompt. Against a managed instance — 49ms at best, 1045ms at the median for a
  single round trip — that was most of why a remote backend felt broken. A
  version row now short-circuits it, and anything unexpected falls through to
  the full setup

### Upgrading

Postgres gains a `claude_db_meta` table on first connection, which is why this
is a minor release rather than a patch: `updates: auto` will report it and leave
it to you.

Titles and kinds are rewritten by re-ingesting, per project:

```bash
cd <project> && claude-db flush
```

## 0.2.3

### Added

- **Update notifications.** A newer release is reported once a day at session
  start. The check runs detached at session end and writes a local file the next
  session reads, so neither the network nor npm is ever on the prompt path
- `updates: notify | auto | off`. Notify is the default — installing on
  someone's behalf means executing code they did not choose, in a process
  holding their whole memory database. `auto` is available for anyone who wants
  it, and stops at the caret boundary: 0.2.x takes 0.2.z but not 0.3.0, since a
  release outside that range may migrate the database on first connection
- `claude-db update` to check and install on demand
- `doctor` reports the running version, which nothing did before

## 0.2.2

### Fixed

- **Titles announced the work instead of reporting it.** `buildTitle` took the
  reply's opening sentence, which mid-task is a transition rather than an
  outcome — "Now the use command and the top-level handler:", "Right — let me
  do that properly". Measured on a real database, half of all titles read like
  that. Since the title is the whole payload of a search result and of the
  block injected above each prompt, a turn whose body held the answer was
  unreachable. Titles now skip announcing sentences and take the first that
  carries a claim

### Changed

- The memory instructions written at install now ask the agent to search
  **before re-deriving** something the project already knows — grepping or
  reading git history to reconstruct a past decision — not only before saying
  it lacks context, which never fires when it silently reconstructs instead

### Upgrading

Existing titles are rewritten by re-ingesting, per project:

```bash
cd <project> && claude-db flush
```

Embeddings are recomputed as part of that; no separate `reembed` is needed.

## 0.2.1

### Fixed

- **`use` saved the connection string before testing it**, so a typo or a
  retired host was written to the config permanently. Every hook then pointed
  at a database that was not there, and because hooks swallow their errors,
  memory silently stopped recording. It now connects and pings first, keeping
  the previous database otherwise; `--force` saves unverified
- Errors from a database driver printed a raw stack trace instead of a message
- Credentials in a connection string (`user:password@host`) were not redacted,
  and were stored verbatim in memory
- `remember` applied no redaction at all — dictated memory was stored raw

## 0.2.0

Memory becomes writable, is keyed on the repository rather than the directory
you happened to launch from, and behaves the same on all three backends.

### Fixed

- **SQLite orphaned an FTS row on every re-ingest.** `INSERT OR REPLACE` skips
  the delete triggers that maintain the mirror unless `recursive_triggers` is
  on. Existing databases repair themselves once, guarded by `user_version`
- **Postgres stored nothing on a default install.** The embedding column was
  hardcoded to 384 dimensions while the built-in embedder produces 256, so
  every insert failed and rolled the batch back. The column is now sized to the
  vectors actually written
- **Postgres discarded corrections**, using `ON CONFLICT DO NOTHING` where the
  other adapters overwrite, pinning every observation to its first, partial
  capture
- **Postgres keyword search was narrower than the rest.** `plainto_tsquery`
  ANDs every term, so a natural-language prompt matched nothing and per-prompt
  injection never fired. Tags were not indexed there at all
- Vectors of different widths were compared and scored a meaningless number;
  they now score zero and fall below the relevance floor
- Observation titles were never redacted, though they are injected above every
  prompt
- Non-Latin prompts recalled nothing: three ASCII-only tokenisers, one of which
  gave CJK text a zero vector
- `uninstall` left the MCP server registered when it was the only one
- `upsertSession` never updated `project` on SQLite or Postgres

### Added

- `remember` and `forget`, as MCP tools and CLI verbs. Capture is inferred from
  events, and a rule is not an event, so a standing preference was the one
  thing that could never be recorded
- `export`, `import`, `prune`, `reembed`, `stats` and `merge`
- `search --all`, and `project: "*"` over MCP, for cross-project recall
- `author` and `embedder` recorded per observation
- Install writes standing memory instructions to `CLAUDE.local.md`, so recall
  is a default rather than something to ask for each session

### Changed

- Memory is keyed on the repository root, so working from a subdirectory no
  longer starts a second, invisible memory. `$HOME` is refused, so a dotfiles
  repo cannot collapse every project into one
- Session summaries carry across flushes and rank by kind
- Observations are tagged with the repository or top-level directory they
  touched
- The embedder is bounded by `embeddings.timeoutMs`, so a first model download
  cannot hang a prompt
- Redaction covers private keys, AWS keys, Slack tokens and JWTs
- A global install registers through `claude mcp add -s user` instead of
  rewriting `~/.claude.json`, and every settings write is atomic
- `MemoryStore.clear()` is replaced by `remove(filter)`, alongside a new paged
  `list(filter)`

### Notes

Postgres and MongoDB are now covered by CI rather than by argument. The suite
is 138 checks.

## 0.1.0

First release.

### Capture

- Reads Claude Code session transcripts rather than watching tool calls, so
  observations carry the prompt (intent) and the agent's reasoning, not just
  file paths
- Groups a transcript into turns: a prompt plus everything until the next one
- Content-derived observation ids, so reprocessing rewrites rather than
  duplicating
- Flushes on every prompt, so sessions that crash or never close are still
  recorded
- Byte-offset cursor per session, so each flush parses only the new tail
- Shell commands filtered by an allowlist of consequential operations
  (dependency changes, tests, builds, history-changing git, migrations,
  infra). Exploration is dropped
- Secrets redacted and excluded paths dropped before anything is written

### Storage

- One `MemoryStore` interface, three adapters: SQLite, MongoDB, Postgres
- Connection-string scheme selects the backend; drivers load lazily
- SQLite via Node's builtin `node:sqlite`: no native build step
- Project scoping indexed inside FTS rather than applied as a post-filter
- Brute-force vector scans bounded by `embeddings.maxScanCandidates`

### Recall

- Three-layer progressive disclosure: `search`, `timeline`,
  `get_observations`, exposed as MCP tools
- Hybrid retrieval fused by Reciprocal Rank Fusion, with a recency boost
- Automatic injection at session start and on every prompt, with the best
  match expanded in full
- Relevance floor per embedder, so an unrelated prompt injects nothing
- Zero-dependency builtin embedder; optional upgrade to all-MiniLM-L6-v2

### CLI

`install`, `uninstall`, `status`, `doctor`, `use`, `search`, `projects`,
`flush`, `reset`. Aliased as `cdb`.

- `--project` scopes to one repo instead of the whole machine
- `install` refuses to run from an npx cache, since hooks store absolute paths
- `reset` is a dry run unless given `--yes`
