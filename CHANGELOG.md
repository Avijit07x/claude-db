# Changelog

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
