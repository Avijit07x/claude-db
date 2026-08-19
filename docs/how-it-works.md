# How claude-db works

The [README](../README.md) covers what it is and how to use it. This is the
part underneath: what gets captured, what gets given back, and how the code
graph stays honest.

## Capture

Claude Code already writes every session to disk as JSONL: your prompts, its
replies, every tool call. claude-db reads that file, so it captures **why** you
did something, not just which files changed.

```
you send a prompt
      │
      ├─ 1. save the previous turn
      │     read new lines from the session transcript
      │     keep turns that changed something
      │     store title + reasoning + files, with an embedding
      │
      └─ 2. search memory using your prompt
            inject the best match above your message
```

Both steps are hooks, so they always run. Nothing depends on Claude deciding to
look something up.

Install also writes a short standing instruction into `CLAUDE.local.md` (or
`~/.claude/CLAUDE.md` for a machine-wide install), telling Claude to search
memory before asking you to re-explain something. Hook output is context the
agent may or may not act on; a memory file is a rule for the whole session,
which is what makes recall the default rather than something you have to ask
for. `claude-db uninstall` takes the block back out.

**What gets saved.** One observation per turn, and only if that turn edited a
file or ran a real command. Questions, `grep`, and "ok" are skipped. A busy day
produces 10 to 20 rows, not hundreds.

**What gets injected.** Recent session summaries at startup, plus the single
best match in full on each prompt. Roughly 350 tokens when something relevant
exists, zero when it doesn't.

**What search returns.** An id, kind, date, title and one line of the matching
body, enough to tell two similarly-titled rows apart without expanding either.
Full bodies come only from `get_observations`, for ids you picked.

One stored memory looks like this:

```
[decision] Chose WebSocket over polling for live order updates

Asked: the order feed keeps dropping

Polling at 3s hammered the API and still lagged behind. Switched to a
WebSocket subscription with exponential backoff and a replay flag, so no
order is missed during a drop.

Files: src/ws/client.ts, src/ws/reconnect.ts
Ran: Test run: pnpm test
```

## Unfinished work

A captured turn is stored `open`, and closes when every file it touched has
been committed. That check runs inside the flush that already happens on each
prompt, so nothing new has to fire for it to stay accurate, and a stored flag
that drifted from reality would be corrected on the next flush anyway.

Closing is deliberately one-way. Editing a file again does not reopen work that
already landed, or a finished task would flicker back into the list every time
a neighbouring line changed.

`claude-db status` lists what is still open, and SessionStart injects the
newest few. That is what lets a brand-new chat answer "what was I doing".
Memory search ranks by relevance, and a prompt like "do the last task" contains
no words worth matching, so recency has to come from somewhere else.

Rows captured before this existed default to `done`. Marking a whole existing
database unfinished would be worse than saying nothing.

## Staying current

`claude-db install` copies two things to disk: the `/cdb-scan` skill, and a
standing instruction block in `CLAUDE.local.md`. Claude Code only reads skills
from `~/.claude/skills/`, so a copy has to exist there, but a copy drifts as
soon as the package updates.

The hooks are registered by absolute path into the installed package, so they
always run the current code even when those copies are stale. SessionStart
compares them against what shipped and rewrites them when they differ, which
makes `npm i -g claude-db` sufficient on its own and returns `install` to being
a one-time step.

It only refreshes files that already exist. Nothing is created behind your
back, and anything `uninstall` removed stays removed.

## The code graph

`claude-db scan` parses every supported source file and stores what it finds:
each symbol, and each relationship between symbols: what calls what, what
imports what, what extends what. Parsing is local and deterministic, costs no
tokens, and takes about a second on a mid-size repository. A rescan only
re-parses files whose contents changed.

`find_usages` then answers in four modes, over MCP as well as the CLI:

| mode             | answers                                                     |
| ---------------- | ----------------------------------------------------------- |
| `text` (default) | live `git grep`; needs no scan and is never stale           |
| `usages`         | what references this symbol, with the relation on each line |
| `explain`        | that, plus what the symbol itself reaches                   |
| `path`           | how two symbols connect                                     |

```
Shortest path (4 hops):
  cmdScan --> scanRepository --> extractFile --> symbolId --> observationId
```

**Every edge carries its confidence.** `EXTRACTED` means the relationship was
read literally out of the syntax tree. An import names its own target, so
nothing is guessed. `INFERRED` means the target was matched by name across
files, which is wrong when two files export the same identifier, and carries a
score saying how sure the match was. Name matching is the one guess this makes,
so it is labelled rather than presented as fact.

**A stored index can go stale, and this one is not allowed to.** Every graph
query hashes the working tree first and re-parses whatever changed before
answering, so it cannot report a line the source has already moved past. The
SessionStart hook does the same refresh in the background for repositories that
have been scanned, but correctness does not depend on it having run.

Traversal is keyed on symbol id rather than name. Keying by name would merge
every same-named symbol into one node, and a repository with a `run` in each
test file would then grow shortcuts between unrelated code, making the
shortest path a route nothing can actually take.

Languages: TypeScript, TSX, JavaScript, Python, Go and Rust. The parser is
ast-grep, which ships with the package as a prebuilt binary per platform, so
nothing compiles at install and nothing else has to be installed.

## The `/cdb-scan` skill

Installed alongside the hooks, it runs two passes: `claude-db scan` for the
graph, then five written notes (stack, layout, conventions, workflows,
architecture) stored under stable keys so a re-run updates them in place.

The graph records what the code _is_; the notes record why it is built that
way. Those notes are tagged `inferred`, because they are Claude's reading of
the code rather than a record of anything that happened. Everything else in the
database is testimony, and a search result must not blur the two.

## Databases

SQLite by default, at `~/.claude-memory/memory.db`. The connection string picks
the backend, and `CLAUDE_DB_URL` overrides the config file.

Search is hybrid, keyword plus vector, on all three backends. Ranking, fusion
and token budgeting live in `src/search` rather than in the adapters, so recall
behaves identically no matter which database is plugged in; only retrieval cost
changes. Memory is partitioned by project path, so one database serves every
repo you work in.

MongoDB Atlas can index vector search instead of scanning brute-force, but
Atlas indexes are not created by this tool. Add one by hand on the
`observations` collection:

```json
{
  "name": "memory_vector",
  "type": "vectorSearch",
  "fields": [
    { "type": "vector", "path": "embedding", "numDimensions": 256, "similarity": "cosine" },
    { "type": "filter", "path": "project" },
    { "type": "filter", "path": "kind" },
    { "type": "filter", "path": "tags" },
    { "type": "filter", "path": "createdAt" }
  ]
}
```

`numDimensions` is 256 for the builtin embedder, 384 once
`@xenova/transformers` is installed. Without this index Mongo still works,
vector search falls back to scoring candidates in process.
