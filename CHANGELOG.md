# Changelog

## 0.7.0

### Changed

- **The usages hook now directs instead of offering.** Replaying 1,871 Bash
  commands from real transcripts showed the additive wording ("the grep below
  still runs") produced 0% unprompted tool adoption — the graph answer arrived
  and was ignored. The hook now names the grepped symbol and instructs the
  agent to use `find_usages`, with the graph answer still inline so the
  instruction is self-justifying.

- **Plain lowercase words count as symbols when the graph holds a real
  declaration.** The symbol filter only matched camelCase, PascalCase and
  snake_case, so single-word names — `search`, `forget`, `timeline`, exactly
  the vocabulary a project's public surface tends to use — could never fire
  the hook. Words of four or more characters now qualify, gated on resolving
  to a declared function, method or class rather than a local `const`, so
  greps for `value` or `result` stay silent. Measured on the replay corpus:
  +9 fires, no regressions.

- **`git grep` and `rg` count as searching the tree.** Both are recursive by
  default, but the hook required a `-r` flag or a path argument, so every
  `git grep <symbol>` and bare `rg <symbol>` passed unseen. A piped `rg` is
  still treated as output filtering. Space-separated flag values
  (`rg -t ts`, `grep -A 3`) no longer confuse pattern extraction.

- **A preference's title is now the rule itself.** Titles were built from
  the assistant's reasoning, so a turn that stated a standing rule while work
  was in flight could be filed as a preference titled "140 checks pass" —
  junk in the new session-start index. Preference titles now come from the
  user's own words.

- **The installed instructions speak in the first person.** "This project has
  persistent memory" reads as someone else's feature; "you have persistent
  memory of this project" reads as the model's own recall. The installed
  block now uses the second framing, matching how the model treats memory it
  actually uses. Already-installed projects pick the new text up automatically
  at the next session start.

### Added

- **Session start injects a standing-rules index.** The model uses whatever is
  already in its context and skips what costs a call, so memory it cannot see
  is memory it does not use. The startup injection now lists the most recent
  preference observations — one line each, with the id to expand via
  `get_observations` — so recalling a standing rule becomes expanding a line
  already on screen instead of discovering whether one exists. Rules recorded
  explicitly with `remember` list ahead of auto-classified ones.

- **Symbol greps are blocked by default, with the graph answer in the deny
  reason.** A blind A/B on a real task showed the block outperforms the
  nudge: the agent pivots to `find_usages` immediately, loses no turn — the
  answer it needed rides in the deny reason — and non-symbol greps pass
  through untouched. `CLAUDE_DB_USAGES_HOOK=directive` keeps the softer
  inject-only mode; `off` disables the hook entirely.

- **`claude-db adoption` measures whether any of this works.** It reads the
  project's transcripts and reports Bash commands vs greps vs hook fires vs
  memory tool calls — the grep-to-memory ratio that motivated this release,
  reproducible on any project with one command.

### Fixed

- **`claude-db install` stacked duplicate hooks whenever the install path
  changed.** Registration deduped by exact command string, so reinstalling
  from a new location — a repo build vs the global install, or any node
  upgrade under nvm moving the global path — appended a second registration
  with the same matcher: two node processes and two database opens on every
  Bash call. Install now replaces its own hook entries by file name wherever
  they point, and uninstall removes them from any path, not just the one it
  is run from.

- **The graph could not answer for the MCP tool names themselves.**
  `find_usages("forget")` returned nothing: tool names existed only as string
  literals with anonymous handlers, so there was no declaration to index.
  Handlers are now named functions matching their tools (`search`, `forget`,
  `timeline`, `remember`, `get_observations`, `find_usages`), so the graph
  answers questions about the project's own public surface.

## 0.6.0

### Fixed

- **`scan` served a stale graph after every upgrade.** The scan cache keyed on
  file content hash alone, so when an extractor changed, users' files did not —
  and `scan` reported `N unchanged, 0 parsed` while continuing to serve edges
  built by the previous extractor. Fixes shipped in 0.5.3 never reached anyone
  who upgraded; only `scan --force` surfaced them, and nothing told you to run
  it. The cache key now mixes in a `SCAN_VERSION` and a fingerprint of the
  language rules, so an upgrade reparses once, automatically, and a rule edit
  invalidates the cache without anyone remembering to bump a constant.
  Verified against a cache written by the old extractor: 240 files skipped
  before, 204 reparsed after, and an unchanged file is still skipped on the
  next scan.

- **One common word in a query returned the whole corpus.** SQLite keyword
  search ORs every token, so `"quantum entanglement recipes for sourdough"`
  matched 30 rows on the strength of `for` alone, and an all-stopword query
  matched everything. Postgres and Mongo were never affected — `plainto_tsquery`
  and Mongo's `$text` strip stopwords already — so SQLite, the default backend,
  was the only one exposed. Stopwords are now removed before the query is built,
  and a query with no content words returns nothing instead of the corpus. The
  filtering lives in `src/search`, not the adapter, so every backend behaves the
  same. Note this could not be fixed after ranking: RRF discards score magnitude
  by design, so the fused score is not a relevance measure and cannot be
  thresholded.

- **`get_observations` answered with an empty string.** An id that resolved to
  nothing produced no output at all rather than saying so, which reads as a
  broken tool. It now names the ids that did not resolve, and a partial batch
  appends which ones were missing instead of silently dropping them.

- **`timeline` could not tell a bad id from a quiet session.** Both produced
  `No matching observations.`; the two now read differently.

### Added

- **A `PreToolUse` hook that answers symbol searches from the code graph.**
  When a shell `grep` or the Grep tool searches for something shaped like a code
  symbol, the hook runs the graph lookup and returns the definition and every
  reference alongside the search — the grep still runs, so nothing is blocked and
  no second call is needed. It stays silent for plain text, piped output
  filtering, `-v`, regexes, lowercase words, and any project with no graph
  scanned. `CLAUDE_DB_USAGES_HOOK=off` disables it. Registered by `install` and
  removed by `uninstall` like the other hooks.

- **`find_usages` suggests near names on a miss.** A miss used to end at
  `No usages of that symbol found`, which is where people give up and go back to
  grep. `embedObservation` now suggests `embedObservations`, `find_symbols`
  suggests `findSymbols`, and a name with no near match still suggests nothing
  rather than something incidental.

### Changed

- **Tool descriptions now say when to reach for the tool.** `search`, `timeline`
  and `get_observations` opened with `Layer 1/2/3`, an internal concept that
  never stated a trigger, and `find_usages` opened by describing itself as a live
  `git grep`. They now lead with the condition that should make you call them,
  and `search` explains what to try when nothing matches.

- **`src/mcp/server.ts` split 303 lines into one module per tool group.**
  `server.ts` is 37 lines of bootstrap; the tools live in `src/mcp/tools/`. The
  tool logic is importable and unit-testable for the first time — previously
  anything in `server.ts` self-started a stdio transport on import.

## 0.5.4

### Fixed

- **`reembed` could exhaust memory on a large database.** ([#7](https://github.com/Avijit07x/claude-db/issues/7))
  Embedding walked the store 500 rows at a time and handed all 500 to a single
  `embedder.embed()` call, which became one forward pass over 500 sequences in
  the local model. Peak memory was set by that batch, so a database whose rows
  were long enough went to swap and never came back. Embedding is now chunked by
  `embeddings.batchSize`, so peak memory is a property of the chunk rather than
  of the database: re-embedding 1,400 observations holds ~0.8 GB and takes the
  same time per row as re-embedding 128. The chunking lives in
  `embedObservations`, the one call every path routes through, so `flush`,
  `seed` and `manual` capture are bounded by the same change — `seed` had the
  identical ceiling and would have hit it on a large enough repo.

### Added

- **`embeddings.batchSize`, default 8.** Measured on `all-MiniLM-L6-v2` with
  worst-case 512-token observations, peak RSS runs 0.8 GB at 8, 1.3 GB at 16,
  2.4 GB at 32 and 4.5 GB at 64 — while wall-clock stays flat from 1 to 8,
  because CPU inference is compute-bound and the token count is the same however
  it is grouped. Batching buys no speed here and only costs memory, so the
  default is deliberately small; lower it further if you are tight on RAM.

- **`reembed --project`.** `reembed` re-embedded every project on the machine
  with no way to narrow it. On a database holding several projects that is the
  difference between minutes and seconds, and the work skipped is work that
  never has to be bounded. Without the flag the behaviour is unchanged.

## 0.5.3

### Fixed

- **`timeline` could not accept the ids it was shown.** Every id that reaches a
  caller is shortened to 13 characters for display, and `get_observations`
  resolves those by prefix — but `timeline` matched exactly, in all three
  adapters, and its miss surfaced as the plausible "No matching observations."
  rather than an error. The tool had never worked over MCP. It now resolves the
  anchor the same way `get_observations` does; the smoke test that missed this
  fed it a full id straight from the store, the one input shape no real caller
  produces, and now feeds a short one.
- **`Class.method()` did not count as a reference to `Class`.** A member call
  produced edges to the method and to the qualified name, never to the object,
  so a class only ever built through a static factory looked unreferenced —
  including every store backend in this project, where `SqliteStore.create(uri)`
  is the sole construction site. A blast-radius check would have reported one
  caller (itself) and a rename on that basis breaks the store factory.
- **Callers inside anonymous functions were named after a nearby variable.**
  `const ctx = await createContext()` attributed the call to `ctx`, and
  `const result = await flushSession(...)` to `result` — assignment targets, not
  callers, and every hook entry point in this codebase is an anonymous callback.
  A variable declared on the line making the call is no longer treated as the
  enclosing scope; those sites now name the file, which is at least true.
- **One call was reported as two edges, and destructuring patterns as symbols.**
  `ctx.store.insertObservations()` appeared once qualified and once bare, and
  `const { turns, nextOffset } = ...` stored the pattern text as a symbol name.
  The two edges are now merged into one, keeping the qualified name for reading
  and the resolved target for traversal — the qualified edge resolves to nothing
  on its own, so dropping the bare one instead would have severed the only
  working link.

### Changed

- **Stopped pre-expanding a full observation body on every prompt.** The
  per-prompt block pasted in the top hit's entire body, up to 900 characters,
  before anything had asked for it — layer 3 of a three-layer disclosure design,
  paid unconditionally for a roughly 1-in-9 chance of being used. `expandTop`
  now defaults to `0`, and the index line carries the matched snippet instead,
  which is capped at 110 characters and shows *why* a result matched. Measured
  across four real prompts, the block goes from ~1,560 to ~520 characters, a 67%
  cut, and still names the id to expand on demand. `promptMaxChars` rises 500 ->
  700 so the budget fits the four results `promptResults` asks for.

  Existing installs materialise every config value to disk, so a schema default
  alone would have reached nobody. A saved `inject` block still holding both old
  defaults exactly is now treated as untouched and picks up the new ones; anyone
  who tuned either value keeps what they set.
- **Stopped re-injecting what a session had already been shown.** Every prompt
  got a `<recalled-memory>` block from a fresh search, and because the best
  match for one prompt is usually the best match for the next, the same
  observations were pasted in over and over. Measured across 25 real sessions,
  **56% of everything injected was already in the conversation** — roughly 950
  wasted tokens per session. Each session now tracks which observations it has
  surfaced and skips them; when every match is already in context it injects
  nothing at all, which happened on 28% of prompts in the replay. Nothing is
  lost: the content was in the transcript either way.

## 0.5.2

### Fixed

- **A turn that answered a question was never stored.** Capture kept a turn only
  if it edited a file or ran a command, so an entire session spent explaining a
  design, weighing an approach, or answering "why is it like this" left nothing
  behind — the reasoning most worth recalling was the reasoning most reliably
  dropped. A turn with no files and no commands is now kept when the question
  was a real one and the answer reports something concrete. Re-reading this
  project's own transcripts recovers 66 observations that were silently
  discarded; `claude-db flush` backfills them, since ids are content-derived and
  a re-read rewrites rather than duplicates.
- **A compaction summary was read as your prompt.** When a session is compacted,
  Claude Code writes an 18,000-character recap into the transcript as a user
  entry. Capture treated it as a real prompt, so every turn after a compaction
  was filed under `Asked: This session is being continued from a previous
  conversation…` and that recap was indexed as if it were a memory. Those
  entries are now skipped by the flag the transcript already carries.
- **`scan` was missing from `claude-db --help`.** The command shipped in 0.5.0
  and worked, but nothing in the help text mentioned it, and the `usages` line
  still described the old grep-only behaviour with no sign of `--mode`.
- **Underscores were stripped out of titles.** Title generation treated `_` as
  markdown emphasis, so `find_usages` was stored as `findusages` and every other
  snake_case identifier was mangled. Snippets stopped doing this in 0.3.0;
  titles now match.

## 0.5.1

### Fixed

- **A turn that touched no files stayed open forever.** Work closes when every
  file it touched has been committed, but a turn that only ran commands has no
  files to land, so it could never close and sat in `status` and in the
  SessionStart injection permanently. Those turns are now recorded as already
  done, and a row with no outstanding files closes rather than being skipped.
  Found by reading the list on a clean tree: four entries, none of them real
  work

## 0.5.0

`find_usages` could only ever answer "where does this string appear". It could
not say *how* two things relate — a call, an import, an inherit — or trace how
one symbol reaches another, and it re-paid the full search cost on every
question.

### Added

- **A code graph, built by `claude-db scan`.** Every source file is parsed with
  ast-grep and stored as symbols plus the relationships between them. Parsing
  is local, deterministic and costs no tokens; a rescan re-parses only files
  whose contents changed, so it is seconds the first time and milliseconds
  after. TypeScript, TSX, JavaScript, Python, Go and Rust, with the parser
  shipped as a prebuilt binary per platform so nothing compiles at install
- **Three new `find_usages` modes**, on the CLI and over MCP: `usages` lists
  what references a symbol with the relation on each line, `explain` adds what
  the symbol reaches, and `path` traces how two symbols connect. `text` remains
  the default and still needs no scan
- **Every edge carries its confidence.** `EXTRACTED` means it was read literally
  out of the syntax tree; `INFERRED` means the target was matched by name across
  files, and carries a score. Name matching is the one guess this makes, so it
  is labelled rather than presented as fact
- **A class links to the members it defines**, so a path can cross the class
  boundary — `boot --> App --> start --> helper` rather than stopping dead at
  the class, which is where the obvious chain used to break
- **Work is tracked as unfinished until it is committed.** A captured turn is
  stored `open` and closes once every file it touched has landed in a commit,
  which the existing flush already checks — there is no new hook to stop
  firing. `claude-db status` lists what is still open, and SessionStart injects
  the newest few, so a fresh chat can answer "what was I doing" instead of
  searching for words that a prompt like "do the last task" does not contain.
  Closing is one-way: touching a file again does not reopen finished work, and
  rows written before this release stay `done` rather than all appearing
  unfinished
- **Updating the package is now enough.** The skill and the standing
  instruction were copied to disk at install time, so `npm i -g claude-db` left
  them frozen at whatever shipped when install was last run — you had to
  remember to re-run it. The hooks are registered by absolute path into the
  package, so they always run the current code; SessionStart now compares those
  copies against the packaged ones and repairs them. It only ever refreshes
  what already exists, so nothing is installed behind your back and an
  uninstalled skill is not resurrected
- **`/cdb-scan` now runs in two passes** — the deterministic graph first, then
  the written `profile:*` notes on top of it

### Fixed

- **A NUL byte in `src/capture/manual.ts` made the whole file invisible to**
  **`find_usages`.** It was committed, renders as a space in every editor, and
  made git classify a source file as binary — which `-I` then skipped, so a
  lookup for `remember` returned 32 matches and omitted `remember()`'s own
  definition. The separator is now written as an escape, which is byte-identical
  so no stored id changed. A check now fails if any tracked source file contains
  a NUL, since any such file would be invisible the same way
- **`--context` counted context lines as matches.** `git grep -z` replaces both
  the match and context separators with the same NUL, so `-B`/`-A` output could
  not be told apart from real hits: `total` was inflated, truncation was wrong,
  and context lines consumed the `limit` budget. Context is now reconstructed
  from disk after the real matches are known
- **A `path` pointing at a single file threw instead of scoping to it**, though
  the tool documented that it accepted one — `git -C` requires a directory
- **MongoDB's Atlas vector path scored across embedding models.** Every other
  search path filtered on the embedder that produced a vector; the indexed
  Atlas path did not, so switching models silently ranked incomparable vectors

### Changed

- Prettier now formats the project, with the config checked in
- The CLI, the three store adapters and the test scripts are split by
  responsibility; no source file is over 250 lines

### Upgrading

Nothing changes until you run `claude-db scan`, which builds the graph and adds
three tables. Postgres gains its tables on first connection after the upgrade.

This release adds real dependencies for the first time — the ast-grep parser
and graphology — so an install is roughly 23 MB larger. They are prebuilt, so
there is still no compile step.

## 0.4.1

### Fixed

- **`find_usages`'s `path` param only chose which repository to search, and**
  **never actually scoped the search** — described as "directory to search
  from," but no pathspec was ever passed to `git grep`, so a lookup scoped to
  one folder still searched the whole repository. Caught by using the tool: a
  search for `resolveProject` scoped to `src/usages/` (which does not use it)
  still returned 41 matches from across the repo. An explicit `path` now
  narrows the search for real; omitting it still searches the whole
  repository, since a blast-radius check that silently narrowed by default
  could hide a real usage and give false confidence nothing else depends on it
- The fix itself had the same bug this project keeps tripping on: comparing
  `mkdtempSync`'s temp path against `git rev-parse --show-toplevel`'s result
  failed on macOS, where `/var/folders/...` is a symlink to
  `/private/var/folders/...` — the exact class of mismatch `resolveProject()`
  already guards against with `realpathSync`. Applied the same fix here

### Changed

- The standing instruction written at install sharpens the `find_usages`
  boundary: it is the default for any symbol/identifier lookup, not only
  before editing a shared name; grep still wins for plain text, log files,
  comments, strings, and scoping with grep flags this tool does not expose

## 0.4.0

Claude has had no better option than raw Bash `grep` for "what uses X" or "if
I change this, what breaks" — text matching with no idea whether a hit is the
definition, a real caller, or an unrelated word.

### Added

- **`find_usages`**, a sixth MCP tool, plus `claude-db usages <symbol>`. Wraps
  `git grep`, never a persisted index: this project has already shipped three
  silent-staleness bugs, and a symbol index that drifts from an edit is the
  same failure shape in a new place. A live grep re-derives the answer from
  the current source on every call, so there is nothing to invalidate. Scope
  resolution deliberately does not reuse `resolveProject()` — that can point
  at a directory pooling several sibling repos for memory partitioning, which
  `git grep` cannot search — and resolves its own repo root instead. No
  usage-kind classification (import vs call vs type): the `classifyTurn`
  `because` regression is the direct precedent for why that regex heuristic
  goes wrong. The one exception is a best-effort `[definition?]` marker that
  only annotates an already-shown line rather than filtering anything

### Fixed

- **Untracked and binary files were mishandled in the first pass of the above**
  before it shipped: a brand-new file that hasn't been `git add`ed yet is
  exactly the blast-radius case the tool exists for, and was invisible
  without `--untracked`; a binary file matching the term printed a headerless
  line that corrupted the parser without `-I`. Both caught in review, both
  covered by their own test
- A search-result snippet that only echoes words already in the title is now
  dropped rather than shown, since it was paying for a line that told the
  reader nothing new

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
