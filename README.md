<img src="./assets/wordmark.svg" alt="claude-db" width="330">

**Persistent memory for Claude Code. Bring your own database.**

[![npm](https://img.shields.io/npm/v/claude-db.svg)](https://www.npmjs.com/package/claude-db)
[![CI](https://github.com/Avijit07x/claude-db/actions/workflows/ci.yml/badge.svg)](https://github.com/Avijit07x/claude-db/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D22.5-brightgreen.svg)](https://nodejs.org)

Your agent forgets everything when a session ends. You re-explain the
architecture, why you chose X over Y, and which approaches already failed.

claude-db records that as it happens and gives it back on the next session.
No hosted service, no subscription, no account, no database URL required.

```bash
npm install -g claude-db
cd your-project
claude-db install --project
```

Restart Claude Code. Done.

---

## What it actually remembers

Most memory tools capture file paths, because that is all a tool hook can see.
claude-db reads the session transcript, so it captures **intent and reasoning**:

```
[decision] Chose WebSocket over polling for live order updates

Asked: the plan was not good, the output was really bad, it should
       feel hand made not ai

Polling at 3s hammered the API and still lagged behind. Switched to a
WebSocket subscription with exponential backoff reconnect and a replay
flag so no order is missed during a drop.

Files: src/ws/client.ts, src/ws/reconnect.ts
Ran: Test run: pnpm test
```

Compare that with what a file-watching approach stores: `Write client.ts`.

The prompt is the only record of *what you wanted*. The agent's reply is the
only record of *why it did that*. Both exist in the transcript, and nowhere
else.

## Recall is automatic, not left to the model

| Moment           | Who decides           | Reliability   |
| ---------------- | --------------------- | ------------- |
| Capture          | hook, unconditional   | always        |
| Session start    | hook, unconditional   | always        |
| **Every prompt** | **hook, if relevant** | **always**    |
| Mid-conversation | the agent, via MCP    | its judgment  |

Exposing search as a tool and hoping the agent calls it is unreliable.
`UserPromptSubmit` searches with your prompt text and injects the best match
in full, so the reasoning is already in context before the agent decides
anything.

Three things keep this cheap and quiet:

- **Trivial prompts are rejected before any query runs.** "ok", "continue",
  "thanks" cost 43ms and inject nothing.
- **A relevance floor suppresses noise.** Nearest-neighbour search always
  returns its top k however poor the match, so anything below the embedder's
  measured noise floor is dropped. An unrelated prompt injects nothing at all.
- **A character budget caps the block.**

Measured: about **350 tokens** on a prompt with relevant history, **0** on one
without, 114ms of latency.

## Works fully local, out of the box

```
$ claude-db doctor
database : ~/.claude-memory/memory.db
adapter  : sqlite
reachable: yes
embedder : builtin-hashing (256d)
vectors  : working (256d)
search   : hybrid (keyword + vector)
```

No connection string, no config file, no model download, no network. SQLite
comes from Node's builtin `node:sqlite`, so there is no native compilation
step and nothing to fail at install time.

## Bring your own database

Only needed if you want memory shared across machines. The connection string
picks the backend; nothing else changes.

```bash
claude-db use "mongodb+srv://user:pass@cluster.mongodb.net/memory"
claude-db use "postgres://user:pass@host:5432/memory"
claude-db use "~/.claude-memory/memory.db"   # SQLite, the default
```

Or set `CLAUDE_DB_URL`, which overrides the config file so containers and CI
can share a database without editing anything on disk.

| Backend  | Keyword search   | Vector search                          | Setup                    |
| -------- | ---------------- | -------------------------------------- | ------------------------ |
| SQLite   | FTS5 + bm25      | exact cosine, in process               | none, builtin to Node    |
| MongoDB  | text index       | Atlas `$vectorSearch`, else in process | any Mongo, Atlas not req |
| Postgres | tsvector/ts_rank | pgvector HNSW when available           | any Postgres             |

Every adapter implements one small interface. Ranking, fusion and token
budgeting live outside the adapters, so recall behaves identically no matter
what you plug in. Only the retrieval cost changes.

```bash
npm install mongodb   # only if you use a mongodb:// URL
npm install pg        # only if you use a postgres:// URL
```

## Multiple projects

One database, partitioned by the project's canonical absolute path.

```
$ claude-db projects
*   412  2026-08-15  /Users/you/work/animateicons
     87  2026-08-14  /Users/you/work/shop-api
```

Searches only ever see one row. The project token is indexed inside FTS rather
than applied as a post-match filter, so adding a project costs the others
nothing.

Two limits worth knowing: opening Claude Code in `~/repo` and
`~/repo/packages/web` creates two separate memories, so install at the repo
root. And moving a project orphans its memory, since the path is the key;
`claude-db flush` rebuilds it.

## Commands

```
claude-db install [--project]    register hooks + MCP server
claude-db uninstall [--project]  remove them, leaving memory intact
claude-db status                 is it wired up, has it recorded anything
claude-db doctor                 resolved config and connectivity
claude-db use <url>              switch database and verify it
claude-db search <query>         search this project's memory
claude-db projects               every project with memory
claude-db flush                  re-ingest every transcript for this project
claude-db reset [--project] --yes  delete memory (dry run without --yes)
```

`cdb` is a shorter alias for all of the above.

`--project` scopes to one repo via `.claude/settings.local.json` and
`.mcp.json`, instead of every project on the machine. Add `.mcp.json` to your
`.gitignore`: it holds an absolute path that would break for teammates.

## The part worth stealing: progressive disclosure

Naive memory search returns whole records and burns thousands of tokens on
results the agent throws away. Retrieval here is split into three layers, so
the agent pays for detail only after deciding what is relevant.

```
search()            compact index, ~50-100 tokens per hit, no bodies
timeline()          chronological neighbours of a promising hit
get_observations()  full bodies, only for hand-picked ids
```

Filter at layer 1, expand at layer 3. That is where the roughly 10x saving
comes from. These are exposed as three MCP tools whose descriptions state the
intended order, because the saving only materialises if the agent filters
before fetching.

### Hybrid ranking

Keyword scores (bm25, ts_rank) and vector scores (cosine) live on
incompatible scales, so normalising one against the other is guesswork.
claude-db uses Reciprocal Rank Fusion instead: it discards magnitudes and
fuses on rank position alone, which needs no per-backend tuning. A mild
recency boost follows, 45-day half life with a floor, so a recent decision
edges out an equally relevant old one without burying it.

## Privacy

Nothing leaves your machine unless you point it at a remote database.

- Paths matching `capture.exclude` (`.env`, `secrets`, `node_modules`,
  `.git/`) are never persisted
- Text wrapped in `<private>...</private>` is stripped before storage
- API keys, GitHub tokens and `password`/`secret`/`token` values are redacted
  by pattern before anything is written

Embeddings are computed locally in both modes. There is no API key, no
per-token cost, and no path that sends your code to a third party.

## Embedding providers

| Provider  | Install cost   | What it catches                                    |
| --------- | -------------- | -------------------------------------------------- |
| `auto`    | none           | default: tries `local`, falls back to `builtin`     |
| `builtin` | none           | morphology and typos: `reconnect` ~ `reconnecting`  |
| `local`   | ~25MB download | real semantics: `car` ~ `automobile`                |
| `none`    | none           | keyword only                                        |

The builtin embedder uses the hashing trick over word and character trigrams.
Being honest about it: that is lexical similarity, not meaning. It will match
`reconnect` to `reconnecting` where FTS5 token matching fails, but it will not
match `car` to `automobile`. It exists so a zero-config install gets fuzzy
recall rather than nothing.

```bash
npm install @xenova/transformers   # upgrade to real sentence embeddings
```

`auto` probes the model with a real inference call, so a broken ONNX runtime
degrades silently instead of failing.

## Configuration

Everything is optional. These are the defaults with no file present.

`~/.claude-memory/config.json`:

```json
{
  "database": "",
  "embeddings": { "provider": "auto", "maxScanCandidates": 25000 },
  "capture": {
    "tools": ["Edit", "Write", "Bash", "NotebookEdit"],
    "exclude": [".env", "secrets", "node_modules", ".git/"],
    "maxBodyChars": 4000
  },
  "inject": {
    "sessions": 5,
    "maxChars": 6000,
    "perPrompt": true,
    "promptResults": 4,
    "promptMaxChars": 500,
    "expandTop": 1,
    "expandMaxChars": 900
  }
}
```

Set `inject.perPrompt` to `false` for tool-only recall.

## How it works

```
SessionStart     inject summaries of recent sessions
UserPromptSubmit flush the previous turn, then inject relevant memory
SessionEnd       final flush and close
```

Memory is written **on every prompt**, not only at session end. A prompt is
the moment the previous turn is provably finished, and it is the one event
guaranteed to fire while a session is alive. Sessions that crash, are
force-quit, or stay open for days never reach `SessionEnd`.

That is only safe because observation ids are content-derived
(`sha256(session + turn timestamp + prompt)`), so re-reading a turn rewrites
the same row instead of appending a duplicate. A byte cursor per session means
each flush parses only the new tail, which matters because these transcripts
reach 90MB.

## Failure behaviour

A memory layer that breaks your session is worse than one that forgets, so
degradation is deliberate and tested:

- A hook that throws logs to stderr and exits 0. It never fails your session.
- If the sentence-transformer is unavailable, `auto` falls back to the builtin
  and hybrid search keeps working.
- If embedding fails outright, observations are still persisted.
- If a backend cannot do vector search, fusion proceeds with keyword results.

## Requirements

Node 22.5 or newer. That is the only hard requirement. `mongodb`, `pg` and
`@xenova/transformers` are optional peers, loaded lazily, only if you opt in.

## Development

```bash
git clone https://github.com/Avijit07x/claude-db
cd claude-db
npm install
npm run build
npm test      # 87 checks
npm run try   # simulate a session end to end, touches nothing
npm run bench # scaling curve
```

CI runs on Node 22 and 24, on Linux and macOS. macOS is not optional there:
`/tmp` is a symlink to `/private/tmp`, which is exactly the case that once
split a single project's memory in two.

See [RELEASING.md](./RELEASING.md) for the publish process.

## License

Apache-2.0
