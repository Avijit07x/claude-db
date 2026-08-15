# Changelog

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
