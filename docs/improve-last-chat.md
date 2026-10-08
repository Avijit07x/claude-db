# Improve: a new chat knows what the last chat did

This file holds the problem, the design and the steps. A step is marked done only after its checks ran and
passed.

Status: all 12 steps done and verified 2026-10-08. Released in 0.12.2.

## Problem

People do not end chats. They leave one open and start a new one. The new chat should know what the other chats
were doing, without anyone running `/handoff`.

It did not. On 2026-10-08 a new chat in this repo was shown the 2026-10-07 handoff note, which said "v0.12
uncommitted", while the chat before it had already released 0.12.0 and 0.12.1. The new chat started with wrong
information, and nothing told it about the newer work.

## What the code did

Found by reading the code on 2026-10-08.

- **The start block showed no last chat.** `startFacts()` in `src/facts/start.ts` shows facts, the newest
  handoff note, to-dos and uncommitted files. A chat summary was shown only by `legacyBlock()`, which
  `session-start.ts` uses only when there are no facts at all.
- **The handoff note was shown however old its content was.** `newestHandoff()` returns the newest note up to
  14 days old. Work done after it did not hide it.
- **Chats were ordered by start time.** `recentSessions()` sorts by `started_at`. A chat that started yesterday
  and was used today sorted after a short chat from this morning. `/catchup` named the last chat this way.
- **An open chat's summary only covers its start.** Each saved turn updates the summary, but it keeps the first
  three titles and then stops changing. The summary from the facts run replaces it when the chat ends.
- **A request is saved one message late.** `user-prompt.ts` saves the finished turn when the next prompt is sent,
  and `session-end.ts` when the chat ends. A saved turn keeps the time its request was asked, and its body
  starts with `Asked: <request>`.

## Part 1: one last chat (done)

1. **A "Last chat" part in the start block**, between "This project" and the handoff note. It shows the chat with
   the newest saved turn, open or ended, never the chat that is starting.

   ```
   Last chat (Oct 8):
   - Summary: v0.12.0 released ... v0.12.1 released ...
   - asked "now merge and tag": You okayed the same steps as 0.12.0 ... (60dae435-6d77)
   - asked "ok go with the plan": Search already has an excludeSessions filter. (b69a676f-b735)
   ```

   - The last 5 turns, oldest first: the request from the `Asked:` line, cut to 120 characters, and the title.
   - Each line carries its id, and is reported as shown so prompts do not repeat it.
   - The summary only when the chat ended after its newest turn, cut to 300 characters. An open or resumed
     chat's summary covers only its start, so it is left out.

2. **The last chat is found by its newest turn.** `list()` takes `excludeSessions`, in all three stores, the same
   filter search already had. The lookup asks for the newest row outside the `facts`, `manual` and `git` rows
   and the starting chat.
3. **A handoff note that newer work has passed is hidden.** Replaced in part 2 by design 5: the note is kept
   and marked. When the last chat has a request asked after the
   note was saved, the note's done, open and state lines may be wrong. The request that wrote the note was asked
   before the note was saved, so it does not count. The note stays saved.
4. **`/catchup` uses the same lookup.** It marks a passed note `older than the last chat` instead of hiding it,
   and the skill tells Claude the last chat wins where they differ. Run inside a chat, it leaves that chat out,
   using `CLAUDE_CODE_SESSION_ID`.
5. **The `Asked:` reader is shared.** `askedIn()` moved next to the code that writes the line, in
   `src/capture/turn-extractor.ts`.

## Part 2: edge cases part 1 misses

Found on 2026-10-08 by running chats through the real prompt, end and start hooks, with real chat log files.
Chat A holds the real work and is left open. Chat B is opened next. Chat C is opened last and is the one that
must know. The "part 1" outputs below are the real output of that run. The "part 2" outputs are what part 2 must
give, checked in step 10.

### Case 0: only A, left open

```
10:00-10:30  Chat A: 4 requests, the last one "release the 0.12.2 patch"
10:35        Chat C opens
```

Part 1 misses A's last request. A request is saved when the next message is sent, and A sent none after it:

```
Last chat (Oct 8):
- asked "add retries to the worker queue": Added the retry in src/queue.ts with a 3 try limit.
- asked "write tests for the retry backoff": Added 4 backoff tests in test/queue.test.ts.
- asked "fix the failing test in the backoff suite": Fixed the timer in the backoff test.
```

Part 2 saves each request when Claude finishes the reply, so C shows all 4:

```
Last chat (Oct 8):
- asked "add retries to the worker queue": Added the retry in src/queue.ts with a 3 try limit.
- asked "write tests for the retry backoff": Added 4 backoff tests in test/queue.test.ts.
- asked "fix the failing test in the backoff suite": Fixed the timer in the backoff test.
- asked "release the 0.12.2 patch after the tests pass": Tagged v0.12.2 and published it to npm.
```

### Case 1: B has one real request, finished, B closed

```
10:00-10:30  Chat A: 4 requests, left open
10:40        Chat B: "rewrite the mailer to use env settings"  -> done -> B closed
10:55        Chat C opens
```

Part 1 shows only B. A's work is gone, and the summary only repeats the one request:

```
Last chat (Oct 8):
- Summary: Moved SMTP settings to env and added 6 tests.
- asked "rewrite the mailer to use env settings": Moved SMTP settings to env and added 6 tests.
```

Part 2 shows B, then A. A summary that only repeats lines already shown is left out:

```
Last chat (Oct 8):
- asked "rewrite the mailer to use env settings": Moved SMTP settings to env and added 6 tests.

Chat before (Oct 8):
- asked "add retries to the worker queue": Added the retry in src/queue.ts with a 3 try limit.
- asked "write tests for the retry backoff": Added 4 backoff tests in test/queue.test.ts.
- asked "fix the failing test in the backoff suite": Fixed the timer in the backoff test.
- asked "release the 0.12.2 patch after the tests pass": Tagged v0.12.2 and published it to npm.
```

### Case 2: B has one real request, finished, B left open

```
10:00-10:30  Chat A: 4 requests, left open
10:40        Chat B: "rewrite the mailer to use env settings"  -> done -> B left open
10:55        Chat C opens
```

Part 1 shows only A's first 3 requests, as in case 0. B's request is not saved either:

```
Last chat (Oct 8):
- asked "add retries to the worker queue": Added the retry in src/queue.ts with a 3 try limit.
- asked "write tests for the retry backoff": Added 4 backoff tests in test/queue.test.ts.
- asked "fix the failing test in the backoff suite": Fixed the timer in the backoff test.
```

Part 2 shows B, then A, the same as case 1.

### Case 3: B has one real request, Claude still working in B

```
10:00-10:30  Chat A: 4 requests, left open
10:40        Chat B: "rewrite the mailer to use env settings"  -> Claude still working
10:45        Chat C opens
```

Part 1 shows A's first 3 requests, as in case 0, and no sign that B is changing the code at the same time.
Part 2 shows:

```
Not finished yet in another chat (Oct 8, 10:40):
- asked "rewrite the mailer to use env settings"

Last chat (Oct 8):
- asked "add retries to the worker queue": Added the retry in src/queue.ts with a 3 try limit.
- asked "write tests for the retry backoff": Added 4 backoff tests in test/queue.test.ts.
- asked "fix the failing test in the backoff suite": Fixed the timer in the backoff test.
- asked "release the 0.12.2 patch after the tests pass": Tagged v0.12.2 and published it to npm.
```

### Case 4: B has only small talk

```
10:00-10:30  Chat A: 4 requests, left open
10:40        Chat B: "hi"  -> B closed or left open
10:45        Chat C opens
```

Small talk is never saved and never shown as not finished. Part 1 shows A's first 3 requests, as in case 0.
Part 2 shows all 4, as in case 0.

### Case 5: B became the real work, with 6 requests

```
10:00-10:30  Chat A: 4 requests, left open
10:40-10:50  Chat B: 6 requests, the last one "clean up the old mailer flags", left open
10:55        Chat C opens
```

Part 1 shows B's first 5 requests. The 6th is not saved yet:

```
Last chat (Oct 8):
- asked "start the mailer rewrite": Done: start the mailer rewrite.
- asked "move SMTP settings to env": Done: move SMTP settings to env.
- asked "add mailer tests": Done: add mailer tests.
- asked "fix the env loading in the mailer": Done: fix the env loading in the mailer.
- asked "update the mailer docs": Done: update the mailer docs.
```

Part 2 shows B's newest 5. B fills the 5 lines, so A is not shown. B is the latest work:

```
Last chat (Oct 8):
- asked "move SMTP settings to env": Done: move SMTP settings to env.
- asked "add mailer tests": Done: add mailer tests.
- asked "fix the env loading in the mailer": Done: fix the env loading in the mailer.
- asked "update the mailer docs": Done: update the mailer docs.
- asked "clean up the old mailer flags": Done: clean up the old mailer flags.
```

### Case 6: going back to chat A instead of opening C

```
10:00-10:30  Chat A: 4 requests, left open
10:40        Chat B: "rewrite the mailer to use env settings"  -> done -> B closed
10:55        Chat A is resumed
```

A never shows itself. Part 1 shows B, with the summary that repeats it:

```
Last chat (Oct 8):
- Summary: Moved SMTP settings to env and added 6 tests.
- asked "rewrite the mailer to use env settings": Moved SMTP settings to env and added 6 tests.
```

Part 2 shows B without the repeat. With no other chat before B, there is no `Chat before`:

```
Last chat (Oct 8):
- asked "rewrite the mailer to use env settings": Moved SMTP settings to env and added 6 tests.
```

### Case 7: a handoff note, before or after B's work

```
7a: 10:00-10:30  Chat A: 4 requests, left open
    10:35        /handoff in A: "Next: move the mailer to env"
    10:40        Chat B: "rewrite the mailer to use env settings"  -> done -> B left open
    10:55        Chat C opens

7b: the same, but B is closed and /handoff runs after B, at 10:55
```

The `/handoff` request itself is never saved: it is too short and edits no file, checked on a real `/handoff`
chat. So it never shows as a line and never counts as a request after the note.

7a, part 1 still shows the note, though B worked after it, because B's request is not saved yet:

```
Last chat (Oct 8):
- asked "add retries to the worker queue": Added the retry in src/queue.ts with a 3 try limit.
- asked "write tests for the retry backoff": Added 4 backoff tests in test/queue.test.ts.
- asked "fix the failing test in the backoff suite": Fixed the timer in the backoff test.

Last handoff (Oct 8):
- Done: retries, tests, 0.12.2 released.
- Open: mailer still on SMTP settings.
- Next: move the mailer to env.
```

7a, part 2 shows B, then A, and keeps the note, marked as older than the last chat, since B's request was asked
after it:

```
Last chat (Oct 8):
- asked "rewrite the mailer to use env settings": Moved SMTP settings to env and added 6 tests.

Chat before (Oct 8):
- asked "add retries to the worker queue": Added the retry in src/queue.ts with a 3 try limit.
- asked "write tests for the retry backoff": Added 4 backoff tests in test/queue.test.ts.
- asked "fix the failing test in the backoff suite": Fixed the timer in the backoff test.
- asked "release the 0.12.2 patch after the tests pass": Tagged v0.12.2 and published it to npm.

Last handoff (Oct 8, older than the last chat):
- Done: retries, tests, 0.12.2 released.
- Open: mailer still on SMTP settings.
- Next: move the mailer to env.
```

7b shows the note with no mark, in part 1 and part 2, since no request came after it. Part 2:

```
Last chat (Oct 8):
- asked "rewrite the mailer to use env settings": Moved SMTP settings to env and added 6 tests.

Chat before (Oct 8):
- asked "add retries to the worker queue": ...
- asked "write tests for the retry backoff": ...
- asked "fix the failing test in the backoff suite": ...
- asked "release the 0.12.2 patch after the tests pass": ...

Last handoff (Oct 8):
- Done: retries, tests, 0.12.2 released.
- Open: mailer still on SMTP settings.
- Next: move the mailer to env.
```

### Case 8: a chain of new chats

The rule: the newest 5 real requests, from at most 5 chats, grouped by chat. Empty chats and small talk save
nothing, so they never move it.

```
A: 4 real requests, left open
B: "hi"
C: 1 real request
D: opened, nothing typed
E, F, G ...: opened, nothing typed
```

D shows C, then A. B saved nothing, so it is skipped:

```
Last chat (Oct 8):
- asked "<C's request>": ...

Chat before (Oct 8):
- asked "<A's request 1>": ...
- asked "<A's request 2>": ...
- asked "<A's request 3>": ...
- asked "<A's request 4>": ...
```

E, F, G and every later empty chat show exactly the same as D. Opening chats never grows or changes it.

Real requests push old ones out, one at a time:

```
A: 4 real   C: 1 real   D: 1 real   E: 1 real   -> F opens

Last chat (Oct 8):    E's request
Chat before (Oct 8):  D's request
Chat before (Oct 8):  C's request
Chat before (Oct 8):  A's last 2 requests
```

```
E opens:                  D(1) C(1) A(3)
F opens after E asked 1:  E(1) D(1) C(1) A(2)
G opens after F asked 1:  F(1) E(1) D(1) C(1) A(1)
H opens after G asked 1:  G(1) F(1) E(1) D(1) C(1)   <- A drops out
```

Why a cap: this part is a small hint to start the new Claude, not the full history. A request pushed out stays
in memory. Each shown line carries its id for `get_observations`, the start block tells Claude to search memory
before asking the user, and each prompt recalls related rows, A's included.

### More cases

| Case                                                     | What C shows in part 2                                     |
| -------------------------------------------------------- | ---------------------------------------------------------- |
| B opened, nothing typed, closed or left open             | Only A, as in case 0                                       |
| A and B open at once, taking turns                       | Both, the one with the newest request first, each in order |
| Requests from 3, 4 or 5 chats among the newest 5         | Each chat in its own group, newest chat first              |
| A reply interrupted with Esc                             | Not finished until the next message, then saved, as today  |
| C opens in the seconds while B's finished turn is saved  | B's request, as not finished or as saved, never missing    |
| B sends a new request while its last one is being saved  | The new request as not finished, the last one as saved     |
| A turn Claude Code starts on its own, like a task notice | Never shown as not finished                                |
| A request with `<private>` text                          | The private part is never shown                            |
| A chat in another project                                | Never shown                                                |

```
A and B taking turns:
10:00 A: "add retries"   10:05 B: "check mailer"   10:10 A: "write tests"   10:15 B: "fix env"

Last chat (Oct 8):
- asked "check mailer": ...
- asked "fix env": ...

Chat before (Oct 8):
- asked "add retries": ...
- asked "write tests": ...
```

## Part 2 design

1. **The newest 5 real requests, from at most 5 chats, grouped by chat.** `lastChat()` becomes
   `recentChats()`. It reads the 10 newest rows outside the starting chat and the `facts`, `manual` and `git`
   rows, drops replaced rows, and keeps the newest 5. It groups them by chat, newest chat first, and reads each
   chat's session record for its summary. The newest chat is `Last chat`, each other one `Chat before`. Inside
   each, requests are oldest first. With 5 requests there are never more than 5 chats, so the cap needs no
   extra rule. A summary whose parts are all titles already shown is left out. The start block and `/catchup`
   both use it. One read for the rows, and one small read per chat shown.
2. **Save a request when Claude finishes the reply.** A new `Stop` hook, `src/hooks/turn-end.ts`.
   - Claude Code waits for a `Stop` hook, and saving can take up to 3 seconds with the local embedding
     model. So the hook only writes a small job file, with the chat, its log, the folder, the final reply text
     and the not-finished file's token, and starts `turn-save.js` in the background with `runDetached()`.
   - The Claude Code docs say the final reply text may not be in the log yet when `Stop` runs, and give it as
     `last_assistant_message`. The background save adds that text to the turn when the log lacks it.
   - A saved turn has the same id whenever it is saved, from the chat, the time it was asked and the request.
     SQLite, Postgres and Mongo all replace a row with the same id. So a save at `Stop` and a later save of the
     same turn are one row, never two.
   - The saved position stays at the start of the last turn, as it does today. If Claude goes on in the same
     turn, for example because another tool's `Stop` hook asks it to, the next save still picks up the rest. The
     next message re-reads that one turn and replaces the same row, as every save does today.
   - `Stop` does not run when a reply is interrupted. The save at the next message and at the end of the chat
     stay as they are, so that turn is still saved, one message late.
   - Existing installs get the new hook at their next chat start: `refreshHooks()` adds missing hooks of ours
     when the installed ones point at the same place.
3. **Show a request that is not finished yet.** One small file per chat in `~/.claude-memory/active/`, the same
   way `src/pick/pending.ts` keeps its per-chat files.
   - `user-prompt.ts` writes it on every real request: the project, the request and the time asked. Small talk
     is skipped with `isSearchable()`, turns Claude Code starts on its own with `isSyntheticPrompt()`, and
     `<private>` text is stripped the way saved turns strip it. Both helpers are exported and reused.
   - The background save deletes it after the turn is saved, never before, so a chat that opens in between sees
     the request in one place or the other. It deletes it only when the file still has the token the `Stop` hook
     saw, so a newer request's file is kept.
   - `session-end.ts` deletes it.
   - Work can go on after the reply ends. The real `Stop` input lists `background_tasks`, with
     `"status": "running"` for a shell Claude moved to the background, and `session_crons`, the chat's scheduled
     runs, which was always empty in the real runs. While either has something, the turn is still saved but the
     mark stays. It is cleared by a later `Stop` with nothing running, by the next request, or at the end of the
     chat. Found on a real `claude -p` run, where Claude moved `sleep 25` to the background and the request
     disappeared from the next chat.
   - A turn Claude Code starts on its own, such as a task notice when a background task ends, leaves the mark
     as it is. Small talk still clears it, since it means the earlier request is over.
   - At chat start and in `/catchup`, the files of other chats in the same project, at most 2 hours old, show
     under `Not finished yet in another chat`, before `Last chat`, at most 2. The request is cut to 120
     characters, and secrets are removed with `redact()`.
   - A request asked after a handoff note and not finished yet marks that note as older, the same as a saved
     one.
   - Files older than a day are deleted, the same way old pick files are.
   - Headless runs write nothing. The prompt hook already skips them, and claude-db's own Haiku calls run with
     `--no-session-persistence`.
   - A request in another folder of the same project, such as a worktree, is shown too: the files are matched
     against `projectScope()`, every folder and key linked to the project.
   - `isSyntheticPrompt()` also drops prompts that start with `<task-notification>`. Claude Code starts those
     turns on its own, checked on a real one in a chat log. Saved turns skip them too, the same as before,
     since the log reader already skipped them by their origin.
   - The small JSON file helpers that `src/pick/pending.ts` kept to itself move to `src/util/json-file.ts`, and
     the pick files, the not-finished files and the `Stop` jobs all use them.
4. **A project with no facts yet shows the same parts.** `startFacts()` returns nothing when a project has no
   facts, no notes and no handoff, for example right after install or with `distill.enabled` off. The start hook
   then shows the older fallback block, and now also `recentWorkBlock()`: the not-finished requests and the
   recent chats, built by the same code as in the full block.

5. **Keep a passed handoff note, marked.** Decided 2026-10-08, replacing part 1 item 3. A handoff is written on
   purpose, so a side question in another chat must not make it disappear.
   - The start block always shows the newest note up to 14 days old, in the same place as today.
   - When a real request in another chat was asked after the note, saved or not finished yet, the heading says
     so. Without one, the note looks exactly as in 0.12.1.

     ```
     Last handoff (Oct 8, older than the last chat):
     - Done: ...
     - Next: ...
     ```

   - The new Claude sees the note and the newer work above it, and knows which is newer.
   - `/catchup` already marks it this way. One heading function in `src/facts/handoff.ts` is used by both.
   - Released 0.12.1 shows the note with no mark. Part 1 hid it. This keeps it and adds the mark.

## Not changed

- The database layout.
- `recentSessions()`. The legacy block and the facts backfill keep using it.
- How a turn is turned into a saved row.

## Decisions

- An interrupted reply stays not finished until the next message, or for 2 hours. Claude Code runs no hook when
  a reply is interrupted, so nothing can clear it sooner. A stopped request still matters to a new chat: the
  files it touched may be half changed.
- Facts from an open chat are made when the chat ends, as before. Making them per reply would cost a Haiku call
  per reply. The saved requests already reach the next chat at once, and facts are for the long term.

## Steps

| #   | Step                                                                                 | Status |
| --- | ------------------------------------------------------------------------------------ | ------ |
| 1   | Problem and design (this file)                                                       | done   |
| 2   | `excludeSessions` on `list()` in SQLite, Postgres and Mongo, with tests              | done   |
| 3   | Shared `Asked:` reader and the last chat lookup, with tests                          | done   |
| 4   | "Last chat" in the start block                                                       | done   |
| 5   | Hide a handoff note that newer work has passed (replaced by step 7), with tests      | done   |
| 6   | `/catchup` uses the same lookup                                                      | done   |
| 7   | Keep a passed handoff note, marked: shared heading, start block, tests, docs         | done   |
| 8   | The newest 5 real requests from at most 5 chats, in the start block and `/catchup`   | done   |
| 9   | Save a request when Claude finishes the reply: the `Stop` hook                       | done   |
| 10  | The not-finished file: write, delete, sweep, show, and mark a passed handoff         | done   |
| 11  | End to end: the cases through the real hooks in the tests, and real `claude -p` runs | done   |
| 12  | Docs, changelog and patch release                                                    | done   |

## Tests

Part 1, in `scripts/unit/isolated/last-chat-run.mjs`, `scripts/smoke/sessions.mjs` and
`scripts/unit/adapters.mjs`:

- Nothing saved, and only facts, notes or git rows: no last chat.
- The starting chat and a resumed chat never name themselves, in the lookup, the start hook and `catchup`.
- Another project's chat is never taken.
- A chat used today beats a chat that started later but stopped earlier.
- Open, ended, resumed and unrecorded chats, and when each shows a summary.
- The last 5 turns, oldest first, without replaced rows. Long requests and summaries are cut.
- A handoff with no request after it is shown, one with a request after it is hidden, and a request at the
  same moment does not hide it.
- Rows restored after a compact are not repeated, and the block stays within `inject.maxChars`.
- `excludeSessions` on SQLite, Postgres and Mongo, alone, empty, and together with `sessionId`.

Part 2 adds a check for each case above, cases 0 to 8 and every row of the table, and:

- The `Stop` hook returns at once and the turn is saved in the background, with the final reply text, also
  when the log does not have that text yet.
- A turn saved at `Stop` and again at the next message is one row.
- An interrupted turn, with no `Stop`, is saved at the next message.
- The not-finished file is written on a real request, skipped for small talk and turns Claude Code starts on
  its own, has no `<private>` text, is deleted after the save and at the end of the chat, is kept when it names
  a newer request, is ignored after 2 hours, and is swept after a day.
- A summary that only repeats the shown titles is left out.
- A handoff with a real request after it, saved or not finished, is shown with the `older than the last chat`
  mark, and never as a plain line. Without one it has no mark. A request at the same moment adds no mark.
  The part 1 check that expects the note hidden, in `last-chat-run.mjs`, changes to expect the mark.
- The changelog, `docs/architecture.md` and the `/handoff` docs page say the note is marked, not hidden.
- A chain of chats: empty chats and small talk never move the part, and real requests push old ones out one at
  a time, from at most 5 chats.
- Another chat's not-finished request never shows its own chat, another project, or a headless run.
- Part 1's checks still pass, and the block stays within `inject.maxChars` with all sections.
- Real `claude -p` runs, with only the new hooks through `--settings` and `--setting-sources`, and a throwaway
  database: the `Stop` hook saves the turn with no end-of-chat hook, and a second run sees the first one's
  request, finished or not finished yet.
