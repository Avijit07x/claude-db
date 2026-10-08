# claude-db architecture

What claude-db is, every feature one by one, and the reference tables. Each feature has the same four parts:
what it does, when it runs, an example, and its settings. The examples use an invented shop project.

[how-it-works.md](./how-it-works.md) is the short version, [setup-guide.md](./setup-guide.md) covers settings,
and [releasing.md](./releasing.md) covers a release.

## Contents

| #   | Section                                                          | What it gives you                                                |
| --- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
|     | **Overview**                                                     |                                                                  |
| 1   | [What claude-db is](#1-what-claude-db-is)                        | The problem, the idea, and three design choices                  |
| 2   | [How the parts fit](#2-how-the-parts-fit)                        | Hooks, the MCP server and the CLI, over one database             |
| 3   | [One chat, start to end](#3-one-chat-start-to-end)               | When each hook runs in a real chat                               |
|     | **Features**                                                     |                                                                  |
| 4   | [Capture](#4-capture)                                            | Every turn that matters is saved, with the reason                |
| 5   | [Search](#5-search)                                              | A note is found by its words and by its meaning                  |
| 6   | [Memory with each prompt](#6-memory-with-each-prompt)            | Haiku shows the one or two earlier notes that fit your prompt    |
| 7   | [Facts](#7-facts)                                                | Chats become short rules, decisions, dead ends and to-dos        |
| 8   | [The start of a chat](#8-the-start-of-a-chat)                    | A new chat starts knowing you, the project and where you stopped |
| 9   | [Other chats](#9-other-chats)                                    | A new chat knows what your other chats did, open or closed       |
| 10  | [After `/compact`](#10-after-compact)                            | What this chat decided comes back after a compact                |
| 11  | [Handoff and catchup](#11-handoff-and-catchup)                   | A note for the next chat, and "where did I stop?"                |
| 12  | [Code graph and `find_usages`](#12-code-graph-and-find_usages)   | "Who uses this?" in one call                                     |
| 13  | [One project, many folders](#13-one-project-many-folders)        | One repository is one project, in any folder and on any machine  |
| 14  | [Databases and sync](#14-databases-and-sync)                     | SQLite by default, Postgres or MongoDB to share                  |
|     | **Reference**                                                    |                                                                  |
| 15  | [MCP tools](#15-mcp-tools)                                       | The six tools Claude can call                                    |
| 16  | [Commands](#16-commands)                                         | Every `claude-db` command                                        |
| 17  | [Settings and limits](#17-settings-and-limits)                   | Defaults, daily budgets, and what happens when a call fails      |
| 18  | [Where the data lives](#18-where-the-data-lives)                 | The data folder and the database tables                          |
| 19  | [Privacy and safety](#19-privacy-and-safety)                     | What is removed before saving, and what leaves your machine      |
| 20  | [How Haiku calls find `claude`](#20-how-haiku-calls-find-claude) | How the background calls find the `claude` program               |
| 21  | [Install, update, uninstall](#21-install-update-uninstall)       | What install writes, and how it stays current                    |
| 22  | [The code, folder by folder](#22-the-code-folder-by-folder)      | Where each part lives in `src/`                                  |
| 23  | [Testing and releasing](#23-testing-and-releasing)               | The checks every change passes                                   |
| 24  | [Which part do I use when](#24-which-part-do-i-use-when)         | A task, and the tool for it                                      |
| 25  | [Words used in this project](#25-words-used-in-this-project)     | The terms, in one line each                                      |

---

## 1. What claude-db is

**The problem.** Every Claude Code chat starts from zero. You explain why the order feed uses a WebSocket and not
polling, which approach you tried and dropped, and which function must not be touched. The next day Claude knows
none of it. It also works out "what calls what" from scratch, by grepping and reading files.

**The idea.** Give Claude two things that last:

1. **A memory**: what was done and why, saved from your real chats and handed back at the right moment.
2. **A map of the code**: every symbol and how they connect, so "who uses this" is one call.

```
 WITHOUT claude-db                         WITH claude-db

 Monday:   "use a WebSocket, polling       Monday:   "use a WebSocket, polling
            hammered the API"                         hammered the API"     ──┐
                                                                              │ saved
 Tuesday:  Claude: "should the feed        Tuesday:  Claude already sees:     ▼
            poll or use a WebSocket?"                 "Decided (Mon): WebSocket,
            you: explain it all again                  polling hammered the API"
```

**Three design choices.**

- **It reads what Claude Code already writes.** Claude Code saves every chat to disk as a JSONL file. claude-db
  reads that file, so it needs nothing from you and keeps the reason, not only the file changes.
- **Recall is a hook, not a request.** A hook always runs. Nothing depends on Claude deciding to look.
- **Your data stays yours.** A local database by default, with no cloud and no account. Postgres and MongoDB are
  options for sharing.

---

## 2. How the parts fit

```
┌─────────────────────────────── Claude Code (the chat you use) ────────────────────────────────┐
│  chat opens ──► you send a prompt ──► Claude uses tools ──► Claude replies ──► chat closes    │
└──────┬──────────────────┬────────────────────┬────────────────────┬───────────────┬───────────┘
       ▼                  ▼                    ▼                    ▼               ▼
 SessionStart      UserPromptSubmit        PreToolUse              Stop          SessionEnd
 start block,      save last turn,         deliver a pick,       save this      save, then
 refresh graph     start a pick            answer a grep         turn           make facts
       └──────────────────┴─────────────┬──────┴────────────────────┴───────────────┘
                                        ▼
 ┌──────────────────────────────── claude-db core (src/) ────────────────────────────────┐
 │  capture · search · picks · facts · start block · code graph · redaction              │
 └──────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ one adapter interface
                      ┌─────────────────────┼─────────────────────┐
                      ▼                     ▼                     ▼
               SQLite (default)          Postgres              MongoDB
              ~/.claude-memory/        shared across         shared across
                  memory.db              machines              machines

 Claude can ASK at any time, through the MCP server:
   search · get_observations · timeline · remember · forget · find_usages

 You drive it from a terminal with the claude-db command (status, doctor, scan, search, ...).
```

Three ways in, one store:

| Way in     | Who starts it                  | Used for                                            |
| ---------- | ------------------------------ | --------------------------------------------------- |
| Hooks      | Claude Code, at fixed moments  | Saving, the start block, picks, the grep helper     |
| MCP server | Claude, when it chooses to ask | Searching, opening a note, remembering, code usages |
| CLI        | You, in a terminal             | Setup, health, scanning, backup, switching database |

The six hooks:

| Moment             | Hook file          | What it does                                                                    | Limit |
| ------------------ | ------------------ | ------------------------------------------------------------------------------- | ----- |
| Chat opens         | `session-start.js` | Gives the start block, refreshes the graph, hints to scan, shows update notices | -     |
| You send a prompt  | `user-prompt.js`   | Marks the request not finished, saves the previous turn, starts a pick          | -     |
| Claude uses a tool | `pick-deliver.js`  | Hands over a finished pick                                                      | 5 s   |
| Claude greps       | `prefer-usages.js` | Answers a grep for a code symbol from the graph                                 | 10 s  |
| Claude replies     | `turn-end.js`      | Saves this turn in the background                                               | -     |
| Chat closes        | `session-end.js`   | Saves the last turn, ends the chat, starts the facts job                        | -     |

Every hook catches its own errors and exits with success. A broken memory never stops your chat.

---

## 3. One chat, start to end

One short chat about the shop's order feed:

```
TIME ─────────────────────────────────────────────────────────────────────────────►

 open chat        you: "the order       Claude edits         Claude replies     close chat
                   feed keeps            src/ws/client.ts     "added a heartbeat"
                   dropping"
    │                  │                      │                     │                │
    ▼                  ▼                      ▼                     │                ▼
 SessionStart     UserPromptSubmit        PreToolUse              Stop          SessionEnd
    │                  │                      │                     │                │
    │ gives:           │ 1. saves the         │ pick-deliver:       │ saves this     │ 1. saves the last turn
    │  about you       │    PREVIOUS turn     │  hands over the     │ turn, in the   │ 2. marks chat ended
    │  this project    │ 2. looks up memory   │  pick, if ready     │ background     │ 3. starts the facts
    │  other chats     │ 3. starts a pick     │                     │                │    job in background
    │  where you       │    in background     │ (and if Claude      │                │
    │  stopped         │                      │  greps a symbol,    │                ▼
    ▼                  ▼                      │  prefer-usages      │         Haiku writes facts:
 Claude sees:      background:                │  answers from the   │         "Decided: heartbeat
 ┌──────────────┐  Haiku reads 10            │  graph)             │          every 20s, proxy
 │<memory>      │  candidates, picks 1       ▼                     │          closes idle at 60s"
 │ Decided (Mon)│  and quotes it          Claude sees:              │
 │ WebSocket... │        │                ┌─────────────────────┐   │
 └──────────────┘        └──────────────► │<memory>             │   │
                                          │ - Oct 1: asked "why │   │
                                          │   does the feed     │   │
                                          │   drop?": the client│   │
                                          │   sends no heartbeat│   │
                                          │   (a1b2c3d4-e5f6)   │   │
                                          └─────────────────────┘   │
```

---

## 4. Capture

**What it does.** After each turn, claude-db turns what happened into one **observation**: a short record with a
kind, a title, a body, the files touched and the commands run. Only turns that matter are kept, so a busy day
gives 10 to 20 rows, not hundreds.

**When it runs.** When Claude finishes a reply (that turn, in the background), at each prompt (the previous turn,
as a backup for a reply you interrupted), when the chat closes (the last turn), and on `claude-db flush`.

```
 ~/.claude/projects/<project>/<chat>.jsonl            (Claude Code writes this)
        │  read only the NEW lines (a cursor remembers where it stopped)
        ▼
   turns:  prompt + Claude's reasoning + files edited + commands run
        │
        ├─ strip  <private>...</private>      →  "[private]"
        ├─ keep only turns that changed something or answered a real question
        ├─ remove secrets (keys, tokens, passwords)
        ▼
   one observation per kept turn  ──► store, with an embedding for search
```

| Turn                                       | Saved? | Why                               |
| ------------------------------------------ | ------ | --------------------------------- |
| Edited a file                              | Yes    | It changed the project            |
| Ran a real command (tests, build, install) | Yes    | It changed or checked the project |
| Asked a question and got a real answer     | Yes    | The answer may matter later       |
| `ok`, `thanks`, a bare `grep`, a file read | No     | Nothing to remember               |
| Text inside `<private>...</private>`       | Hidden | Replaced by `[private]`           |

**Example.** One saved observation:

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

**Safe to repeat.** An observation's id comes from the chat, the time the request was asked and the request. A
turn read twice, for example at `Stop` and again at the next prompt, is one row.

---

## 5. Search

**What it does.** One search that mixes three signals: the words, the meaning, and how recent a note is. Words
alone miss a note that says "heartbeat" when you ask about "keepalive". Meaning alone misses an exact name like
`useAuth`. Together they find both.

**When it runs.** On every prompt (to find candidates for a pick), when Claude calls `search`, and on
`claude-db search`.

```
   query: "why does the order feed drop"
        │
        ├──► keyword search (FTS5, BM25)  ──► ranked list A     exact words, rare words count more
        ├──► vector search (cosine)       ──► ranked list B     similar meaning
        ▼
   fuse A and B   (reciprocal rank fusion: a note near the top of both wins)
        ▼
   recency boost  (a note loses a little weight as it ages; half-life 45 days)
        ▼
   top results:  id · kind · date · title · one matching line
```

**Example.**

```
$ claude-db search order feed drop
a1b2c3d4-e5f6  decision    2026-10-01  Chose WebSocket over polling for live order updates
              …Polling at 3s hammered the API and still lagged behind. Switched to a…
f6e5d4c3-b2a1  bugfix      2026-10-02  The websocket client sends no heartbeat
              …the proxy closes an idle connection after 60 seconds…
```

A search returns one short line per hit. The full text comes from `get_observations`, for the ids worth reading.

**Settings.**

| Setting               | Default | Meaning                                                                      |
| --------------------- | ------- | ---------------------------------------------------------------------------- |
| `embeddings.provider` | auto    | The built-in 256-number embedder, or a local 384-number model when installed |

Installing `@xenova/transformers` switches to the local model, and `claude-db reembed` recomputes old rows.
Ranking lives in `src/search`, not in the database adapters, so SQLite, Postgres and MongoDB give the same
results.

---

## 6. Memory with each prompt

**What it does.** Before Claude answers, it is shown the one or two earlier notes that fit what you just asked.
Claude Haiku picks them, and may pick none. Most prompts get none.

**When it runs.** On every prompt, in the background, so typing is never held up. The pick reaches Claude with
its first tool call.

```
 you send:  "the order feed keeps dropping and I do not know why"
      │
      ▼
 1. SEARCH   top 10 notes from OTHER chats in this project
      ▼
 2. GATE     does any candidate share at least 2 content words with the prompt?
      │          no  ──► stop. Haiku is not called. Nothing is shown.
      ▼
 3. BUDGET   under today's limit, and not paused?
      │          no  ──► show the closest note only if it shares 4 words
      ▼
 4. HAIKU    reads the end of Claude's previous reply, the prompt and the 10 candidates;
      │      returns up to 2 picks, each with ONE sentence copied from the note
      ▼
 5. CHECK    is that sentence really inside the note?   no ──► the pick is dropped
      ▼
 6. DELIVER  at Claude's first tool call
```

**Example.** Of the ten candidates, Haiku picks the first and quotes it:

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
```

**Rules.**

- The quoted sentence is checked against the note, so a pick never carries a claim the note does not make.
- Notes from the current chat are never offered back to it.
- Facts are not offered here. They are shown at the start of a chat.
- A turn that uses no tool gets no pick, since delivery happens at the first tool call.
- Subagent reports, task notices and slash commands are not prompts, so they get nothing.
- The model is `claude-haiku-5-5`. When the account cannot use it, the pick falls back to `haiku` on its own.

**Settings.**

| Setting                | Default | Meaning                                              |
| ---------------------- | ------- | ---------------------------------------------------- |
| `pick.enabled`         | on      | Haiku picks the memory shown with each prompt        |
| `pick.dailyLimit`      | 150     | Picks per day                                        |
| `inject.minOverlap`    | 2       | Content words a candidate must share with the prompt |
| `inject.promptResults` | 2       | Most notes shown with a prompt                       |

`claude-db pick` shows today's count, and `claude-db pick on|off` switches it.

---

## 7. Facts

**What it does.** One small Haiku call reads a finished chat and writes short **facts**: the lessons, not the
record. Each fact has a type and a stable key, so a later chat updates it in place, and Haiku retires a fact a new
chat proves wrong. The raw observations stay as the evidence.

**When it runs.** When a chat closes, in the background. Chats that are still waiting are picked up at a later
chat start, or at once with `claude-db distill --backfill`.

```
 chat closes
    │
    ▼
 read the chat's saved rows  (windows of about 40,000 characters, at most 6)
    +
 the facts already known for this project and for you  (up to 80)
    │
    ▼
 Haiku writes, updates or retires facts      (one call per window, up to 120 s each)
```

**The five types:** `rule`, `decision`, `deadend`, `todo`, `fact`.

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

Only a **rule** about how you like to work is filed under you, and it follows you to every project. The rest
belong to the project. Facts show up at the start of every chat and in `search`.

**Settings.**

| Setting                | Default | Meaning                                  |
| ---------------------- | ------- | ---------------------------------------- |
| `distill.enabled`      | on      | Chats become facts                       |
| `distill.dailyLimit`   | 30      | Facts calls per day                      |
| `distill.backfillDays` | 90      | How far back waiting chats are picked up |

`claude-db distill` shows the state, `distill on|off` switches it, and `distill --backfill` builds facts now.

---

## 8. The start of a chat

**What it does.** A new chat starts with one short block: what is known about you, about this project, what your
other chats were doing, the last handoff note, and where you stopped.

**When it runs.** At `SessionStart`: a new chat, a resumed chat, and after `/compact`.

**Example.**

```
<memory>
About you:
- Rule (Oct 6): User wants pnpm in this repo, not npm. (3f373669-1fa7)

This project:
- Decided (Oct 5): Use a WebSocket for the order feed, because polling hammered the API. (e7fc292e-0df9)
- Dead end (Oct 5): Long polling was tried and dropped: it lagged behind. (e14ea0c9-ef45)

Not finished yet in another chat (Oct 6, 10:40):
- asked "move the feed URL to env"

Last chat (Oct 6):
- asked "add a heartbeat to the socket": Added a 30s heartbeat in src/ws/client.ts (a41c9e02-7d1b)

Last handoff (Oct 5, older than the last chat):
- Done: WebSocket feed, reconnect with backoff.
- Next: add a heartbeat.

Where you stopped:
- Not committed: heartbeat in src/ws/client.ts
</memory>
```

| Part                               | Comes from                                                               |
| ---------------------------------- | ------------------------------------------------------------------------ |
| `About you`                        | Rules filed under you, from any project                                  |
| `This project`                     | The project's facts and the notes you saved with `remember`              |
| `Not finished yet in another chat` | A request another chat is still working on ([section 9](#9-other-chats)) |
| `Last chat`, `Chat before`         | The newest requests from your other chats ([section 9](#9-other-chats))  |
| `Last handoff`                     | The newest `/handoff` note ([section 11](#11-handoff-and-catchup))       |
| `Where you stopped`                | Open to-dos, and saved work no commit has covered yet                    |

Every line that carries an id can be opened in full with `get_observations`. Lines the chat already sees in
Claude Code's own memory files are not repeated. A project with no facts yet, right after install, gets the
older chat summaries and the other-chats part instead.

Also at this moment: a **hint to scan** when the repository has no code graph, an **update notice** when a newer
compatible version exists, and a **one-time notice** that explains the facts feature.

**Settings.**

| Setting           | Default | Meaning                          |
| ----------------- | ------- | -------------------------------- |
| `inject.maxChars` | 6000    | The most characters in the block |

---

## 9. Other chats

**What it does.** You rarely close a chat. You leave it open and start a new one. The new chat still knows what
the others did:

- **The newest 5 requests from other chats**, from at most 5 chats, grouped by chat, newest chat first. A chat's
  summary is added once it has closed. Empty chats and small talk save nothing, so they never move it.
- **A request is saved the moment Claude finishes the reply**, not at your next message.
- **A request another chat is still working on** is shown as not finished, so two chats do not change the same
  files without knowing. It stays while that chat still has a background task running or a loop scheduled.

**When it runs.** At the start of every chat, and in `/catchup`. The saving runs at every `Stop`.

**Example.** Chat A did the real work and is still open, chat B asked one question, chat C opens:

```
Last chat (Oct 8):
- asked "what does the mailer config do": It sets the SMTP host in src/mail.ts.

Chat before (Oct 8):
- asked "add retries to the worker queue": Added the retry in src/queue.ts.
- asked "write tests for the retry backoff": Added 4 backoff tests.
- asked "fix the failing test in the backoff suite": Fixed the timer in the backoff test.
- asked "release the 0.12.2 patch": Tagged v0.12.2 and published it.
```

A request pushed out of these 5 lines stays in memory: search finds it, and each prompt can recall it.

| Rule                                                             | Why                                                              |
| ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| The chat that starts never shows itself                          | It already has its own history                                   |
| A not-finished request shows for 2 hours at most                 | An interrupted reply fires no hook, so nothing else can clear it |
| Files in `~/.claude-memory/active/` older than a day are deleted | A crashed chat leaves nothing behind                             |

Every case, with examples, is in [improve-last-chat.md](./improve-last-chat.md).

---

## 10. After `/compact`

**What it does.** `/compact` shrinks Claude's chat history, so it forgets what this chat decided. The start hook
puts that back under **Earlier in this chat**: the chat's decisions, the dead ends it hit, and what it left
uncommitted.

**When it runs.** At `SessionStart` after a compact.

**Example.**

```
 Earlier in this chat:
 - Decided: heartbeat every 20 s
 - Dead end: long polling lagged
 - Not committed: src/ws/client.ts
```

At most 8 lines.

---

## 11. Handoff and catchup

**What it does.** Two skills for moving between chats on purpose.

- **`/handoff`** writes a short note with a Done, Open and Next line, saves it as the project's current handoff,
  and prints it to paste into a message or a pull request. A new handoff replaces the old one.
- **`/catchup`** answers "where did I stop?" in three groups, done, open and next, from the other chats, the
  to-dos, the last handoff and git. It writes nothing. `claude-db catchup` prints what it reads.

**When it runs.** When you type the skill. Every new chat shows the newest handoff for 14 days.

**Example.**

```
Handoff, Oct 6:
- Done: timers, queue, mail family.
- Open: PR #18 not merged.
- Next: ask which retries to change on the worker queue.
```

A handoff is never hidden. Once a request in another chat comes after it, its heading says so:
`Last handoff (Oct 6, older than the last chat):`. The new chat sees the note and the newer work, and knows
which is newer.

---

## 12. Code graph and `find_usages`

**What it does.** `claude-db scan` parses the source files and stores every **symbol** (function, class, method,
type, constant) and every **edge** between them: calls, imports, extends, implements, references, defines and
aliases. "Who calls this?" is then one call, with calls and imports told apart.

**When it runs.** Scan once. After that, every graph query checks the working tree and refreshes only the files
that changed, so the answer is never stale. Ask any time with `find_usages` or `claude-db usages`.

```
 source files ──► parser (ast-grep, local, no tokens) ──► symbols + edges ──► database

 EXTRACTED  read literally from the syntax          "import { cart } from './cart'"
 INFERRED   matched by name across files, scored    wrong if two files export the same name
```

| Mode               | Answers                                                           | Needs a scan |
| ------------------ | ----------------------------------------------------------------- | ------------ |
| `usages` (default) | What references each definition, then grep lines the graph missed | Yes          |
| `explain`          | That, plus what the symbol itself reaches                         | Yes          |
| `path`             | The shortest chain between two symbols                            | Yes          |
| `text`             | Live `git grep` only                                              | No           |

**Example.**

```
$ claude-db usages recordFailure

recordFailure  [function]
  Source: src/util/daily-budget.ts:83
  export function recordFailure(name: string, reason: string, now = Date.now()): void {
  Referenced by (2):
    <-- recordDistillFailure  [calls] [INFERRED 0.95]  src/facts/budget.ts:16
    <-- recordPickFailure     [calls] [INFERRED 0.95]  src/pick/run.ts:32
```

Lines `git grep` finds that the graph could not link come last, so the answer never shows less than a plain
search.

**Languages.** TypeScript, TSX, JavaScript, Python, Go, Rust, Ruby, Java and Kotlin are read with real syntax, and
27 more by pattern. `claude-db languages` lists them. Grammars ship in one package per platform; where none
installs, a language is read by pattern.

**Imports.** In TypeScript, JavaScript, Python, Go, Rust, Java and Kotlin, an imported name is bound to the symbol
in the module it came from, so two symbols with one name in different modules stay apart, and `usages` lists the
importing files under `Imported by`. In Java and Kotlin, `x.method()` goes to the method of the declared type of
`x`. A name from outside the repository is never matched to a symbol inside it. The design is in
[plan-code-graph.md](./plan-code-graph.md), and adding a language is in
[adding-a-language.md](./adding-a-language.md).

**The grep helper.** When Claude runs `grep`, `rg` or the Grep tool for a code symbol the graph knows,
`prefer-usages.js` answers from the graph instead: at most 2 symbols, 14 lines each, then up to 6 text matches the
graph could not link. A grep for plain text, or for a name the graph does not know, runs as normal.

| `CLAUDE_DB_USAGES_HOOK` | What happens                                               |
| ----------------------- | ---------------------------------------------------------- |
| `deny` (default)        | The grep is blocked, and the graph answer is shown instead |
| `directive`             | The grep runs, and the graph answer is added as context    |
| `off`                   | The hook does nothing                                      |

**The `/cdb-scan` skill.** After a scan, it writes five notes about the project: stack, layout, conventions,
workflows and architecture, tagged `inferred`. A fresh install then has something to find on day one.

---

## 13. One project, many folders

**What it does.** A repository is one project wherever it is cloned. With a shared database, a laptop and a
desktop see the same memory, and a second worktree sees the first one's notes.

**When it runs.** Every time memory is read or written for a folder.

```
 /home/me/code/shop          ──┐
 /Users/me/work/shop            ├──► github.com/acme/shop     (one project)
 /home/me/code/shop-worktree  ──┘

 /home/me/notes  (no remote)  ──►  /home/me/notes             (its own project)
```

- The key is the git remote, `origin` by default. The `ssh` and `https` addresses of one repository match.
  A token in the address is dropped and never stored.
- A folder with no remote is keyed by its path. A fork has its own remote, so it is its own project.
- Each folder is linked to its key in the `project_links` table the first time it is used. Notes saved under an
  older folder path are still found, and nothing is moved.

**Settings.**

| Setting          | Default | Meaning                             |
| ---------------- | ------- | ----------------------------------- |
| `project.remote` | origin  | The remote whose address is the key |

`claude-db merge <old-path>` moves memory from a folder path that no longer exists onto this project.

---

## 14. Databases and sync

**What it does.** Memory lives in one database: SQLite by default, or Postgres or MongoDB to share it across
machines and teammates. All three give the same results.

**When it runs.** Always. You choose the database once.

```
 claude-db use postgres://user:pass@host:5432/memory      checks it answers, then switches
 claude-db use mongodb+srv://user:pass@cluster/memory
 CLAUDE_DB_URL=...                                         overrides config.json for one shell
```

| Command                   | What it does                                        |
| ------------------------- | --------------------------------------------------- |
| `use <url>`               | Switch database, after checking it answers          |
| `export`, `import <file>` | Back up to JSONL, or load a backup (safe to repeat) |
| `sync <url>`              | Two-way merge with another database                 |

---

## 15. MCP tools

The MCP server is a small helper that Claude Code starts. Claude calls these tools when it chooses to.

| Tool               | What it does                                           | Use it for                             |
| ------------------ | ------------------------------------------------------ | -------------------------------------- |
| `search`           | Hybrid search, one short line per hit                  | "Why is it like this?", past decisions |
| `get_observations` | Full text of notes, by id                              | Reading the ids worth reading          |
| `timeline`         | Notes before and after one note                        | "What else happened around then?"      |
| `remember`         | Saves a note now, with a kind and an optional key      | A standing rule you just stated        |
| `forget`           | Deletes notes by id, or clears one chat's summary      | Removing a wrong or private note       |
| `find_usages`      | Who uses a symbol: `usages`, `explain`, `path`, `text` | Before editing, renaming or deleting   |

A standing instruction block in `CLAUDE.local.md` tells Claude to search memory before asking you to explain a
past decision, and to use `find_usages` for symbols. Hook output is context Claude may skip; a rule in the
instruction file holds for the whole chat.

---

## 16. Commands

`cdb` is a short alias for `claude-db`.

| Group      | Command                                   | What it does                                                       |
| ---------- | ----------------------------------------- | ------------------------------------------------------------------ |
| Setup      | `install [--project]`                     | Register hooks, the MCP server and skills (`--project`: this repo) |
|            | `uninstall [--project]`                   | Remove them, keeping memory                                        |
|            | `update`                                  | Install a newer compatible release now                             |
| Health     | `status`                                  | Wired up? When did it last record? Pick and facts state            |
|            | `doctor [--deep]`                         | Show the config; `--deep` proves write, search, read and delete    |
|            | `adoption`                                | How often chats grep versus use the memory tools                   |
|            | `--version`, `-v`                         | The installed version                                              |
| Memory     | `search [--all] [--tag <name>] <query>`   | Search this project or every project                               |
|            | `remember [--kind k] [--key name] <text>` | Save a note or a house rule                                        |
|            | `forget <id>...`, `forget --session <id>` | Delete notes, or clear one chat's summary                          |
|            | `catchup`                                 | Where you stopped: other chats, to-dos, git, last handoff          |
|            | `stats`, `projects`, `view`               | See what is stored, in a terminal or in the browser                |
| Haiku      | `distill [on\|off]`, `distill --backfill` | Facts: state, switch, or build now                                 |
|            | `pick [on\|off]`                          | Picks: state or switch                                             |
| Code graph | `scan [--force]`                          | Build or refresh the graph                                         |
|            | `languages`                               | How each language is read                                          |
|            | `usages [--mode m] <symbol>`              | Ask the graph or `git grep`                                        |
| Data       | `use <url>`                               | Switch database, after checking it answers                         |
|            | `export`, `import <file>`, `sync <url>`   | Back up, restore, or two-way merge                                 |
|            | `merge [<old-path>]`                      | Move memory from an old folder path onto this project              |
|            | `reembed`, `redact`, `flush`, `seed`      | Recompute vectors, re-clean secrets, re-read chats, fill from git  |
|            | `prune --older-than <days>`, `reset`      | Delete old or all memory (a dry run without `--yes`)               |

---

## 17. Settings and limits

Settings live in `~/.claude-memory/config.json`. The full list is in [setup-guide.md](./setup-guide.md).

| Setting                | Default | Meaning                                              |
| ---------------------- | ------- | ---------------------------------------------------- |
| `pick.enabled`         | on      | Haiku picks the memory shown with each prompt        |
| `pick.dailyLimit`      | 150     | Picks per day                                        |
| `distill.enabled`      | on      | Chats become facts                                   |
| `distill.dailyLimit`   | 30      | Facts calls per day                                  |
| `inject.maxChars`      | 6000    | The most characters in the start block               |
| `inject.minOverlap`    | 2       | Content words a candidate must share with the prompt |
| `inject.promptResults` | 2       | Most notes shown with a prompt                       |
| `project.remote`       | origin  | The remote that names a project                      |
| `capture.summarize`    | off     | An extra AI summary at chat end, when facts are off  |
| `updates`              | notify  | `auto`, `notify` or `off`                            |

**When a Haiku call fails, that feature pauses and says why.**

```
 1st failure     ──► pause 1 hour
 2nd in a row    ──► pause 6 hours
 3rd or more     ──► pause 1 day
 a working call  ──► the count resets

 $ claude-db status
 pick     : on (claude-haiku-5-5, else haiku), 3 of 150 picks used today,
            paused until 2026-10-06T15:14:58Z after a failed call: exited with code 1: error: not logged in
```

The reason is one of: `claude was not found`, `timed out after 30 s` (picks) or `120 s` (facts),
`exited with code N: <first error line>`, `stopped by <signal>`, or `the reply was larger than the 1 MB buffer`.

While paused or over budget, picking falls back to the strong word match only. Capture never calls a model, so it
keeps working.

**Two processes at once.** The SQLite connection waits up to 3 seconds for a lock, under the 5 second limit of
the shortest hook, so a hook that starts during a background job does not fail.

---

## 18. Where the data lives

```
~/.claude-memory/
 ├── config.json          your settings
 ├── memory.db            the SQLite database (default)
 ├── claude-binary        where the claude program is, saved by the hooks
 ├── update.json          update-check state
 ├── cursors/             how far each chat log has been read, and what each chat was shown
 ├── active/              a request each chat has not finished yet
 ├── turns/               a finished turn waiting for its background save
 ├── pick/                today's pick budget, and picks waiting for the next tool call
 ├── distill/             today's facts budget
 ├── graph-cache/         parsed files per project, for fast graph refreshes
 └── facts/, reingest/, graph-refresh/, notices/      locks for background jobs
```

Inside the database (SQLite names; Postgres and MongoDB keep the same shapes):

| Table              | Holds                                                          |
| ------------------ | -------------------------------------------------------------- |
| `sessions`         | One row per chat: project, start, end, summary                 |
| `observations`     | The notes and facts, with kind, body, files, tags, embedding   |
| `observations_fts` | The keyword index over observations                            |
| `symbols`          | The code graph's symbols                                       |
| `symbol_edges`     | The graph's edges, with relation and confidence                |
| `scanned_files`    | A hash per scanned file, so a refresh parses only what changed |
| `project_links`    | Which folders belong to which project key                      |

Facts are kept in a reserved chat named `facts`, and notes from `remember` in one named `manual`.

---

## 19. Privacy and safety

- **Local first.** The default database is one file on your disk. Nothing goes to a cloud service.
- **Secrets are removed before saving:**

| Pattern                                         | Becomes                  |
| ----------------------------------------------- | ------------------------ |
| `sk-...` API keys, `AKIA...` AWS keys           | `[redacted-key]`         |
| `ghp_...`, `xox...` tokens                      | `[redacted-token]`       |
| JWTs (`eyJ...`)                                 | `[redacted-jwt]`         |
| `-----BEGIN ... PRIVATE KEY-----` blocks        | `[redacted-private-key]` |
| `user:password@` in a URL                       | `//[redacted]@`          |
| `password`, `secret`, `token`, `api_key` values | `[redacted]`             |

- **`<private>...</private>`** in a prompt never reaches memory. A saved turn keeps `[private]` in its place.
- **`claude-db redact`** cleans rows saved earlier again.
- **The Haiku calls** go through your own Claude login and the `claude` program on your machine. The pick and
  facts prompts hold your saved notes, so those notes reach the model.
- **A secret pasted into a chat** stays in Claude Code's own chat file, which claude-db does not edit. Rotate it.
- **`.mcp.json` holds an absolute path** that exists only on your machine. Add it to `.gitignore`.
- **`reset` and `prune` are dry runs** until you pass `--yes`.

---

## 20. How Haiku calls find `claude`

Picks and facts run the `claude` program headless. Claude Code does not give hooks its own path, and `claude` is
often not on `PATH`, for example inside an editor. The lookup:

```
 1. CLAUDE_CODE_EXECPATH, if set
 2. the path saved in ~/.claude-memory/claude-binary, if that file still exists
 3. "claude" on PATH

 Each hook first walks UP its parent processes and saves the first one named "claude":

 hook process
    └─ parent: dash      exe=/usr/bin/dash
        └─ parent: claude   exe=/home/you/.vscode/extensions/.../native-binary/claude   ◄── saved
```

A saved path that no longer exists, for example after an editor update, is ignored and replaced on the next hook
run. `claude-db doctor` shows which `claude` was found and from where.

---

## 21. Install, update, uninstall

```
 npm install -g claude-db
 cd your-project
 claude-db install --project          then restart Claude Code
```

| What install writes                               | With `--project`              | Without                   |
| ------------------------------------------------- | ----------------------------- | ------------------------- |
| The six hooks                                     | `.claude/settings.local.json` | `~/.claude/settings.json` |
| The MCP server                                    | `.mcp.json`                   | `~/.claude.json`          |
| The standing instruction block                    | `CLAUDE.local.md`             | `~/.claude/CLAUDE.md`     |
| The `/cdb-scan`, `/catchup` and `/handoff` skills | `.claude/skills/`             | `~/.claude/skills/`       |

**Staying current.** The hooks point at the installed package, so they always run the newest code. At each chat
start, claude-db adds any hook a newer version brought, and rewrites the skills and the instruction block when
they differ from what shipped. So `npm i -g claude-db` alone is enough. A `/catchup` or `/handoff` skill of your
own with the same name is kept, and anything `uninstall` removed stays removed.

**Uninstall.** `claude-db uninstall [--project]` removes the hooks, the server, the instruction block and the
skills, and leaves your memory as it is.

**First days.** A fresh install has no history. Run `claude-db scan` and the `/cdb-scan` skill so search has
something to find. Facts and picks become useful after a few chats.

---

## 22. The code, folder by folder

```
src/
 ├── hooks/      the six hooks, the background save, and what they share
 ├── capture/    chat log reader, turn extractor, redaction, not-finished requests, flush
 ├── search/     keyword + vector fusion, recency, stopwords        (database-independent)
 ├── facts/      facts (Haiku), the start block, other chats, handoff, Claude's own memory files
 ├── catchup/    what /catchup and claude-db catchup read and print
 ├── pick/       the pick prompt, run, worker and pending files
 ├── graph/      parser, languages, scan, imports per language, queries, refresh
 ├── usages/     the live git grep mode
 ├── store/      one adapter interface + sqlite/, postgres/, mongo/
 ├── embed/      the built-in embedder and the optional local model
 ├── mcp/        the MCP server and its six tools
 ├── cli/        the claude-db command and its subcommands
 ├── config/     the settings schema, loading, the data folder path
 └── util/       project keys, the claude lookup, budgets, job locks, small helpers
```

Hooks are the entry points. They read Claude Code's input, call the core folders, and print through one shared
function, so the output format lives in one place.

---

## 23. Testing and releasing

- **Checks:** `npm run typecheck`, `npm run lint` and `npm test`. Lint runs a project script first: no code
  comments, no `any`, files under 250 lines, `.js` import endings, hooks print only through the shared function,
  no leftover markers. Then ESLint, then a scan of tests and docs for tokens, key prefixes and personal paths.
- **Tests that touch real data** run in an isolated temporary home. A guard stops them if they ever point at your
  real home folder.
- **The store tests** run against SQLite locally, and against Postgres and MongoDB in CI.
- **CI** runs on Ubuntu and macOS, plus CodeQL.
- **Releasing** follows [releasing.md](./releasing.md): a branch and a pull request, green CI, then an annotated
  tag that runs the publish workflow.

---

## 24. Which part do I use when

| I want to...                             | Use                                             |
| ---------------------------------------- | ----------------------------------------------- |
| Know why the code is the way it is       | `search`, then `get_observations`               |
| Find who calls or imports a function     | `find_usages` (`usages`)                        |
| Check what a function reaches            | `find_usages` (`explain`)                       |
| See how two functions connect            | `find_usages` (`path`)                          |
| Find plain text, a log line or a comment | grep                                            |
| Make Claude follow a rule from now on    | `remember`                                      |
| Remove a wrong or private note           | `forget <id>`                                   |
| Leave a note for the next chat           | `/handoff`                                      |
| Find out where I stopped                 | `/catchup`                                      |
| Check it is installed and working        | `claude-db status`, `claude-db doctor`          |
| See why picks or facts stopped           | `claude-db status` (the `paused` line says why) |
| Build facts from waiting chats now       | `claude-db distill --backfill`                  |
| Share memory across machines             | `claude-db use <postgres or mongo url>`         |
| Move memory after a repo moved folders   | `claude-db merge <old-path>`                    |
| Back up, or move to a new machine        | `claude-db export`, then `import`               |
| Map a project that already exists        | `claude-db scan`, then the `/cdb-scan` skill    |

---

## 25. Words used in this project

| Word           | Meaning                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------- |
| Observation    | One saved record of a turn: kind, title, body, files, commands                                |
| Fact           | A short lasting lesson (rule, decision, dead end, to do, fact) with a stable key              |
| Project        | One repository, keyed by its git remote, or a folder with no remote                           |
| Chat (session) | One Claude Code chat                                                                          |
| Turn           | One request and Claude's reply to it                                                          |
| Hook           | A small script Claude Code runs at a fixed moment                                             |
| MCP server     | A helper Claude Code starts, which Claude can call as tools                                   |
| Pick           | The one or two notes Haiku chooses to show with a prompt                                      |
| Candidate      | One of the ten notes the search offers to the picker                                          |
| Distill        | Turn a finished chat into facts                                                               |
| Backfill       | Distill every chat that is still waiting                                                      |
| Handoff        | A note with Done, Open and Next lines, for the next chat                                      |
| Not finished   | A request another chat is still working on                                                    |
| Symbol         | A named piece of code: function, class, method, type, constant                                |
| Edge           | A link between two symbols: calls, imports, extends, implements, references, defines, aliases |
| EXTRACTED      | An edge read literally from the syntax                                                        |
| INFERRED       | An edge matched by name across files, with a score                                            |
| Embedding      | A list of numbers that stands for the meaning of a text, used for search                      |
| Redaction      | Replacing secrets with a marker before saving                                                 |
| Pause          | The wait after a failed Haiku call: 1 hour, then 6 hours, then a day                          |
