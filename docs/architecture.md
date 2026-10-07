# claude-db: the whole picture

What claude-db is, what each part does, why it exists, and when it runs. Every part has a diagram and a
worked example. The examples use an invented shop project, never real data.

This is the long version. [how-it-works.md](./how-it-works.md) is the short one, and
[setup-guide.md](./setup-guide.md) covers settings.

## Contents

1. [The problem and the idea](#1-the-problem-and-the-idea)
2. [The big picture](#2-the-big-picture)
3. [One chat from start to end](#3-one-chat-from-start-to-end)
4. [Capture: saving what happened](#4-capture-saving-what-happened)
5. [Search: finding it again](#5-search-finding-it-again)
6. [Picks: the right memory with each prompt](#6-picks-the-right-memory-with-each-prompt)
7. [Facts: turning chats into rules and decisions](#7-facts-turning-chats-into-rules-and-decisions)
8. [What a new chat starts with](#8-what-a-new-chat-starts-with)
9. [After `/compact`](#9-after-compact)
10. [The code graph and `find_usages`](#10-the-code-graph-and-find_usages)
11. [The MCP tools](#11-the-mcp-tools)
12. [Commands](#12-commands)
13. [Where the data lives](#13-where-the-data-lives)
14. [Privacy and safety](#14-privacy-and-safety)
15. [How the Haiku calls find `claude`](#15-how-the-haiku-calls-find-claude)
16. [Limits, budgets and what happens when a call fails](#16-limits-budgets-and-what-happens-when-a-call-fails)
17. [Install, update and uninstall](#17-install-update-and-uninstall)
18. [The code, folder by folder](#18-the-code-folder-by-folder)
19. [Testing and releasing](#19-testing-and-releasing)
20. [Which part do I use when](#20-which-part-do-i-use-when)
21. [Words used in this project](#21-words-used-in-this-project)

---

## 1. The problem and the idea

**The problem.** Every Claude Code chat starts from zero. You spend an hour explaining why the order feed
uses a WebSocket and not polling, which approach you tried and dropped, and which function must not be
touched. The next day Claude knows none of it, so you explain it again. It also works out "what calls what"
from scratch each time, by grepping and reading files.

**The idea.** Give Claude two things that last:

1. **A memory.** What was done and why, saved from your real chats and handed back at the right moment.
2. **A map of the code.** Every symbol and how they connect, so "who uses this" is one call.

```
 WITHOUT claude-db                         WITH claude-db

 Monday:   "use a WebSocket, polling       Monday:   "use a WebSocket, polling
            hammered the API"                         hammered the API"     ──┐
                                                                              │ saved
 Tuesday:  Claude: "should the feed        Tuesday:  Claude already sees:     ▼
            poll or use a WebSocket?"                 "Decided (Mon): WebSocket,
            you: explain it all again                  polling hammered the API"
```

**Why it works the way it does.** Three choices shape everything:

- **It reads what Claude Code already writes.** Claude Code saves every chat to disk as a JSONL file.
  claude-db reads that, so it needs no extra effort from you and captures the _reason_, not just the file
  changes.
- **Recall is a hook, not a request.** A hook always runs. Nothing depends on Claude deciding to look
  something up.
- **Your data stays yours.** It is a local database by default, with no cloud and no account. Postgres and
  MongoDB are options for sharing across machines.

---

## 2. The big picture

```
┌──────────────────────────── Claude Code (the chat you use) ───────────────────────────┐
│                                                                                       │
│   you type a prompt ──► Claude thinks ──► Claude uses tools ──► Claude replies        │
│        │                                      │                       │               │
└────────┼──────────────────────────────────────┼───────────────────────┼───────────────┘
         │ hooks (small scripts Claude Code runs at fixed moments)       │
         ▼                                      ▼                       ▼
 ┌───────────────┐   ┌───────────────┐  ┌───────────────┐      ┌───────────────┐
 │ SessionStart  │   │UserPromptSubm.│  │  PreToolUse   │      │  SessionEnd   │
 │ give facts    │   │ save last turn│  │ deliver pick  │      │ save, then    │
 │ refresh graph │   │ start a pick  │  │ answer grep   │      │ make facts    │
 └──────┬────────┘   └──────┬────────┘  └──────┬────────┘      └──────┬────────┘
        │                   │                  │                      │
        └───────────────────┴─────────┬────────┴──────────────────────┘
                                      ▼
 ┌─────────────────────────── claude-db core (src/) ─────────────────────────────┐
 │  capture      search       facts        pick        graph        redact       │
 │  transcript   keyword +    Haiku makes  Haiku picks parse code   removes      │
 │  → memory     vector       rules,       1-2 memories → symbols   secrets      │
 │               + recency    decisions    per prompt   + edges     first        │
 └───────────────────────────────────┬───────────────────────────────────────────┘
                                     │ one adapter interface
                 ┌───────────────────┼────────────────────┐
                 ▼                   ▼                    ▼
           SQLite (default)       Postgres              MongoDB
        ~/.claude-memory/        shared across         shared across
            memory.db             machines              machines

 Claude can also ASK, any time, through the MCP server (a long-running helper):
   search · get_observations · timeline · remember · forget · find_usages

 You can drive it from a terminal with the claude-db command (status, doctor, view, distill, ...).
```

Two ways in, one store:

| Way in     | Who starts it                  | Used for                                          |
| ---------- | ------------------------------ | ------------------------------------------------- |
| Hooks      | Claude Code, at fixed moments  | Saving, giving facts, delivering picks, grep help |
| MCP server | Claude, when it chooses to ask | Searching, opening a note, remembering, usages    |
| CLI        | You, in a terminal             | Setup, health, backup, switching database         |

---

## 3. One chat from start to end

When each part runs, using one short chat about the shop's order feed.

```
TIME ─────────────────────────────────────────────────────────────────────────────►

 open chat        you: "the order       Claude edits         Claude replies     close chat
                   feed keeps            src/ws/client.ts     "added a heartbeat"
                   dropping"
    │                  │                      │                     │                │
    ▼                  ▼                      ▼                     │                ▼
 SessionStart     UserPromptSubmit        PreToolUse                │           SessionEnd
    │                  │                      │                     │                │
    │ gives:           │ 1. saves the         │ pick-deliver:       │                │ 1. saves the last turn
    │  about you       │    PREVIOUS turn     │  hands over the     │                │ 2. marks chat ended
    │  this project    │ 2. looks up memory   │  pick, if ready     │                │ 3. starts the facts
    │  where you       │ 3. starts a pick     │                     │                │    job in background
    │  stopped         │    in background     │ (and if Claude      │                │
    │ refreshes graph  │                      │  runs grep for a    │                ▼
    │ shows scan hint  │                      │  symbol, prefer-    │         Haiku writes facts:
    ▼                  ▼                      │  usages answers     │         "Decided: heartbeat
 Claude sees:      background:                │  from the graph)    │          every 20s, proxy
 ┌──────────────┐  Haiku reads 10            ▼                     │          closes idle at 60s"
 │<memory>      │  candidates, picks 1    Claude sees:              │
 │ Decided (Mon)│  and quotes it          ┌─────────────────────┐   │
 │ WebSocket... │        │                │<memory>             │   │
 └──────────────┘        └──────────────► │ - Oct 1: asked "why │   │
                                          │   does the feed     │   │
                                          │   drop?": the client│   │
                                          │   sends no heartbeat│   │
                                          │   (a1b2c3d4-e5f6)   │   │
                                          └─────────────────────┘   │
```

The same events in a table:

| Moment             | Hook file          | What it does                                                                                       |
| ------------------ | ------------------ | -------------------------------------------------------------------------------------------------- |
| Chat opens         | `session-start.js` | Gives facts, refreshes the graph, hints to scan, shows update notice                               |
| You send a prompt  | `user-prompt.js`   | Saves the previous turn, searches memory, starts a pick                                            |
| Claude uses a tool | `pick-deliver.js`  | Hands over a finished pick (every tool, 5 s limit)                                                 |
| Claude greps       | `prefer-usages.js` | If it greps a known code symbol, blocks the grep and returns the graph answer (Bash or Grep, 10 s) |
| Chat closes        | `session-end.js`   | Saves the last turn, ends the session, starts the facts job                                        |

Every hook catches its own errors and exits with success. A broken memory never stops your chat.

---

## 4. Capture: saving what happened

**What.** After each turn, claude-db turns what happened into one **observation**: a short saved record with a
kind, a title, a body, the files touched and the commands run.

**Why.** Claude Code's chat file is long and noisy. A good memory is short and says why. Capturing at the
turn level, and only the turns that matter, keeps 10 to 20 rows a day, not hundreds.

**When.** At each prompt (the previous turn), at chat end (the last turn), and on `claude-db flush`.

```
 ~/.claude/projects/<project>/<session>.jsonl         (Claude Code writes this)
        │  read only the NEW lines (a cursor remembers where it stopped)
        ▼
   turns:  prompt + Claude's reasoning + files edited + commands run
        │
        ├─ strip  <private>...</private>      →  "[private]"
        ├─ keep only turns that changed something or answered a real question
        ├─ remove secrets (keys, tokens, passwords)           ← redact
        ▼
   one observation per kept turn  ──► store (with an embedding for vector search)
```

**What is kept and what is skipped:**

| Turn                                       | Saved? | Why                               |
| ------------------------------------------ | ------ | --------------------------------- |
| Edited a file                              | Yes    | It changed the project            |
| Ran a real command (tests, build, install) | Yes    | It changed or checked the project |
| Asked a question and got a real answer     | Yes    | The answer may matter later       |
| `ok`, `thanks`, a bare `grep`, a file read | No     | Nothing to remember               |
| Text inside `<private>...</private>`       | Hidden | Replaced by `[private]`           |

**One saved observation looks like this:**

```
[decision] Chose WebSocket over polling for live order updates

Asked: the order feed keeps dropping

Polling at 3s hammered the API and still lagged behind. Switched to a
WebSocket subscription with exponential backoff and a replay flag, so no
order is missed during a drop.

Files: src/ws/client.ts, src/ws/reconnect.ts
Ran: Test run: pnpm test
```

The six kinds: `decision`, `pattern`, `bugfix`, `context`, `deadend`, `preference`.

**Safe to repeat.** An observation's id is made from the session, the time and the prompt. Reading the same
chat twice produces the same ids, so nothing is saved twice.

---

## 5. Search: finding it again

**What.** One search that mixes three signals, so a note is found by its words _and_ by its meaning, and
newer notes win a tie.

**Why.** Words alone miss a note that says "heartbeat" when you ask about "keepalive". Meaning alone misses
an exact name like `useAuth`. Together they cover both.

**When.** On every prompt (to find candidates), whenever Claude calls `search`, and when you run
`claude-db search`.

```
   query: "why does the order feed drop"
        │
        ├──► keyword search (FTS5, BM25)  ──► ranked list A     exact words, rare words count more
        │
        ├──► vector search (cosine)       ──► ranked list B     similar meaning
        │
        ▼
   fuse A and B  (reciprocal rank fusion: a note near the top of both wins)
        │
        ▼
   recency boost  (a note loses a little weight as it ages; half-life 45 days)
        │
        ▼
   top results:  id · kind · date · title · one matching line
```

Search returns only a short line per result. The full text comes from `get_observations`, for the ids you
choose. That keeps a search cheap.

```
$ claude-db search order feed drop
a1b2c3d4-e5f6  decision    2026-10-01  Chose WebSocket over polling for live order updates
              …Polling at 3s hammered the API and still lagged behind. Switched to a…
f6e5d4c3-b2a1  bugfix      2026-10-02  The websocket client sends no heartbeat
              …the proxy closes an idle connection after 60 seconds…
```

**Embeddings.** The built-in embedder is a 256-number hashing scheme. It needs nothing installed and is
keyword-grade. Installing `@xenova/transformers` switches to a 384-number model for real semantic matching,
and `claude-db reembed` recomputes the old rows.

**The same on every database.** Ranking, fusion and the recency boost live in `src/search`, not in the
database adapters. SQLite, Postgres and MongoDB give the same results; only the retrieval speed differs.

---

## 6. Picks: the right memory with each prompt

**What.** Before Claude answers, claude-db shows one or two earlier notes that fit what you just asked. A
small model, Claude Haiku, chooses them.

**Why.** Showing the top search hits is noisy. Measured on a real project, only about 1 in 4 shown memories
was useful that way. A picker that reads the prompt and the candidates reached 61% to 70%. Most prompts need no
memory at all, and the picker is allowed to choose none.

**When.** On every prompt, in the background, so typing is never held up.

```
 you send:  "the order feed keeps dropping and I do not know why"
      │
      ▼
 1. SEARCH   top 10 notes from OTHER chats in this project
      │
      ▼
 2. GATE     does any candidate share at least 2 content words with the prompt?
      │          no ──► stop. Haiku is not called. Nothing is shown.
      │          yes
      ▼
 3. BUDGET   under 150 picks today, and not paused?
      │          no ──► fallback: show the closest note only if it shares 4 words
      │          yes
      ▼
 4. HAIKU    reads: end of Claude's previous reply + the prompt + the 10 candidates
      │         returns up to 2 picks, each with ONE sentence copied from the note
      ▼
 5. CHECK    is that sentence really inside the note?   no ──► the pick is dropped
      │
      ▼
 6. DELIVER  waits for Claude's first tool call, then adds it above the next step
```

**Example.** The ten candidates include these two. Haiku picks the first and quotes it:

```
 m1  "Order feed needs a heartbeat. Asked: why does the order feed drop after a minute?
      The websocket client sends no heartbeat, so the proxy closes an idle connection
      after 60 seconds."                                                     ← picked
 m2  "Totals round half up. Order totals round half up to whole cents."       ← not related

 What Claude sees:
 <memory>
 - Oct 1: asked "why does the order feed drop after a minute?": The websocket client
   sends no heartbeat, so the proxy closes an idle connection after 60 seconds. (a1b2c3d4-e5f6)
 </memory>
 (context ≈ 62 tokens)
```

**Rules that keep it honest:**

- The quoted sentence is copied and then checked. A pick cannot carry a claim the note does not make.
- Notes from the current chat are never offered. Nothing is repeated back to the chat that wrote it.
- Facts are not offered here. A picked fact was useful 60% of the time against 69% for a chat's own rows.
- A turn that uses no tool gets no pick, because delivery happens at the first tool call.
- Subagent reports, task notifications and slash commands are not prompts, so they get nothing.

**Cost.** About 20 tokens a prompt on average, and nothing on most prompts. The measurements are in
[memory-improvements.md](./memory-improvements.md), section 7.

---

## 7. Facts: turning chats into rules and decisions

**What.** When a chat ends, one small Haiku call reads that chat's saved rows and writes short **facts**.

**Why.** A captured turn is a record of what happened, and its title is whatever sentence Claude wrote. That
is a weak memory. A fact is the lesson: "rule", "decision and why", "dead end", "to do". The raw rows stay as
the evidence.

**When.** After a chat ends (`session-end.js` starts it in the background), or any time with
`claude-db distill --backfill`.

```
 chat ends
    │
    ▼
 read the chat's saved rows  (split into windows of about 40,000 characters, at most 6)
    +
 the facts already known for this project and for you   (up to 80)
    │
    ▼
 Haiku writes / updates / retires facts          (one call per window, up to 120 s each)
    │
    ▼
 each fact has a stable KEY, so a later chat updates it in place
 and Haiku retires a fact the new chat proves is no longer true
```

**The five fact types:** `rule`, `decision`, `deadend`, `todo`, `fact`.

**Example.** After a chat about the order feed:

```
 type       key                          text
 ─────────  ───────────────────────────  ─────────────────────────────────────────────────────
 decision   order-feed-websocket         Use a WebSocket for the order feed, because polling
                                        hammered the API.
 deadend    order-feed-long-polling      Long polling was tried and dropped: it lagged behind.
 rule       prefer-pnpm                  User wants pnpm in this repo, not npm.   ← filed under YOU
 todo       order-feed-heartbeat         Add a 20 s heartbeat; the proxy closes idle sockets at 60 s.
```

Only a **rule** about how you like to work is filed under you, and it follows you to every project. The
rest belong to the project.

**Where facts show up:** at the start of every chat (section 8), in `search` results, and in the database
that travels to other machines.

---

## 8. What a new chat starts with

At `SessionStart`, claude-db gives three short sections and a line of context cost:

```
<memory>
About you:
- Rule (Oct 6): User wants pnpm in this repo, not npm. (3f373669-1fa7)

This project:
- Decided (Oct 5): Use a WebSocket for the order feed, because polling hammered the API. (e7fc292e-0df9)
- Dead end (Oct 5): Long polling was tried and dropped: it lagged behind. (e14ea0c9-ef45)

Where you stopped:
- Not committed: heartbeat in src/ws/client.ts
</memory>
Search this project's full history with the memory MCP tools before asking the user to re-explain prior decisions.
(context ≈ 210 tokens)
```

Also at this moment:

- A **hint to scan** if the repository has no code graph yet.
- An **update notice** if a newer compatible version exists (`updates` setting: `notify` by default).
- A **one-time notice** that explains the facts feature, shown once per notice version.
- Facts a chat already knows from Claude Code's own memory files are not repeated.
- If there are no facts yet (a fresh install), older session summaries are shown instead.

---

## 9. After `/compact`

`/compact` shrinks Claude's chat history, so it forgets what _this chat_ decided. When the chat reopens after a
compact, the start hook puts those back, under **Earlier in this chat**: what this chat decided, the dead
ends it hit, and what it left uncommitted (up to 8 lines).

```
 /compact ──► SessionStart (source: compact) ──► flush the chat, then show:

 Earlier in this chat:
 - Decided: heartbeat every 20 s
 - Dead end: long polling lagged
 - Not committed: src/ws/client.ts
```

---

## 10. The code graph and `find_usages`

**What.** `claude-db scan` parses your source files and stores every **symbol** (function, class, method,
type, constant) and every **edge** between them (calls, imports, extends, implements, references, defines).

**Why.** "Who calls this?" is the question Claude asks before editing, renaming or deleting. Answering it with
grep and reading files costs many tokens and cannot tell a call from an import. The graph answers in one call,
measured 2.0 times cheaper than grep and reading on eight real symbols.

**When.** Scan once (or let `SessionStart` refresh it). Ask any time with `find_usages` or `claude-db usages`.

```
 source files ──► parser (ast-grep, local, no tokens) ──► symbols + edges ──► database
                  TypeScript, TSX, JavaScript, Python, Go, Rust, Ruby,
                  and more by pattern

 symbols:  id · name · kind · file · line · signature
 edges:    from symbol ──relation──► to symbol      with a confidence tag

 EXTRACTED  read literally from the syntax          "import { cart } from './cart'"
 INFERRED   matched by name across files, scored    wrong if two files export the same name
```

**Four modes of `find_usages`:**

| Mode             | Answers                                       | Needs a scan |
| ---------------- | --------------------------------------------- | ------------ |
| `text` (default) | live `git grep`, never stale                  | No           |
| `usages`         | what references the symbol, with the relation | Yes          |
| `explain`        | that, plus what the symbol itself reaches     | Yes          |
| `path`           | the shortest chain between two symbols        | Yes          |

**Example: `usages`.**

```
$ claude-db usages --mode usages recordFailure

recordFailure  [function]
  Source: src/util/daily-budget.ts:83
  export function recordFailure(name: string, reason: string, now = Date.now()): void {
  Referenced by (2):
    <-- recordDistillFailure  [calls] [INFERRED 0.95]  src/facts/budget.ts:16
    <-- recordPickFailure     [calls] [INFERRED 0.95]  src/pick/run.ts:32
```

**Example: `path`.**

```
Shortest path (4 hops):
  cmdScan --> scanRepository --> extractFile --> symbolId --> observationId
```

**Never stale.** Every graph query hashes the working tree first and re-parses only the files that changed,
so it cannot report a line the source has moved past.

**The grep helper.** The `prefer-usages.js` hook watches for Claude running `grep`, `rg` or the Grep tool on
a code symbol that the graph knows. By default it **blocks** that grep and puts the graph's answer in the
reason, so Claude sees the callers and inherits at once and nothing needs re-running. It shows at most two
symbols and 14 lines each, and ends with "more via find_usages". A grep for plain text, or for a name the
graph does not know, runs as normal.

| `CLAUDE_DB_USAGES_HOOK` | What happens                                               |
| ----------------------- | ---------------------------------------------------------- |
| `deny` (default)        | The grep is blocked, and the graph answer is shown instead |
| `directive`             | The grep runs, and the graph answer is added as context    |
| `off`                   | The hook does nothing                                      |

**Known gaps** (measured, with plans in [find-usages-accuracy.md](./find-usages-accuracy.md)): the graph does
not yet list the files that import a symbol, and it merges symbols that share a name.

**The `/cdb-scan` skill** is the second pass. After `claude-db scan` builds the graph, the skill writes five
notes: stack, layout, conventions, workflows and architecture. They are tagged `inferred`, because they are
Claude's reading of the code, not a record of anything that happened. It exists so a fresh install has
something to find on day one.

---

## 11. The MCP tools

The MCP server is a small long-running helper that Claude Code starts. Claude calls these when it chooses to.

| Tool               | What it does                                           | Use it for                             |
| ------------------ | ------------------------------------------------------ | -------------------------------------- |
| `search`           | Hybrid search, one short line per hit                  | "Why is it like this?", past decisions |
| `get_observations` | Full text of notes, by id                              | Reading the ids worth reading          |
| `timeline`         | Notes before and after one note                        | "What else happened around then?"      |
| `remember`         | Saves a note now (kind, optional key)                  | A standing rule you just stated        |
| `forget`           | Deletes notes by id, or clears one session's summary   | Removing a wrong or private note       |
| `find_usages`      | Who uses a symbol: `text`, `usages`, `explain`, `path` | Before editing, renaming or deleting   |

A standing instruction block in `CLAUDE.local.md` tells Claude to search memory before asking you to explain a
past decision, and to use `find_usages` for symbols. A hook's output is only context Claude may skip. A rule in
the instruction file holds for the whole chat, so recall becomes the default.

---

## 12. Commands

`cdb` is a short alias for `claude-db`.

| Group      | Command                              | What it does                                                      |
| ---------- | ------------------------------------ | ----------------------------------------------------------------- |
| Setup      | `install [--project]`                | Register hooks and the MCP server (`--project`: this repo only)   |
|            | `uninstall [--project]`              | Remove them, keeping memory                                       |
|            | `update`                             | Install a newer compatible release now                            |
| Health     | `status`                             | Wired up? When did it last record? Pick and facts state           |
|            | `doctor [--deep]`                    | Show the config; `--deep` proves write, search, read and delete   |
|            | `adoption`                           | How often chats grep versus use the memory tools                  |
| Memory     | `search [--all] <query>`             | Search this project or all projects                               |
|            | `remember [--kind k] [--key name]`   | Save a note or house rule                                         |
|            | `forget <id>...`                     | Delete notes                                                      |
|            | `stats`, `projects`, `view`          | See what is stored, in a terminal or in the browser               |
| Haiku      | `distill [on\|off] [--backfill]`     | Facts: status, switch, or build now for waiting chats             |
|            | `pick [on\|off]`                     | Picks: status or switch                                           |
| Code graph | `scan [--force]`                     | Build or refresh the graph                                        |
|            | `usages [--mode m] <symbol>`         | Ask the graph or `git grep`                                       |
| Data       | `export`, `import`, `sync <url>`     | Back up, restore, or two-way merge with another database          |
|            | `use <url>`                          | Switch database, after checking it answers                        |
|            | `merge [<old-path>]`                 | Move memory from an old project path onto this one                |
|            | `reembed`, `redact`, `flush`, `seed` | Recompute vectors, re-clean secrets, re-read chats, fill from git |
|            | `prune --older-than <days>`, `reset` | Delete old or all memory (a dry run without `--yes`)              |

---

## 13. Where the data lives

```
~/.claude-memory/                    (CONFIG_DIR)
 ├── config.json                     your settings (database, limits, switches)
 ├── memory.db                       the SQLite database (default)
 ├── claude-binary                   path of the claude program, saved by hooks
 ├── update.json                     update-check state
 ├── cursors/<session>.offset        how far each chat file has been read
 ├── pick/
 │    ├── budget.json                picks used today, pause, failures
 │    └── pending/<session>.json     a pick waiting for the next tool call
 └── distill/
      └── budget.json                facts calls used today, pause, failures
```

Inside the database (SQLite names; Postgres and MongoDB keep the same shapes):

| Table              | Holds                                                         |
| ------------------ | ------------------------------------------------------------- |
| `sessions`         | One row per chat: project, start, end, summary                |
| `observations`     | The notes and facts, with kind, body, files, tags, embedding  |
| `observations_fts` | The keyword index over observations                           |
| `symbols`          | The code graph's symbols                                      |
| `symbol_edges`     | The graph's edges, with relation and confidence               |
| `scanned_files`    | A hash per scanned file, so a rescan parses only what changed |

A **project** is the git repository root of the folder you work in, so one database serves every repo.
Facts are kept in a reserved session named `facts`.

---

## 14. Privacy and safety

- **Local first.** The default database is one file on your disk. Nothing goes to a cloud service.
- **Secrets are removed before saving.** The redaction step replaces these with a marker:

| Pattern                                         | Becomes                  |
| ----------------------------------------------- | ------------------------ |
| `sk-...` API keys, `AKIA...` AWS keys           | `[redacted-key]`         |
| `ghp_...`, `xox...` tokens                      | `[redacted-token]`       |
| JWTs (`eyJ...`)                                 | `[redacted-jwt]`         |
| `-----BEGIN ... PRIVATE KEY-----` blocks        | `[redacted-private-key]` |
| `user:password@` in a URL                       | `//[redacted]@`          |
| `password`, `secret`, `token`, `api_key` values | `"[redacted]"`           |

- **`<private>...</private>`** in a prompt is replaced by `[private]` before anything is saved.
- **`claude-db redact`** re-applies the cleaning to rows saved earlier.
- **The Haiku calls** go through your own Claude login, with the `claude` program on your machine. The pick
  prompt and the facts prompt hold your saved notes, so those notes are sent to the model, and the command line
  is never part of a stored failure reason.
- **A secret pasted into a chat** stays in Claude Code's own chat file, which claude-db does not edit. Rotate
  it.
- **`.mcp.json` holds an absolute path** that exists only on your machine. Add it to `.gitignore`.
- **A reset is a dry run** until you pass `--yes`.

---

## 15. How the Haiku calls find `claude`

Picks and facts run the `claude` program in headless mode. Claude Code does not give hooks its own path, and
`claude` is often not on `PATH` (for example when it runs inside an editor). So the lookup is:

```
 1. CLAUDE_CODE_EXECPATH, if set
 2. the path saved in ~/.claude-memory/claude-binary, if that file still exists
 3. "claude" on PATH

 Each hook, before it does anything else, walks UP its parent processes
 (hook shell ──► claude ──► editor) and saves the first one named "claude".
```

```
 hook process
    └─ parent: dash                      exe=/usr/bin/dash
        └─ parent: claude                exe=/home/you/.vscode/extensions/.../native-binary/claude   ◄── saved
```

A saved path that no longer exists, for example after an editor update, is ignored and replaced on the next
hook run. The lookup works on Linux and macOS. Before 0.10.3 it failed silently where `claude` was not on
`PATH`.

---

## 16. Limits, budgets and what happens when a call fails

| Setting                | Default | Meaning                                              |
| ---------------------- | ------- | ---------------------------------------------------- |
| `pick.enabled`         | on      | Haiku picks the memory shown with each prompt        |
| `pick.dailyLimit`      | 150     | Picks per day                                        |
| `distill.enabled`      | on      | Chats become facts                                   |
| `distill.dailyLimit`   | 30      | Facts calls per day                                  |
| `inject.minOverlap`    | 2       | Content words a candidate must share with the prompt |
| `inject.promptResults` | 2       | Most memories shown with a prompt                    |
| `capture.summarize`    | off     | An extra AI summary at chat end (when facts are off) |
| `updates`              | notify  | `auto`, `notify` or `off`                            |

**When a Haiku call fails, the feature pauses and says why:**

```
 1st failure  ──► pause 1 hour
 2nd in a row ──► pause 6 hours
 3rd or more  ──► pause 1 day
 a working call ──► the count resets

 $ claude-db status
 pick     : on (haiku), 3 of 150 picks used today, paused until 2026-10-06T15:14:58Z
            after a failed call: exited with code 1: error: not logged in
```

The reason is one of: `claude was not found`, `timed out after 30 s` (picks) or `120 s` (facts), `exited
with code N: <first error line>`, `stopped by <signal>`, or `the reply was larger than the 1 MB buffer`.

**While paused or over budget**, picking falls back to the strong word match only (the closest note, if it
shares four content words with the prompt). Nothing breaks, and capture keeps working, because capture never
calls a model.

**Two processes at once.** The SQLite connection waits up to 3 seconds for a lock, which is under the 5 second
limit of the shortest hook, so a hook that starts during a background job does not fail.

---

## 17. Install, update and uninstall

```
 npm install -g claude-db
 cd your-project
 claude-db install --project          then restart Claude Code
```

`install` writes:

| What                         | Where                                                        |
| ---------------------------- | ------------------------------------------------------------ |
| Five hook registrations      | `.claude/settings.local.json` (`--project`) or user settings |
| The MCP server               | `.mcp.json` (project) or user level                          |
| A standing instruction block | `CLAUDE.local.md`, or `~/.claude/CLAUDE.md` machine-wide     |
| The `/cdb-scan` skill        | `~/.claude/skills/`                                          |

**Staying current.** The hooks are registered by absolute path into the installed package, so they always run
the newest code. At `SessionStart`, claude-db compares the copied skill and instruction block with what
shipped and rewrites them if they differ. So `npm i -g claude-db` alone is enough. Only files that already
exist are refreshed, and anything `uninstall` removed stays removed.

**Uninstall.** `claude-db uninstall [--project]` removes the hooks, the server, the instruction block and the
skill, and leaves your memory intact.

**First days.** A fresh install has no history. Run `claude-db scan` and the `/cdb-scan` skill so search has
something to find. Facts and picks become useful after a few chats.

---

## 18. The code, folder by folder

```
src/
 ├── hooks/        the five hooks and what they share (payload, shown-ids, recall rules, background jobs)
 ├── capture/      transcript reader, turn extractor, redaction, summary, flush
 ├── search/       keyword + vector fusion, recency, stopwords        (database-independent)
 ├── facts/        distill (Haiku), fact model, rendering, budget, import of Claude's own memory files
 ├── pick/         pick prompt, run, worker, pending files
 ├── graph/        parser, languages, scan, query (usages / explain / path), refresh
 ├── usages/       the live git-grep mode
 ├── store/        one adapter interface + sqlite/, postgres/, mongo/
 ├── embed/        builtin hashing embedder, optional transformers embedder
 ├── mcp/          the MCP server and its six tools
 ├── cli/          the claude-db command and its subcommands
 ├── config/       settings schema, loading, the data folder path
 └── util/         project resolution, the claude binary lookup, budgets, job locks, small helpers
```

Hooks are the entry points. They read the Claude Code payload, call the core folders, and print their result
through one shared function, so the output format stays in one place.

---

## 19. Testing and releasing

- **Checks:** `npm run typecheck`, `npm run lint`, and `npm test`. Lint runs a project script (no code
  comments, no `any`, files under 250 lines, `.js` import endings, hooks print through `emitContext`), then
  ESLint, then a scan of tests and docs for tokens, key prefixes and personal paths.
- **Tests that touch real data** run in an isolated temporary home. A guard stops them if they ever point at
  your real home folder.
- **CI** runs on Ubuntu and macOS, plus CodeQL.
- **Release.** Update `CHANGELOG.md`, then a commit named just the version, then an annotated tag and a push.
  The publish workflow checks the tag matches `package.json`, checks the version is not already on npm, runs
  typecheck, build and tests, then publishes with provenance. npm versions can never be replaced.

```
 docs: changelog for 0.10.3  ──►  0.10.3 (package.json + lock)  ──►  git tag -a v0.10.3 -m "0.10.3"
                                                                      git push --follow-tags  ──► npm
```

---

## 20. Which part do I use when

| I want to...                             | Use                                              |
| ---------------------------------------- | ------------------------------------------------ |
| Know why the code is the way it is       | `search`, then `get_observations`                |
| Find who calls or imports a function     | `find_usages` (`usages`)                         |
| Check what a function reaches            | `find_usages` (`explain`)                        |
| See how two functions connect            | `find_usages` (`path`)                           |
| Find plain text, a log line or a comment | grep                                             |
| Make Claude follow a rule from now on    | `remember`                                       |
| Remove a wrong or private note           | `forget <id>`                                    |
| Check it is installed and working        | `claude-db status`, `claude-db doctor`           |
| See why picks or facts stopped           | `claude-db status` (the `paused` line shows why) |
| Build facts from waiting chats now       | `claude-db distill --backfill`                   |
| Share memory across machines             | `claude-db use <postgres or mongo url>`          |
| Move memory after a repo moved folders   | `claude-db merge <old-path>`                     |
| Back up, or move to a new machine        | `claude-db export`, then `import`                |
| Map a project that already exists        | `claude-db scan`, then the `/cdb-scan` skill     |

---

## 21. Words used in this project

| Word        | Meaning                                                                              |
| ----------- | ------------------------------------------------------------------------------------ |
| Observation | One saved record of a turn: kind, title, body, files, commands                       |
| Fact        | A short lasting lesson (rule, decision, dead end, to do, fact) with a stable key     |
| Project     | The git repository root of the folder you work in                                    |
| Session     | One Claude Code chat                                                                 |
| Hook        | A small script Claude Code runs at a fixed moment                                    |
| MCP server  | A helper Claude Code starts, which Claude can call as tools                          |
| Pick        | The one or two notes Haiku chooses to show with a prompt                             |
| Candidate   | One of the ten notes the search offers to the picker                                 |
| Distill     | Turn a finished chat into facts                                                      |
| Backfill    | Distill every chat that is still waiting                                             |
| Symbol      | A named piece of code: function, class, method, type, constant                       |
| Edge        | A link between two symbols: calls, imports, extends, implements, references, defines |
| EXTRACTED   | An edge read literally from the syntax                                               |
| INFERRED    | An edge matched by name across files, with a score                                   |
| Embedding   | A list of numbers that stands for the meaning of a text, used for vector search      |
| Redaction   | Replacing secrets with a marker before saving                                        |
| Pause       | The wait after a failed Haiku call: 1 hour, then 6 hours, then a day                 |
