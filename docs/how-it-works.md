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

A turn is also saved as soon as Claude finishes the reply, in the background, so
another chat sees it without waiting for your next prompt. The save at the next
prompt stays as the backup, for a reply you interrupted.

Install also writes a short standing instruction into `CLAUDE.local.md` (or
`~/.claude/CLAUDE.md` for a machine-wide install), telling Claude to search
memory before asking you to re-explain something. Hook output is context the
agent may or may not act on; a memory file is a rule for the whole session,
which is what makes recall the default rather than something you have to ask
for. `claude-db uninstall` takes the block back out.

**What gets saved.** One observation per turn, and only if that turn edited a
file or ran a real command. Questions, `grep`, and "ok" are skipped. A busy day
produces 10 to 20 rows, not hundreds.

**What gets injected.** At startup: facts, the newest 5 requests from other
chats, any request another chat has not finished, and the handoff note. Above a prompt, at
most two memories from earlier chats, picked by Claude Haiku:

1. Search finds the ten closest memories from other chats. If none shares at
   least two content words with the prompt, nothing happens and Haiku is not
   called.
2. Haiku reads them with the prompt and the end of Claude's previous reply, and
   picks only memories that hold something specific for this task. Most prompts
   get none.
3. Each pick carries one sentence copied from the memory. The code checks the
   sentence is really in it, so a pick cannot carry a claim the memory does not
   make.
4. The pick runs in the background, so typing is never held up, and reaches
   Claude with its first tool call. A turn that uses no tools does not get it.

A line looks like `- Oct 1: asked "why does the order feed drop after a minute?": The
websocket client sends no heartbeat, so the proxy closes an idle connection after
60 seconds. (id)`: the
day, the question that memory answered, the copied sentence, and the id
`get_observations` expands. Nothing from the current chat is repeated back to
it. Subagent reports, task notifications and slash commands are not prompts, so
they get nothing.

At most 150 picks a day (`pick.dailyLimit`), and a failed call pauses picking
for an hour, then six hours, then a day if calls keep failing, and `claude-db status`
shows why. Without Haiku (off, over the limit, or paused), only a strong word
match is shown: the closest memory, if it shares four content words with the
prompt. `claude-db pick off` turns Haiku off; `claude-db pick` shows today's
count.

**After `/compact`.** Compaction drops the chat's own history, so the start hook
puts back what this chat decided and what it left uncommitted, under "Earlier in
this chat".

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

## Facts

A captured turn is a record of what happened, which makes a poor memory on its
own: its title is whatever sentence Claude happened to write. So when a chat
ends, one small Claude Haiku call reads the chat's saved rows, together with the
facts already known, and writes short facts back: a **rule**, a **decision**
and its reason, a **dead end**, a **to do**, or a lasting **fact**. A fact has
a stable key, so a later chat updates it in place, and Haiku retires a fact the
chat shows is no longer true. The raw rows stay as the evidence.

Facts open each chat, as three short sections: about you, this project, and
where you stopped, each line like `- Decided (Oct 5): All 12 timers fire after
1.1s. (id)`. They are also what `search` finds, and they travel with the
database to other machines. Above a prompt, picks come from earlier chats' rows:
with Haiku picking from either, a picked fact was useful 60% of the time against
69% for a chat's own rows, so facts are not offered there.

Only a **rule** about how you like to work is filed under you, keyed by your
git email, so it follows you into every project and never reaches a teammate
on a shared database. Everything else stays in its project.

The call goes through your own Claude Code login and runs in the background, so
closing a chat stays instant. At most 30 calls a day; a failed call pauses it
(an hour, then six hours, then a day, with the reason in `claude-db distill`)
while capture carries on; a long chat is read in windows of about
40,000 characters, one call each. `claude-db distill off` turns it off, and
`claude-db distill` shows what it has done.

Claude Code's own memory files, `~/.claude/projects/<project>/memory/*.md`, are
imported as facts too, at no AI cost. On the machine where Claude already reads
them they are not repeated; on another machine sharing the database, they are.

**Upgrading.** The first session after an update repairs memory saved under
older capture rules, once and in the background: every chat that still has a
transcript is re-saved, and rows the current rules no longer produce are marked
replaced, kept but left out of search. Older chats are then turned into facts,
newest first, within the daily limit.

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

| mode               | answers                                                     |
| ------------------ | ----------------------------------------------------------- |
| `usages` (default) | what references this symbol, with the relation on each line |
| `explain`          | that, plus what the symbol itself reaches                   |
| `path`             | how two symbols connect                                     |
| `text`             | live `git grep`; needs no scan                              |

`usages` ends with the lines `git grep` finds that the graph could not link, so
it never shows less than a plain search.

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
hooks refresh in the background instead, so they never wait.

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
