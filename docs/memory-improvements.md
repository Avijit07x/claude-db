# Memory improvements: plan, results and findings

**Date:** 2026-10-06. Everything in this document was planned, built, measured and written on that one
day. Times are IST (UTC+5:30).

**Status:** Built and tested, and listed under 0.10.0 in the [changelog](../CHANGELOG.md). The
main goal, that 8 in 10 of the memories shown are useful, is close but not reached: 61% to 70% are.

**Where the numbers come from:** one real project with 21 chats and 551
memories, replayed in time order. The method and its limits are in
[How the numbers were measured](#11-how-the-numbers-were-measured).

This one document replaces three earlier working files: the plan, the list of findings, and the plan
for the per-prompt pick. For setting claude-db up, see the [setup guide](./setup-guide.md).

## Contents

1. [Summary](#1-summary)
2. [Timeline](#2-timeline)
3. [Why Claude ignored memory](#3-why-claude-ignored-memory)
4. [Plan and status, phase by phase](#4-plan-and-status-phase-by-phase)
5. [Decisions](#5-decisions)
6. [Upgrading old memory](#6-upgrading-old-memory)
7. [The per-prompt pick](#7-the-per-prompt-pick)
8. [Findings log](#8-findings-log)
9. [Engineering and release hygiene](#9-engineering-and-release-hygiene)
10. [Open items](#10-open-items)
11. [How the numbers were measured](#11-how-the-numbers-were-measured)
12. [Code map](#12-code-map)

---

## 1. Summary

claude-db already injected memory with every prompt, and Claude still ignored most of it. In one real
project Claude ran 3,778 shell commands and made only 15 memory searches. The memories were chat lines
rather than facts, the matching was loose, the block asked Claude to do extra work, and sharing broke
across machines. This work fixed the first three. Sharing across machines (Phase 5) is not started.

### What was built

1. **A measurement you can trust.** `npm run bench:inject` replays past prompts in time order and has a
   model judge whether each memory shown would help. The first judge was close to chance (F-8) and was
   rebuilt. Every number in this document was measured with the rebuilt one, except where marked void.
2. **Cleaner capture.** Subagent reports, task notifications, image paths, hidden skill text and IDE
   tags no longer become memory or trigger recall (F-4, F-5, F-11, F-13). Memory saved under the old
   rules is repaired once, in the background (F-19).
3. **Facts instead of chat lines.** When a chat ends, Claude Haiku turns it into short rules,
   decisions with their reasons, dead ends and to-dos. A chat now opens with "About you", "This
   project" and "Where you stopped". Claude Code's own memory files are imported too (Phases 2 and 3).
4. **Haiku picks the memory shown with each prompt.** A word filter decides whether a prompt is worth a
   pick, Haiku picks at most two memories and must quote one sentence from each, and the code checks the
   quote. The pick runs in the background and reaches Claude with its first tool call (section 7).
5. **Smaller wins.** After `/compact` the chat's own decisions come back. The MCP server explains
   itself in the system prompt. The privacy notes list every outside call.
6. **Safer storage.** Secrets written as `NAME=value` are now redacted, and memory saved earlier is
   cleaned once, in the background (F-31).
7. **Engineering.** ESLint with type-aware rules, knip, c8, publint, arethetypeswrong and CodeQL are in
   CI. The MCP tools, the CLI and the end-of-chat hook have end-to-end tests. The real minimum Node
   version was found and enforced: 22.16, not 22.5 (F-32).

### Results

| Measure                           | Goal      | Before                                                | After                                           |
| --------------------------------- | --------- | ----------------------------------------------------- | ----------------------------------------------- |
| Prompts that get memory           | under 40% | 74% at first; 50% to 56% in later replays             | 30%                                             |
| Memory shown from the same chat   | 0%        | 27%                                                   | 0%                                              |
| Shown memories judged useful      | 8 in 10   | 23%                                                   | 61% to 70%                                      |
| Recall per prompt, averaged       | no goal   | 180 tokens, an assumed figure that was never measured | 20 tokens                                       |
| Size of one memory block          | no goal   | about 130 tokens                                      | about 63 tokens, each line saying what it holds |
| Prompts that get no recall at all | no goal   | 28% (the same assumed figure)                         | 69%                                             |
| Checks in the test suite          | no goal   | 651 after Phase 3                                     | 778                                             |
| Lines covered by tests            | no goal   | 65%                                                   | 77%                                             |

Why a range for "useful": 70% is how the study's labels scored the picks that were studied. 61% to 65%
is the final end-to-end run of the shipped code, with Haiku picking again and Sonnet judging twice
(kappa 0.78). The before figure is 23% on the same labels. Section 7.11 has both runs.

### What is open

The 8-in-10 goal, one benchmark that needs another machine, slow fact-making calls, Phases 4 to 6, and
three upgrade pieces that were designed but not built. Section 10 lists each with its reason.

---

## 2. Timeline

All on 2026-10-06, IST.

| Time          | What happened                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| 09:30         | The problem is raised: Claude rarely uses the memory. Ideas and options are discussed until 09:37.            |
| 09:40         | The plan is first written, Phases 0 to 6 with examples.                                                       |
| 09:47         | The open decisions are settled: Haiku, on by default, and old memory converts to the new format on its own.   |
| 09:53         | Building starts, following the plan.                                                                          |
| 09:57 - 10:13 | Phase 0 (the bench) and Phase 1 (recall cleanup, `/compact` recovery).                                        |
| 10:47         | The findings log is started: everything not fixed in the step where it showed up.                             |
| 11:07 - 11:17 | The shared headless Claude runner, and the repair of older memory (F-19).                                     |
| 11:00 - 12:40 | Findings are fixed in rounds; F-23 is decided at 12:08.                                                       |
| 12:15 - 12:17 | Facts: fact-making, the import of Claude's memory files, the new start-of-chat block (Phases 2 and 3).        |
| 13:50 - 14:19 | Root-cause work on F-2. By 14:19 the first judge is found to be close to chance, so earlier tuning was blind. |
| 14:36 - 14:54 | The options are measured. Decision at 14:54: a word filter, then Haiku, with a daily limit.                   |
| 14:56 - 15:45 | The pick is planned, built, checked end to end with real Claude Code, measured and documented.                |
| 15:45 - 16:12 | Tooling and end-to-end tests; the Node minimum is corrected (F-32); CI is extended.                           |
| 16:19 - 16:21 | The clean-up job for secrets in saved memory is built and run on the maintainer's database.                   |
| 16:34         | This document is requested, to replace the three working files.                                               |

---

## 3. Why Claude ignored memory

Measured on a real project (21 chats, 551 memories) before any change:

- Claude ran 3,778 shell commands but only 15 memory searches.
- Only 1 of the 551 memories is a preference.
- Claude Code's own memory folder for the same project holds about 20 clean rules.
- In a time-correct replay, 87 of 97 prompts got memory injected.
- 18% of injected rows came from the same chat, so Claude already had them.
- All 551 rows use the built-in hash embedder, so search does not match by meaning.

The root causes:

1. **Memories are chat lines, not facts.** Titles look like "Tests are green." That tells Claude
   nothing.
2. **Matching is too loose.** One shared word is enough to inject. A resume question got "Lint and
   typecheck pass, all 412 tests pass".
3. **The block asks for extra work.** It shows a title and a short snippet, then asks Claude to call
   `get_observations`. Claude skips the extra call.
4. **Sharing breaks across machines.** Projects are keyed by local folder path, so a teammate's path
   never matches yours.

So Claude learns the block is noise, and stops reading it.

Claude Code now has its own memory with recall. claude-db should not copy it. It should do what Claude
Code cannot: share context across chats, machines, projects and people.

A later, deeper cause surfaced during the F-2 work: even when the right memory existed, choosing it
was close to a coin flip. See section 7.2.

---

## 4. Plan and status, phase by phase

The plan was written as small phases. Each can ship alone and has a check that shows whether it
worked.

| Phase | What                             | Status                                                               |
| ----- | -------------------------------- | -------------------------------------------------------------------- |
| 0     | Measure first                    | Done                                                                 |
| 1     | Quick wins                       | Done                                                                 |
| 2     | Save facts, not chat             | Built; shown memory is now picked by Haiku (section 7)               |
| 3     | Import Claude's own memory files | Done                                                                 |
| 4     | Memory for each file             | Not started                                                          |
| 5     | Sharing                          | Not started                                                          |
| 6     | Smarter search                   | Not built as planned; the measurements point elsewhere (see Phase 6) |

### Phase 0: Measure first

**What**

- Turn the replay test into a script: `npm run bench:inject`.
- It replays past prompts in time order, exactly as the hook would see them.
- It runs on local chats only. Nothing is committed.

**Planned output**

```
Memory check (last 100 prompts)
  prompts that got memory     87    goal: under 40
  rows from the same chat     18%   goal: 0%
  rows judged useful          new   goal: 8 in 10
```

**Done when:** there are "before" numbers to compare every later phase against.

**Status:** Done. `npm run bench:inject [project] [--last N] [--show N] [--judge]`. It first ran two
Haiku judge passes; because that judge was close to chance (F-8) it now runs a blind Sonnet judge, one
prompt per call, twice, and prints their agreement. `--no-pick` replays without Haiku and
`--judge-model` chooses the judge. The final run of the shipped code printed:

```
Memory check  <project>
  replayed 300 prompts from 14 chats, in time order

  prompts that got memory    89 of 300 (30%)      goal: under 40%
  rows from the same chat    0 of 110 (0%)        goal: 0%
  Haiku picks                89 picked, 124 passed, 0 failed asked on 213 prompts
  rows judged useful         61% to 65%           goal: 8 in 10 (sonnet)
  judge agreement            kappa 0.78           two blind passes; under 0.6 is too noisy
  average block              ~63 tokens
  recall per prompt          ~20 tokens           every prompt, including the ones that got nothing
```

### Phase 1: Quick wins

#### 1a. Clean up what gets injected

**What**

- Skip memories from the current chat.
- Need at least 2 matching words, not 1.
- Show at most 3 lines, written as plain sentences.
- Show nothing when nothing matches well.
- Added during the work: skip prompts the user did not type (subagent reports, task notifications,
  slash commands), and strip image paths before searching. They matched on noise.

**Files:** [user-prompt.ts](../src/hooks/user-prompt.ts), [relevance.ts](../src/hooks/relevance.ts),
[schema.ts](../src/config/schema.ts), [types.ts](../src/types.ts)

**Before**

```
<recalled-memory>
8b8cbe2f-cf36 context 2026-10 I left it unchanged.
f326dc9a-0593 pattern 2026-10 I updated both config files.
</recalled-memory>
Expand any listed id with get_observations...
```

**After Phase 1**

```
<memory>
- Oct 5: all 12 timers set to 1.1s, because you said they fired too early. (a1b2)
</memory>
```

Since the pick (section 7), a line also carries the question it answered and one copied sentence, and
at most two lines are shown.

#### 1b. No gap after `/compact`

**What**

- The start hook already runs again after `/compact`.
- In that case, add back this chat's own decisions and open work.
- This is the one time memory from the same chat is useful, because Claude just lost it.

**File:** [session-start.ts](../src/hooks/session-start.ts)

**Example**

```
<memory>
Earlier in this chat:
- Decided: the worker queue copies the standalone queue.
- Not done: ask about the cache and mail retries.
</memory>
```

**As built:** `recoverAfterCompact` forgets what the chat was shown, saves the chat, and renders up to
8 lines in time order, labelled Decided, Dead end, Rule or Not committed. It skips replaced rows and
duplicate titles. A first version repeated "Not committed" lines that the start block had already
shown; the ids it restores are now tracked.

#### 1c. Tell Claude about memory in the system prompt

**What**

- Fill in the MCP server's `instructions` field.
- Claude Code puts it in the system prompt every session, even for global installs.

**File:** [server.ts](../src/mcp/server.ts)

**As built:** about 650 characters, inside the 2,048-character limit Claude Code applies. A test checks
the length.

**Done when:** under 40% of prompts get memory, and none of it comes from the same chat.

**Status:** Done. Memory from the same chat went from 27% to 0%, and blocks from about 130 to about 37
tokens. Prompts with memory went from 74% to 41%, one point short of the goal (F-1); the pick later
brought it to 30%.

#### Phase 1 results

| Measure                     | Before      | After Phase 1 | Goal      |
| --------------------------- | ----------- | ------------- | --------- |
| Prompts that got memory     | 74%         | 41%           | under 40% |
| Memories from the same chat | 27%         | 0%            | 0%        |
| Memories judged useful      | about 45%   | 39% to 47%    | 8 in 10   |
| Average block               | ~130 tokens | ~37 tokens    | no goal   |

The "useful" row came from the first judge and is void (F-8). The other rows were not affected.

### Phase 2: Save facts, not chat

This is the big fix.

#### 2a. Turn each chat into facts

**What**

- When a chat ends, a small AI (Haiku) reads it and writes short facts.
- On by default. See [Decisions](#5-decisions) for the safety rules.
- It runs in the background, so closing a chat stays fast.
- It is shown the facts that already exist, so it updates them instead of adding copies.
- The raw chat stays saved as proof. Only facts get injected.

**Files:** [summarize.ts](../src/capture/summarize.ts) (reuse the `claude -p` call),
[session-end.ts](../src/hooks/session-end.ts), and the new `src/facts/distill.ts`

**Example: what the AI returns**

```json
{"type":"rule","scope":"you","text":"Reply in plain text, never tables","key":"plain-text"}
{"type":"decision","scope":"project","text":"Timers fire after 1.1s","why":"user said too early","files":["timer.tsx"]}
{"type":"deadend","scope":"project","text":"Banner top space change was undone; keep 32px"}
{"type":"todo","scope":"project","text":"Ask which retries to change on the worker queue"}
```

#### 2b. Two scopes: you and the project

**What**

- **You** facts show in every project. Example: "Write commit messages in the imperative mood."
- **Project** facts show only in that project. Example: "Timers fire after 1.1s."

#### 2c. A new start-of-chat block

**What**

- Built from facts, instead of session summaries.

**Example**

```
<memory>
About you:
- Write commit messages in the imperative mood.
- You review the diffs. Do not push unless asked.

This project:
- Fix one service at a time. Tracker: docs/cleanup-plan.md

Where you stopped:
- Settings fix is in PR #18, not merged yet.
</memory>
```

**Done when:** at least 8 of 10 injected rows are judged useful.

**As built**

- A fact is an ordinary row: session id `facts`, tags `fact`, `type:<type>` and `key:<key>`. Its id comes
  from its owner and key, so a later chat updates it in place.
- Types: rule, decision, dead end, to-do and fact. A fact Haiku retires is marked `replaced`, which
  keeps it stored but out of search, the timeline, `view`, `stats` and the start block.
- Only a rule may be filed under "you", keyed by git email. Everything else is forced into its project,
  whatever scope the model asked for (F-27).
- Facts are always stored `done`, so the close-landed-work step cannot close a to-do (F-29).
- A chat is read in windows of about 40,000 characters (900 per row), up to six windows, one call each,
  each window seeing the facts saved so far. All of a chat's calls are reserved up front (F-28).
- Haiku's answer is JSON lines, at most 20 operations per call. Keys are lowercase letters, digits and
  hyphens, 2 to 60 characters. Text is at most 200 characters, a reason 300, and at most 5 files.
- The chat text is framed to the model as data, never as instructions.
- The start block shows to-dos and "Not committed" lines, and only the ids it really showed are marked
  as shown.
- A chat that has been turned into facts is marked, so a failed or interrupted run resumes where it
  stopped. Its summary becomes up to three of its facts.

**Status:** Built: facts with Haiku, scopes, the start block and upgrade steps 8 and 9. Above a prompt,
Haiku now picks from earlier chats' rows (section 7). The 8-in-10 goal is close but not reached
(61% to 70%).

### Phase 3: Import Claude's own memory files

**What**

- Read `~/.claude/projects/*/memory/*.md` into the database.
- Only re-read a file when its content changes.
- Claude's `user` memories go into **you**. Everything else goes into **project**.
- On the same machine, Claude already sees these files. So only inject them where Claude cannot see
  them: another machine, a teammate, or another project.

**Example**

```
$ claude-db status
imported : 23 facts from Claude memory (2 new since last time)
```

**Done when:** a fresh laptop on the shared database knows your rules in its first chat.

**As built:** the files' front matter is parsed; `feedback` memories become rules and everything else
becomes a fact. A file is saved only when it changed, and a fact is retired when its file is deleted.
On the machine and project where Claude already reads the file, the fact is hidden from the start block
(by machine and origin tags). `status` reports the number of facts and the chats still waiting.

**Status:** Done. Claude's "user" memory files go into their project rather than to the user, because
the real data showed personal details there (F-27).

### Phase 4: Memory for each file

**What**

- Right before Claude edits a file, show the facts tied to that file.
- A file match is exact, so it is almost never wrong.
- Each file is shown once per chat.

**Files:** [install.ts](../src/cli/install.ts) (add an `Edit|Write` hook), and a new
`src/hooks/file-memory.ts`

**Example**

```
<memory file="banner.tsx">
- Dead end (Oct 2): changing the banner top space was undone. Keep 32px.
</memory>
```

**Status:** Not started. One thing learned since: a file match on its own is weak evidence. In the F-2
labels, a memory sharing a file with the chat's recent files predicted usefulness at AUC 0.51, which is
no better than chance, and only 43 of 2,531 candidates shared one.

### Phase 5: Sharing

#### 5a. Match projects by git link

**What**

- Key a project as `github.com/acme/shop`, not `/home/dev/Code/shop`.
- Fall back to the folder path when there is no git remote.
- Old rows are not moved. A project map links every folder to its git key. See
  [Decisions](#5-decisions).

**File:** [project.ts](../src/util/project.ts)

#### 5b. `/catchup` and `/handoff` commands

**What**

- Ship them as skills, the same way `/cdb-scan` ships today.
- `/catchup` answers "where did I stop?".
- `/handoff` writes a note for the next chat or a teammate.

**Example: `/handoff`**

```
Handoff, Oct 6:
- Done: timers, queue, mail family.
- Open: PR #18 not merged.
- Next: ask which retries to change on the worker queue.
```

**Status:** Not started. Until it is, projects are matched by folder path, and `claude-db merge` moves
memory when a repository lives at a different path.

### Phase 6: Smarter search

**What**

- `install` offers the better search model (`@xenova/transformers`).
- For short prompts like "ok do the same", the hook adds the topic of Claude's last reply to the search
  query. The hook already gets `transcript_path`.

**Status:** Not built as planned.

- **The better model:** the first test of it was void (F-7). Models of the same family were re-measured
  as rerankers and were not needed, because a word filter before Haiku did as well and needs no
  download. The existing optional hint in `install` and `doctor` stays as it was.
- **The previous reply in the query:** it lowered a local model's score from 0.76 to 0.69, so the
  previous reply is given to Haiku instead, which uses it to judge relevance.
- IDE context tags were stripped from prompts (F-11), which was filed under this phase.

---

## 5. Decisions

### Decisions in the plan

#### 1. Making facts is on by default, with Haiku

New users and existing users both get it without doing anything. These rules keep it safe:

- It runs after the chat ends, in the background. It never slows a chat.
- One Haiku call per window of about 40,000 characters, so most chats are one call. A chat where
  nothing was saved is skipped.
- At most 30 calls a day (`distill.dailyLimit`). New chats go before old ones.
- Secrets and `<private>` text are removed before anything is sent.
- The call runs with `CLAUDE_DB_CAPTURE=off`, so it is never saved as a chat itself.
- If `claude` is missing, logged out or rate limited, it pauses for a day. The old capture keeps
  working.
- The user is told once, with the off switch: `claude-db distill off`.

It replaces `capture.summarize`: when facts are on, the AI summary step is skipped. A config file
written by `claude-db use` holds every default, `summarize: "off"` included, so that value does not
mean "the user said no", and it does not turn facts off.

**Status:** Built as described.

#### 2. The project key changes automatically, without moving data

- Old rows are never changed or deleted.
- A new **project map** links each folder to its git key:
  `/home/dev/Code/shop -> github.com/acme/shop`.
- Each machine adds its own folders to the map the first time it runs the new version.
- Search looks up every folder for the key, and searches them together.
- A teammate still on the old version keeps working. Their rows are untouched.
- No git remote: the folder path stays the key, the same as today.
- **You** facts are keyed by git email, not the login name. Many machines share a login name like
  `ubuntu`. On a shared team database, your personal rules never reach a teammate.
- `claude-db merge` stays, for a project whose git remote changed.

**Status:** Not built (Phase 5). The git-email key for "you" facts is built.

### Decisions made during the work

| Time  | Decision                                                                                               |
| ----- | ------------------------------------------------------------------------------------------------------ |
| 09:47 | Use Haiku for facts. New features are on by default. Old memory converts to the new format on its own. |
| 12:08 | F-23: the automatic repair stays repair-only and does not import chats from before recording started.  |
| 13:11 | Keep the full-size test runs, rather than shrinking them.                                              |
| 14:49 | Pick with Haiku, with a daily limit, rather than a local model alone.                                  |
| 14:54 | Use a word filter before Haiku, not a local model: same result, nothing to download.                   |
| 16:05 | Write end-to-end tests for the CLI, and enforce one Node minimum for users and contributors.           |
| 16:17 | Clean secrets already saved in memory, once, in the background.                                        |

---

## 6. Upgrading old memory

The plan was that existing users get their old memory in the new format, with nothing to run.

**Main rule: never change or delete old rows. Only add.** That makes the upgrade safe to run on its own,
and the old version still works on the same database.

### When it runs

- On the first hook run after an update.
- Fast steps run right away. The slow step runs in the background.

### Steps, and what was built

| Step | What                                                                                                       | Status                                                                                                                                                     |
| ---- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Check the version: `PRAGMA user_version` in SQLite, `claude_db_meta` in Postgres, a meta document in Mongo | Built for SQLite and Postgres, both now at schema version 4. MongoDB gets the new optional fields as they are written                                      |
| 2    | Lock, so only one process upgrades                                                                         | Built differently: a lock file per job in `~/.claude-memory/<job>/`, one per project or database, stale after 10 minutes. No lock rows in shared databases |
| 3    | Back up (SQLite only) with `VACUUM INTO`                                                                   | Not built                                                                                                                                                  |
| 4    | Add new columns and tables, additions only                                                                 | Built: `updated_at` and `distilled_at` on chats, and the status value `replaced`. Facts are ordinary rows, so there is no new table                        |
| 5    | Upgrade config: a value still equal to the old default moves to the new default                            | Built (`dropSupersededDefaults`), extended for the `promptResults` default                                                                                 |
| 6    | Fill the project map for this machine's folders                                                            | Not built (Phase 5)                                                                                                                                        |
| 7    | Import Claude's memory files                                                                               | Built (Phase 3)                                                                                                                                            |
| 8    | Turn old chats into facts, in the background                                                               | Built: saved rows, not transcripts; newest first; last 90 days; shared daily limit; resumable through a per-chat mark                                      |
| 9    | Rebuild chat summaries from the facts                                                                      | Built: a distilled chat's summary is up to three of its facts                                                                                              |
| 10   | Mark the version as done                                                                                   | Built differently: each one-time job keeps its own done mark (the repair and the redaction clean-up), and the facts backfill runs hourly                   |

Step 8 in detail, as planned and built:

- It reads the saved rows grouped by chat, not the transcripts. Claude Code deletes transcripts after
  30 days, and rows synced from another machine have no transcript here.
- Newest chats first. Only the last 90 days. Older rows stay searchable as history.
- It shares the daily limit with new chats, and new chats go first.
- It can stop and resume at any time. Each chat is marked when it is done.
- The model sees the facts that already exist, so 15 chats about timers give one timer fact, not 15.

### What the user sees

Planned: one message, once, sent as `systemMessage` so the user sees it, not only Claude.

```
claude-db 0.10: your memory is moving to the new format.
- 23 rules imported from Claude's memory (ready now)
- 15 old chats will become facts in the background (about 15 Haiku calls)
Turn off: claude-db distill off
```

Built: a one-time notice per machine says that chats are now turned into facts, with the daily limit
and the off switch. `claude-db status` shows `facts` and `waiting` lines, and `claude-db distill` shows
the day's count. There is no `upgrade` line.

Until the backfill is done, injection uses facts where they exist and falls back to older rows.

### Example: one old chat

**Before** (3 of the 36 rows saved from one chat)

```
bugfix  You asked me to check the build
bugfix  The linter suggests a shorter name.
bugfix  You'd like the short name, so I'll switch it.
```

**After**

```
rule      Use the short name retryMs.
decision  Settings panel has 10px right padding, so the fade shows.
```

### How to undo

- **Install the old version.** It ignores the new columns. Facts show up as normal memories. Nothing
  breaks.
- **`claude-db upgrade --undo`.** Planned to delete the facts made by the backfill. Not built. Old rows
  were never touched, so nothing is lost either way.
- **SQLite only:** the backup file from step 3 was planned. Not built.

### Hard cases

- **Two machines upgrade one shared database at once.** The lock stops a second run on one machine.
  Facts get stable ids from scope, project and key, so a repeated write updates instead of duplicating.
- **Laptop closed in the middle of a backfill.** It resumes in the next chat.
- **No `claude` command on PATH.** Steps 1 to 7 still run. The backfill waits, and a failed call pauses
  fact-making for a day while capture carries on.
- **Rate limit.** The backfill pauses until the next day.
- **Thousands of old chats.** The 90-day window and the daily limit keep it small. `status` shows how
  many are waiting.
- **The database user cannot add tables** (common on shared Postgres). Not tested.

### Done when

The plan's five checks, and what is known about each:

| Check                                                                          | Where it stands                                                                                                                               |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Upgrading a copy of a real database leaves the old row count and ids unchanged | The repair never deletes rows; it marks them replaced. On a copy of the maintainer's database: 140 rows replaced, no good row replaced (F-19) |
| Running the upgrade twice does nothing the second time                         | Tested for the redaction clean-up. The repair keeps a done mark per project                                                                   |
| Killing a backfill and restarting it makes no duplicate facts                  | By design: ids come from owner and key, and an unfinished chat is simply redone. Not tested separately                                        |
| The previous npm version reads an upgraded database without errors, in CI      | Not built                                                                                                                                     |
| Two folders with the same git remote return each other's memory                | Not built (Phase 5)                                                                                                                           |

### Suggested order

The plan's order was:

1. Phase 0 and Phase 1. Small, safe, and they give numbers. Upgrade step 5 ships here, because Phase 1
   changes config defaults.
2. Upgrade steps 1 to 4, 7 and 10, with Phase 3. The first visible win for existing users.
3. Phase 2, with upgrade steps 8 and 9. The core fix.
4. Phase 5, with upgrade step 6. The sharing story, which is what makes claude-db different.
5. Phase 4 and Phase 6.

Each later phase adds its own step to the same upgrade runner. Items 1 and 3 were done. Item 2 was done
except the backup (step 3). Items 4 and 5 were not started.

---

## 7. The per-prompt pick

This section is the fix for F-2: only about 1 in 4 memories shown with a prompt was useful, against a
goal of 8 in 10. It was planned and checked before any code was written.

**Decision (2026-10-06, 14:54):** a word filter decides whether a prompt is worth a pick, Haiku picks,
with a daily limit. No local model.

### 7.1 The problem

Before each prompt, claude-db adds a few memories from earlier chats. Only 1 in 4 of them helps.

Example, an invented one that follows the same pattern. The prompt was "why does the order feed drop after a minute".
Claude saw:

```
- The change is a single line in client.ts.
- The websocket client sends no heartbeat
- I renamed the config keys.
```

One line is the right memory, but it does not say what the problem was. The other two are noise.

### 7.2 Root causes, with evidence

All numbers come from 300 real prompts replayed in time order on a frozen copy of the chats. Each
prompt's top 10 search results (2,531 pairs) were labelled by Sonnet twice.

1. **The old judge was broken.** It graded 20 mixed items per call and answered by position. Its two
   passes agreed at kappa 0.14, close to chance (691 pairs judged twice, 82% raw agreement, 12% useful).
   Every earlier F-2 number was noise, including "facts above a prompt are worse" and "the embedding
   model is worse". The new judge grades one prompt per call, answers by memory id, and sees the end of
   the previous reply. Its two passes agree at kappa 0.80 (2,521 pairs, 95% raw agreement).
2. **Supply is fine.** 58% of prompts have at least one useful memory in their top 10.
3. **Picking is the problem.** Search rank predicts usefulness at AUC 0.58, close to a coin flip.
   Shared words reach 0.67. The best small local model reaches 0.76.
4. **The line Claude sees says little.** A memory's title is the first sentence of a reply. Scored
   alone, titles predict usefulness at AUC 0.56. Judged as shown, 31% of title lines help.

What predicts a useful memory (AUC: 0.5 is a coin flip, 1.0 is perfect), on the 2,531 labelled pairs
unless noted:

| Signal                                                         | AUC                        |
| -------------------------------------------------------------- | -------------------------- |
| Search rank                                                    | 0.582                      |
| Words shared with the prompt                                   | 0.667                      |
| Files shared with the chat's recent files                      | 0.514                      |
| Local reranker, ms-marco MiniLM                                | 0.756                      |
| Local reranker, Jina tiny                                      | 0.726                      |
| ms-marco with the previous reply added to the query            | 0.688                      |
| Jina tiny with the previous reply added to the query           | 0.552                      |
| ms-marco scoring only the memory's title                       | 0.555                      |
| ms-marco scoring only the question the memory answered         | 0.640                      |
| A trained mix of all signals, on prompts it had not seen       | 0.738                      |
| The reranker alone, on the same unseen prompts                 | 0.737                      |
| Facts as candidates: rank, words, ms-marco, Jina (2,418 pairs) | 0.607, 0.630, 0.685, 0.645 |

### 7.3 What was measured

Memory is "right" when Sonnet labels it useful. Same 300 prompts throughout.

| Way of picking                       | Memory on | Right   |
| ------------------------------------ | --------- | ------- |
| Today: top 3, 2 shared words         | 50%       | 25%     |
| Strict words: top 1, 4 shared words  | 12%       | 43%     |
| Local model only (ms-marco MiniLM)   | 11% - 16% | 57%-66% |
| Haiku picks from the top 10          | 32%       | 70%     |
| Local model filter, then Haiku       | 30%       | 74%     |
| **Word filter, then Haiku (chosen)** | **30%**   | **73%** |

| Line format, same picked memories  | Helps as shown | Tokens per line |
| ---------------------------------- | -------------- | --------------- |
| Title (today)                      | 31%            | 21              |
| Exact quote                        | 49%            | 34              |
| **Question asked + exact quote**   | **58%**        | 53              |
| First 500 characters of the memory | 53%            | 146             |
| Haiku's own note (rejected)        | 81%            | ~40             |

Haiku's free notes were rejected: only 42% were fully backed by the memory. Some mixed the current
prompt into a claim about the past. With them the same gate reached 79% to 80% useful, but an exact
quote that the code checks against the memory cannot make that mistake; 97% of quotes matched and the
rest are dropped.

An early version of the picker answered true or false for every candidate. Against the Sonnet labels on
all 2,531 pairs it had precision 73% and recall 51%, and letting it keep up to one, two or three memories
gave 70%, 69% and 69% useful on 50%, 48% and 47% of prompts.

Not chosen, with reasons:

- **Local model filter.** It works as well as the word filter (74% vs 73%) but needs about 200 MB of
  libraries plus a 23 MB model on every machine, and adds 0.3 s per prompt.
- **Local rerankers on their own.** At most 66% useful, on 11% of prompts.
- **A trained mix of signals.** No better on unseen prompts (0.738 against 0.737).
- **Bigger rerankers.** Scoring ten candidates in a warm process took 0.3 s (ms-marco MiniLM), 0.15 s
  (Jina tiny), 0.8 s (mxbai-rerank-xsmall) and 1.7 s (bge-reranker-base). First use downloads the model:
  about 7 s, 8 s, 20 s and 60 s. The two larger ones were stopped before they were scored.
- **Facts as candidates.** With Haiku picking, facts were right 60% of the time against 69% for chat
  memories. Facts keep their place at the start of a chat.
- **Previous reply in the search query.** It lowered the local model from 0.76 to 0.69.

Cost of one pick, measured with `--output-format json`: about 3,000 tokens in, 70 to 110 out, 1.6 to
2.5 seconds, about $0.0065 at API prices. Thinking must be off (`MAX_THINKING_TOKENS=0`); with it on,
output was 600 to 2,200 tokens and calls took 8 to 23 seconds. Thinking off did not change precision
(77% with and without, on the same 136 prompts). In the bench, with six calls at a time, the median call
took 3.4 s and the slowest tenth 4.1 s.

Per day, with Haiku asked on about 72% of prompts (the word filter's share):

| Prompts a day | Picks | Haiku tokens | API price   |
| ------------- | ----- | ------------ | ----------- |
| 50            | 36    | about 112k   | about $0.23 |
| 100           | 72    | about 223k   | about $0.47 |
| 200           | 144   | about 446k   | about $0.94 |
| The daily cap | 150   | about 465k   | about $0.98 |

On a subscription these count against plan usage rather than money. Haiku is the lightest model.

### 7.4 Design

```
UserPromptSubmit hook
  1. capture the previous turn (as today), keep the end of Claude's previous reply
  2. search the top 10 memories from other chats, drop ones already shown in this chat
  3. word filter: does any candidate share 2 or more words with the prompt?
       no  -> clear any pending pick, show nothing
  4. Haiku allowed? (pick on, daily limit not used up, not paused)
       no  -> fallback: strict words, top 1 with 4 or more shared words, shown now
       yes -> save a pending pick with a new token, start the picker in the background,
              show nothing now

Picker (detached process, about 2-4 s)
  5. send the previous reply, the prompt and the 10 memories to Haiku
  6. keep at most 2 picks whose quote is found word for word in the memory
  7. if the token is still current, save the ready block
     if Haiku failed: pause picking for one hour and save the fallback block instead

PreToolUse hook (every tool call, new)
  8. a ready block for this chat and the current token? -> add it as additionalContext once,
     mark its memories shown, delete it. Otherwise do nothing.
```

The prompt is never delayed. A turn that uses no tools never gets the pick; the next prompt replaces it.
A pick that finishes after the next prompt is ignored, because the token no longer matches.

Shown line:

```
<memory>
- Oct 1: asked "why does the order feed drop after a minute": The websocket client sends no heartbeat, so the proxy closes an idle connection after 60 seconds. (3f9c21ab-77d0)
</memory>
```

The question is cut at 120 characters. Fallback lines keep the older format (date, title, id).

### 7.5 Changes by file

**Measurement first (fixes F-8 at the root).**

- `scripts/bench-inject.mjs`: the judge grades one prompt per call, answers keyed by memory id, sees the
  end of the previous reply, Sonnet by default, two passes, prints kappa. The replay runs the real
  pipeline, with the picker called in-process instead of in the background.
- `scripts/lib/replay.mjs`: carries the previous reply for each prompt.

**Recall.**

- `src/hooks/prompt-recall.ts`: split into `promptCandidates` (search, shown filter, word filter) and
  `strictRecall` (fallback).
- `src/hooks/relevance.ts`: render picked lines (`asked "...": quote`).
- `src/pick/prompt.ts` (new): `buildPickPrompt`, and `parsePicks` with the quote check (a normalised
  substring of title plus body, at least 12 characters), at most 2 picks.
- `src/pick/pending.ts` (new): per-chat state in `~/.claude-memory/pick/`: `startPick` (new token),
  `clearPick`, `finishPick` (only if the token is current), `takeReady`. States older than 10 minutes
  are ignored.
- `src/pick/run.ts` (new): one pick end to end, given a runner, so tests and the bench can pass a fake
  or in-process runner.
- `src/pick/worker.ts` (new): the detached entry point.
- `src/hooks/pick-deliver.ts` (new): the PreToolUse hook. It imports only the light modules.
- `src/hooks/user-prompt.ts`: wires steps 1 to 4.
- `src/capture/flush.ts`: `flushSession` also returns the end of the previous reply. The reader always
  re-reads the last turn, so it is there.

**Shared pieces.**

- `src/util/claude-cli.ts`: `runHeadless` takes extra optional flags and extra environment. The picker
  passes `--system-prompt`, `--tools ""`, `--strict-mcp-config` (dropped one by one if the CLI does not
  know them) and `MAX_THINKING_TOKENS=0`. The instructions also stay in the prompt, so losing
  `--system-prompt` is harmless.
- `src/util/daily-budget.ts` (new): the daily counter and pause from `facts/budget.ts`, made generic.
  `facts/budget.ts` keeps its exports on top of it.
- `src/config/dir.ts` (new): `CONFIG_DIR` alone. Loading the config module costs about 50 ms against
  10 ms for bare node, and the new hook runs on every tool call. `config/load.ts` re-exports it.

**Config, CLI, wiring.**

- `src/config/schema.ts`: new section `pick: { enabled: true, model: 'haiku', dailyLimit: 150 }`.
- `src/cli/commands/pick.ts` (new), `src/cli/index.ts`, `usage.ts`: `claude-db pick on|off`, and a status
  line (picks used today, paused or not).
- `src/cli/install.ts`: registers `pick-deliver.js` for PreToolUse on all tools. It also fixes a bug found
  while planning: the install loop cleared our entries per hook, so a second PreToolUse entry removed the
  first. It now clears once per event, then adds all of ours.
- `src/cli/commands/doctor.ts`: builds the list of our hook files from the install table instead of a
  fixed pattern.
- `src/cli/refresh.ts`: self-heal. Session start already calls `refreshInstalled`, which updates the
  skill and instructions in every scope where claude-db is installed. It now also re-registers our hooks
  in each settings file that already has one of them, with the same merge as install, and writes only
  when something changed. Existing users get the new hook without running install again.

**Docs.** README, `docs/how-it-works.md`, the site pages (how it works, privacy, cli, benchmarks), the
changelog.

### 7.6 Failure handling

| Case                                         | What happens                                                  |
| -------------------------------------------- | ------------------------------------------------------------- |
| `pick off`                                   | Strict-word fallback at prompt time                           |
| Daily limit reached                          | Strict-word fallback until the next day                       |
| `claude` missing, logged out, error, timeout | Fallback block delivered; picking paused 1 hour               |
| Haiku returns bad JSON or no exact quotes    | Nothing shown for that prompt                                 |
| Next prompt arrives first                    | Old pick ignored (token)                                      |
| Turn uses no tools                           | Pick never shown, replaced by the next prompt                 |
| Pending state older than 10 minutes          | Ignored and removed                                           |
| Picker's own `claude -p` session             | Capture is off there and it has no tools, so no hooks recurse |

### 7.7 Privacy

The pick sends the end of the previous reply, the prompt, and up to 10 memory excerpts (600 characters
each) to Haiku through the user's own `claude` login, the same service the chat already uses. Nothing
goes anywhere else. `claude-db pick off` stops it. The privacy pages list it next to fact-making.

### 7.8 Tests

- Unit: `parsePicks` (exact quote kept, reworded quote dropped, more than 2, unknown ids, bad JSON), the
  word filter, the strict fallback, pending tokens (stale, replaced, wrong token), the deliver output
  shape, the previous reply when the last turn is the new prompt, `runHeadless` extra flags and
  environment, budget, config defaults, install keeping two PreToolUse entries, self-heal adding only
  missing entries.
- Isolated: a full pick with a fake runner, from the prompt hook to delivery, including a failed pick,
  a paused pick, pick off, and a key typed in the prompt never reaching Haiku.
- Bench: `bench:inject --judge` on the frozen copy.

### 7.9 Verification of the plan

Each assumption above was checked before coding.

| Assumption                                                            | How it was checked                                                                                                                         | Result                  |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| A PreToolUse hook without a matcher runs on every tool                | Real `claude -p` run with a probe hook: it fired for Read and for Bash. Docs: "omit the matcher or use `*`"                                | Holds                   |
| PreToolUse `additionalContext` reaches the model                      | Same run: the hook added a secret word and Claude repeated it. Docs: injected as a system reminder, no `permissionDecision` needed         | Holds                   |
| Our two PreToolUse entries both run                                   | Same run: the `Bash\|Grep` probe and the all-tools probe both fired for Bash. Docs: matching hooks run in parallel, all contexts delivered | Holds                   |
| The new prompt is not yet in the transcript when the prompt hook runs | Two-prompt `claude -p --continue` run: at the second prompt the transcript held only the first prompt and its reply                        | Holds                   |
| The reader returns the previous turn at prompt time                   | `readTranscript` sets the next offset to the start of the last turn, so the last turn is always read again                                 | Holds                   |
| Hooks added to settings by self-heal take effect                      | Docs: "Direct edits to hook configurations in settings files take effect automatically through the file watcher"                           | Holds                   |
| The install loop drops a second entry for the same event              | Read `install`: each hook clears our entries for its event, including the one just added                                                   | Bug, fixed in this work |
| `--tools ""` passes through `execFile`                                | The 254-prompt quote run used it: 254 of 254 answered, no failures                                                                         | Holds                   |
| `MAX_THINKING_TOKENS=0` turns thinking off                            | Output fell from 600-2,200 tokens to 66-113 per call                                                                                       | Holds                   |
| Thinking off keeps precision                                          | Same 136 prompts: 77% with and without                                                                                                     | Holds                   |
| The word filter matches the local model as a filter                   | Same picks: 73% against 74%, memory on 30% for both                                                                                        | Holds                   |
| Exact quotes can be checked in code                                   | 142 of 146 quotes matched after removing markdown marks and extra spaces                                                                   | Holds                   |
| The new hook must stay light                                          | Bare node 10 ms, loading the config module 50 ms, on every tool call. The finished hook takes about 20 ms when nothing is waiting          | Split `CONFIG_DIR` out  |
| The picker's own `claude -p` does not run claude-db hooks             | `runHeadless` sets `CLAUDE_DB_CAPTURE=off`, which every hook checks first; the picker has no tools, so no PreToolUse fires                 | Holds                   |

Checked during the work:

- **The detached picker outlives the prompt hook.** The isolated test runs the real prompt hook with a
  fake `claude`, and the pick still lands after the hook has exited.
- **A full run with real Claude Code.** In a temporary home with seeded memory, `claude -p` with the
  real hooks: the prompt went through at once, Haiku picked in the background (one call counted), the
  pick arrived with the first tool calls, and Claude quoted it and used it in its answer.

### 7.10 Changed during review

- `inject.promptResults` had become unused. It is now the most memories Haiku may pick, default 2 (the
  tested value). Saved configs on the 0.9 default of 3 move to 2. Picked lines also respect
  `inject.promptMaxChars`.
- The prompt and the previous reply are redacted before they are written to the job file or sent to
  Haiku, as the privacy notes promise for everything sent.
- Pending files are cleared by name, not by scanning the folder on every prompt; leftovers older than a
  day are swept when a chat ends. Tokens read back from disk must be UUIDs, and a damaged job file is
  ignored.
- `bench:inject` counted a failed Haiku call as "no pick". It now reports picked, passed and failed
  separately.
- `npm run lint` also checks files git does not track yet, so new files are linted before commit (F-40).

### 7.11 Result

Same 300 prompts, one frozen copy, old and new run side by side:

| Method                    | Prompts with memory | Useful, blind judge | Useful, judge sees only shown |
| ------------------------- | ------------------- | ------------------- | ----------------------------- |
| Before: top 3, 2 words    | 56%                 | 23%                 | 25% to 26%                    |
| After: word filter, Haiku | 30%                 | 70%                 | 61% to 63%                    |

The blind judge labels all ten candidates without knowing which were shown (kappa 0.75 on the picked
ones); `bench:inject` now uses it. The judge that sees only the shown memories agrees with itself less
(kappa 0.66 here, 0.47 in another run), so it is not used for decisions.

The final end-to-end run of the shipped code, with Haiku picking again and the blind judge scoring it
twice, gave 30% of prompts with memory and 61% to 65% useful, at kappa 0.78. The old rule scored 50%
to 56% of prompts in different replays of the same data; that gap was not investigated further.

**Why 8 in 10 is not reached:** the judge agrees with itself on 90% of picked memories, so a score far
above 80% cannot be told apart from noise. The rest of the gap is Haiku: 61% to 70% of its picks are
memories the judge also calls useful.

---

## 8. Findings log

Things found while working on the plan that were not fixed in the step where they showed up. Each
names the plan phase it belongs to, the evidence, and the fix. All were recorded on 2026-10-06.

**Read every "useful" figure from before the judge was rebuilt as unreliable.** Until then the judge
graded 20 mixed items per call and answered by position; its two passes agreed at kappa 0.14, close to
chance (F-8). Prompt counts, row counts and token sizes were not affected. F-1, F-2 and F-7 carry the
re-measured numbers.

### Index

| ID   | Phase   | Finding                                                           | Status                         |
| ---- | ------- | ----------------------------------------------------------------- | ------------------------------ |
| F-1  | 1       | Prompts with memory is 41%, goal is under 40%                     | Fixed by the pick (now 30%)    |
| F-2  | 2       | Recalled memory is useful about a quarter of the time             | Fixed; goal close, not reached |
| F-3  | 1       | Weighting rare words does not help                                | Rejected, recorded             |
| F-4  | 2a      | Subagent reports saved as if the user asked them                  | Fixed                          |
| F-5  | 2a      | Image paths saved into memory text                                | Fixed                          |
| F-6  | 2a      | AI summaries never ran for VS Code users                          | Fixed                          |
| F-7  | 6       | The real embedding model does not help recall                     | Superseded                     |
| F-8  | 0       | The judge is noisy                                                | Fixed                          |
| F-9  | 0       | Claude Code writes the same message into a chat file twice        | No bug, recorded               |
| F-10 | General | `fatal: not a git repository` leaked to stderr                    | Fixed                          |
| F-11 | 6       | IDE context tags not stripped from prompts                        | Fixed                          |
| F-12 | Release | README token numbers out of date                                  | Fixed                          |
| F-13 | 2a      | Hidden messages split a turn and lost the user's words            | Fixed                          |
| F-14 | 2a      | Every headless Claude call waited 3 seconds for input             | Fixed                          |
| F-15 | 0       | Headless calls were saved as chats                                | Fixed                          |
| F-16 | 2a      | Could an AI summary capture itself?                               | Checked; hardened              |
| F-17 | Release | The plan files would have shipped to npm users                    | Fixed                          |
| F-18 | 2a      | Older CLIs that do not know a flag                                | Fixed                          |
| F-19 | Upgrade | Old memory saved before these fixes                               | Fixed                          |
| F-20 | General | `stats` counted replaced rows                                     | Fixed                          |
| F-21 | General | `sync` never carried a status change                              | Fixed                          |
| F-22 | General | `sync` never updated a chat summary the other side had            | Fixed                          |
| F-23 | Upgrade | Import chats from before recording started?                       | Decided: no                    |
| F-24 | Release | The "why is it like this" benchmark cannot be re-run here         | Open, low                      |
| F-25 | Upgrade | A failed repair kept its lock; two scripts wrote to the real home | Fixed                          |
| F-26 | Release | The privacy notes were not true any more                          | Fixed                          |
| F-27 | 2       | Haiku filed personal details as facts about the user              | Fixed                          |
| F-28 | 2       | A long chat was mostly unseen                                     | Fixed                          |
| F-29 | 2       | A to-do fact would have been closed at once                       | Caught before shipping         |
| F-30 | 2       | Turning a chat into facts takes about 26 seconds a call           | Open, low                      |
| F-31 | Release | Secrets written as `NAME=value` were not redacted                 | Fixed, saved memory included   |
| F-32 | Release | The Node minimum was wrong: 22.16, not 22.5                       | Fixed                          |
| F-33 | General | `claude-db view` crashed when loading failed                      | Fixed                          |
| F-34 | Release | Compiled output of a deleted source kept shipping                 | Fixed                          |
| F-35 | General | Two store tests passed without testing anything                   | Fixed                          |
| F-36 | Release | `npm audit` reported 5 advisories, one critical                   | Fixed                          |
| F-37 | General | `install --project` was quiet when there was no `.gitignore`      | Fixed                          |
| F-38 | Release | The driver install command was wrong for a global install         | Fixed                          |
| F-39 | Release | The install page named wrong hooks and a wrong skill path         | Fixed                          |
| F-40 | General | `npm run lint` skipped files git did not track yet                | Fixed                          |

### F-1 · Phase 1 · Prompts with memory is 41%, goal is under 40%

**Status:** Fixed. The pick brought it to 30%.

**What:** One point short of the Phase 1 goal.

**Evidence:** The rules side by side, on the final Phase 1 code, the same 100 prompts, two judge passes
each. The "useful" column is void (F-8); the others are not.

| Rule                              | Prompts with memory | Rows | Useful     |
| --------------------------------- | ------------------- | ---- | ---------- |
| 1 shared word (old default)       | 59%                 | 106  | 42% to 43% |
| 2 shared words (shipped)          | 41%                 | 66   | 39% to 41% |
| 3 shared words                    | 28%                 | 43   | 33% to 40% |
| 2 shared words, in the title only | 15%                 | 16   | 50% to 56% |

100 prompts is too few to separate rules a few points apart. On the last 300 prompts, also judged
twice (also void), the picture looked clearer:

| Memories that share... | Rows | Useful     |
| ---------------------- | ---- | ---------- |
| exactly 1 word         | 166  | 28% to 34% |
| 2 or more words        | 190  | 38% to 43% |
| 3 or more words        | 80   | 29% to 39% |

At the time this said 2 words is the floor that pays. With the reliable judge, two shared words is
kept as the filter before Haiku because it matched a local model as a filter (73% against 74%), not
because of these tables.

**Why it waited:** A stricter rule would hit 40% only by dropping useful memories along with the rest.
The cause of the remaining noise was F-2.

**For Phase 2:** Matching on the title alone was the most precise rule (50% to 56%), but on only 16
rows, because titles rarely name the topic. The later measurements show titles carry almost no signal
(AUC 0.56).

**Update after the F-19 repair:** On the repaired copy of the same database, 51% of the last 300
prompts got memory. The repair recovered 109 requests whose words had been lost, so there is more to
match. The goal is a proxy; usefulness (F-2) is the measure that matters.

**Final:** The versions that got under 40% (D, E, F in appendix A) did it by matching titles only, and
none of them was more useful. With Haiku picking, 30% of the same 300 prompts get memory.

### F-2 · Phase 2 · Recalled memory above a prompt is useful about a quarter of the time

**Status:** Fixed in the picking step; the 8-in-10 goal is close but not reached.

Root causes, the fix, every measurement, what was tried and not kept, and the result are in
[section 7](#7-the-per-prompt-pick). In short: the judge was broken, the right memory usually existed
(58% of prompts had one in their top 10), and picking it was close to chance. A word filter plus Haiku,
quoting a checked sentence, took useful memory from 23% to 61% to 70% on 30% of prompts.

### F-3 · Phase 1 · Weighting rare words does not help

**What:** Idea tested and rejected. Recorded so it is not tried again.

**Evidence:** Rows that share a rare word (in 3% to 10% of memories) were not more useful than rows that
do not: 35% to 48% useful against 41% to 50%. Rare words are often coincidences, like "table" matching
"Table of contents" for a database table prompt. This was measured with the first judge, so it was not repeated
with the reliable one.

### F-4 · Phase 2a · Subagent reports and task notifications are saved as if the user asked them

**Status:** Fixed.

**What was wrong:** Capture stored a subagent hand-back as a turn (`Asked: Another Claude session sent a
message...`), and the same for `<task-notification>` messages. The work that followed was filed under
them instead of under the user's request.

**Fix:** `groupIntoTurns` in [transcript.ts](../src/capture/transcript.ts) no longer starts a turn at an
`isMeta` entry or one with `origin.kind` `task-notification`. Older transcripts without those fields are
caught by their text (`isRelayedMessage` in [prompt.ts](../src/util/prompt.ts)).

### F-5 · Phase 2a · Image paths are saved into memory text

**Status:** Fixed, old rows included (see F-19).

**What was wrong:** Stored text kept markers like `[Image: source: /tmp/claude-1000/.../3.png]`. Their
path words made image prompts match each other and nothing else.

**Fix:** The saved `Asked:` line goes through `readablePrompt` in [prompt.ts](../src/util/prompt.ts):
image markers are removed and a slash command reads as `/name args`. The observation id still comes from
the raw prompt, so re-ingesting a chat updates its rows instead of duplicating them.

### F-6 · Phase 2a · AI summaries never ran for VS Code users

**Status:** Fixed.

**What was wrong:** `aiSummary` ran `claude` from `PATH`, and the VS Code extension does not put `claude`
on `PATH`. So `capture.summarize: on` silently did nothing there.

**Evidence:** A probe hook under `claude -p`, with the variable removed from the parent, showed that
`claude` itself does not set `CLAUDE_CODE_EXECPATH`. The VS Code extension sets it, and every process
under that Claude Code session, hooks included, inherits it. In a terminal, `claude` is on `PATH`
instead.

**Fix:** All headless calls go through `runHeadless` in [claude-cli.ts](../src/util/claude-cli.ts),
which uses `CLAUDE_CODE_EXECPATH` first and `claude` on `PATH` second. Fact-making and picking use the
same call.

### F-7 · Phase 6 · The real embedding model does not help recall here

**Status:** Superseded. The original evidence came from the broken judge (F-8) and is void.

The model was not re-measured as an embedder. Re-ranking models from the same family were measured with
the reliable judge: ms-marco MiniLM reached AUC 0.76 and a tiny Jina model 0.73. They were not needed: as
the filter before Haiku, the word filter did as well (73% against 74%) without a 200 MB install. The
existing optional hint in `install` and `doctor` is left as it was. The original, void measurement is in
appendix A.

### F-8 · Phase 0 · The judge is noisy

**Status:** Fixed at the root.

**What was wrong:** the judge graded 20 items from different prompts in one call and answered with a
list of true and false by position. One slip shifted every answer after it. Its two passes agreed at
kappa 0.14, close to chance. Some "useful" labels were absurd, like a prompt about table columns matched
with a note about the table of contents.

**Fix:** `bench:inject --judge` grades one prompt per call, sees the end of the previous reply, labels
every candidate by id without knowing which were shown, and runs Sonnet twice. It prints the two passes
and their kappa, and says when the agreement is too low to trust. On 2,521 pairs the passes agree at
kappa 0.80. Comparisons still use one frozen copy of the chats: two runs 90 minutes apart replayed
different prompts while the maintainer kept working, and gave a misleading "before" of 30% to 32%.

### F-9 · Phase 0 · Claude Code writes the same message into a chat file more than once

**What:** 222 of 1,301 turns in the replayed chats were exact repeats, with the same uuid.

**Impact:** Capture is unaffected, since a repeat gets the same observation id. `INSERT OR REPLACE` marks a
repeated turn `open` again, but the same flush closes it again when its files are committed. The bench
now skips repeats.

**Why it waits:** No bug to fix. Recorded so the duplicate counts are not misread later.

### F-10 · General · `fatal: not a git repository` leaked to stderr

**Status:** Fixed. `closeLandedWork` in [progress.ts](../src/capture/progress.ts) now ignores git's
stderr. Before the fix, git's error appeared in the hook output outside a git repo.

### F-11 · Phase 6 · IDE context tags are not stripped from prompts

**Status:** Fixed. Any `<ide_...>...</ide_...>` block is removed by its own closing tag before a prompt
is searched or saved, so no assumption is made about what is inside. Only `<ide_opened_file>` was seen on
the measured machine, in 2 of 1,371 prompts.

### F-12 · Release · README token numbers were out of date

**Status:** Fixed.

**What was wrong:** The README, `docs/with-and-without.md`, the benchmarks page and the site's cost card
said recall costs about 180 tokens a prompt and is skipped on 28% of prompts. The 180 was a constant in
`bench-ab.mjs`, so no script could reproduce it, even before Phase 1.

**Fix:** `bench-ab` now prices recall by replaying real chats through the prompt hook (`--recall-from
<project>`, 300 prompts by default) and runs this build instead of the `claude-db` on `PATH`. Every number
was re-measured in one run, on a repaired copy of a real database with about 660 memories:

| Number                    | Was               | After Phase 1     | Final, with Haiku picking |
| ------------------------- | ----------------- | ----------------- | ------------------------- |
| Recall per prompt         | 180 tokens        | 22 tokens         | 20 tokens                 |
| Prompts with no recall    | 28%               | 49%               | 69%                       |
| Lookup vs grep and read   | 2.1x              | 2.1x              | 2.0x                      |
| Saved per lookup          | 597 (1,115 - 518) | 702 (1,341 - 639) | 685 (1,338 - 653)         |
| Prompts one lookup covers | 3.3               | 31.2              | 33.9                      |

The same replay priced whole sessions. Lookups to break even is the recall cost divided by what one
lookup saves (597 before, 685 now), so a session pays for itself after far fewer lookups:

| A session of | Recall cost, was | Recall cost, final | Lookups to break even, was | Lookups to break even, final |
| ------------ | ---------------- | ------------------ | -------------------------- | ---------------------------- |
| 1 prompt     | 180              | 20                 | 0.3                        | 0.0                          |
| 5 prompts    | 900              | 101                | 1.5                        | 0.1                          |
| 10 prompts   | 1,800            | 202                | 3.0                        | 0.3                          |
| 20 prompts   | 3,600            | 405                | 6.0                        | 0.6                          |
| 60 prompts   | 10,800           | 1,214              | 18.1                       | 1.8                          |

The "was" column is the assumed 180 tokens a prompt, which was never measured. The "final" column is
the measured replay. A 60-prompt session now spends 1,214 tokens on recall instead of 10,800, about a
ninth.

The README, `docs/with-and-without.md`, the benchmarks page and the site's cost card carry the final
column. The changelog's 0.10.0 entry covers everything in this work.

### F-13 · Phase 2a · Hidden messages split a turn and lost the user's words

**Status:** Fixed, old rows included (see F-19).

**What was wrong:** Claude Code stores a pasted image, and a skill's instructions ("Base directory for
this skill..."), as separate hidden user messages right after the typed one. Capture started a new turn
at each of them, so the work was filed under `Asked: [Image: source: ...]` and the typed request was
dropped.

**Evidence:** The typed message and its image share one `promptId`; the image entry has `isMeta: true`.
Run against the old version, a typed request plus image plus hand-back produced 3 turns with no trace of
the typed words. The new version produces 1 turn with both edits.

**Fix:** Same change as F-4: hidden messages never start a turn.

### F-14 · Phase 2a · Every headless Claude call waited 3 seconds for input

**Status:** Fixed.

**Evidence:** The CLI printed "no stdin data received in 3s". Measured: 8.5 seconds with stdin left open,
5.1 seconds with it closed.

**Fix:** `runHeadless` closes stdin as soon as the process starts.

### F-15 · Phase 0 · Headless calls were saved as chats

**Status:** Fixed.

**What was wrong:** Each `claude -p` call (the bench judge, and AI summaries) was saved as a chat file in
the project's transcript folder, where it shows up in `/resume`.

**Fix:** `runHeadless` passes `--no-session-persistence`. Claude Code still creates an empty project
folder, but writes no chat file.

**Cleanup done:** The judge runs while building Phase 1 had left 113 such files in `~/.claude/projects`.
They were moved aside, not deleted. Nothing else was touched, and none of their text reached the memory
database.

### F-16 · Phase 2a · Could an AI summary capture itself?

**Status:** Checked: it does not. Hardened anyway.

**Evidence:** Under `claude -p`, hooks see `CLAUDE_CODE_ENTRYPOINT=sdk-cli`, which `capturingDisabled`
already skips. That variable is not documented, so `runHeadless` also sets `CLAUDE_DB_CAPTURE=off` for
the child.

### F-17 · Release · The plan files would have shipped to npm users

**Status:** Fixed. `package.json` now lists named docs instead of the whole `docs` folder, so working
files like this one stay out of the package. `npm pack --dry-run` shows only `how-it-works.md`,
`with-and-without.md` and `setup-guide.md` from `docs`.

### F-18 · Phase 2a · Older CLIs that do not know a flag

**Status:** Fixed.

**What was wrong:** A `claude` binary too old to know `--no-session-persistence` (or `--effort`) would
reject the call, and AI summaries would quietly fall back to the plain summary.

**Fix:** `runHeadless` reads the CLI's `unknown option '<flag>'` error, which was checked against the real
binary, drops that optional flag and retries. Any other failure returns at once, with no retry loop.

### F-19 · Upgrade step · Old memory saved before these fixes

**Status:** Fixed.

**What was wrong:** 141 of the 551 rows in the measured database were saved under the bugs above: 133 as
`Asked: [Image ...]` with the typed words lost, 3 subagent reports, 3 task notifications, 1 skill body and
1 slash command wrapper.

**Fix:** The first session after updating starts `claude-db flush --repair` in the background, once per
project and machine, with a lock so two sessions cannot both run it. It re-saves every chat that already
has memory and still has a transcript. Rows of that chat that the current rules no longer produce, and
that are not newer than the transcript just read, are marked `replaced`. They stay stored and still
travel in export and sync, but leave search, the timeline, `view`, `stats` and the start-of-chat rules.

**Evidence:** On a copy of that database, through the real CLI: 140 rows replaced, 0 broken rows left
visible, 0 good rows replaced, 109 lost requests recovered, in about 5 seconds. The 141st row, a slash
command, was re-saved in place under its old id.

**Still as it was:** Chats Claude Code has already deleted (it keeps 30 days) cannot be re-read, so their
rows stay as they are.

### F-20 · General · `stats` counted replaced rows

**Status:** Fixed. `stats` counts current memory and prints replaced rows on a separate line.

### F-21 · General · `sync` never carried a status change

**Status:** Fixed.

**What was wrong:** `sync` copies rows the other side does not have, and nothing else. Work closed on one
machine stayed open on the other, and rows replaced by the repair stayed visible in a shared database.

**Fix:** Status only moves forward, open to done to replaced, so `sync` now brings each row on both sides
up to the furthest status either has. The dry run says how many it would move.

### F-22 · General · `sync` never updates a chat summary the other side already has

**Status:** Fixed.

**Fix:** Sessions now record `updated_at`, the time their summary was written or cleared, and
`distilled_at`, the time they were turned into facts (SQLite schema version 4, Postgres schema version 4,
new Mongo fields; all additive). `sync` keeps the newer summary, carries a deliberate clear across, and
marks a distilled chat on both sides. A chat without times on either side is left as it was, as before.

### F-23 · Upgrade step · Should the automatic repair import chats from before recording started?

**Status:** Decided by the maintainer on 2026-10-06 at 12:08: no.

The automatic run uses `flush --repair`, which only touches chats that already have memory. Plain
`claude-db flush` still imports every chat on disk when the user asks for it. On the measured machine,
6 chats predated recording, and one of them was not meant to become memory.

### F-24 · Release · The "why is it like this" benchmark cannot be re-run here

**Status:** Open, low.

**What:** Section B of `bench-ab` searches this repository's own memory, and the measuring machine has
none for it. `docs/with-and-without.md` only says the two sides come out "roughly level", with no
numbers, so nothing published is stale. Re-run it on a machine with this repo's history before the next
release.

### F-25 · Upgrade step · A failed repair kept its lock, and two scripts wrote to the real home

**Status:** Fixed.

**What was wrong:** If `flush --repair` failed early, for example on a database it could not open, it
never released its lock, so the repair waited 10 minutes before trying again. Separately, the `refresh`
unit test and `npm run try` ran the real start hook against the real `~/.claude-memory`: the test left 5
stale locks there, and `npm run try`, which promises to touch nothing, would have started a background
repair and was already leaving cursor files behind.

**Fix:** `flush` releases its lock on any failure. The `refresh` test and `npm run try` now run with a
throwaway home folder. After the full test suite and `npm run try`, the real `~/.claude-memory` is
unchanged.

**Known and harmless:** if a project folder is deleted within seconds of a session starting, the
background repair cannot even read its own folder, and its lock file stays behind as a few bytes of
litter. It never blocks anything, since that project no longer exists.

### F-26 · Release · The privacy notes were not true any more

**Status:** Fixed.

**What was wrong:** The README, the introduction and the privacy page said nothing leaves the machine,
and that a configured database is the only network traffic. The daily update check already contacted the
npm registry, and turning chats into facts now sends a chat's saved, redacted text to Claude Haiku.

**Fix:** All three now list every outside call and how to turn it off, including the pick.

### F-27 · Phase 2 · Haiku filed personal details as facts about the user

**Status:** Fixed.

**Evidence:** On the real database, Haiku put career and profile details from the maintainer's own work
under the "you" scope, which would have shown them in every project, although the prompt asked for "you"
only for how the user likes to work.

**Fix:** The rule is enforced in code, not left to the model: only a `rule` may be filed under the user.
Anything else stays in its project. Claude Code's "user" memory files are imported into their project for
the same reason, a deliberate change from the plan, which had sent them to the user scope.

### F-28 · Phase 2 · A long chat was mostly unseen

**Status:** Fixed.

**Evidence:** Three of the 15 chats run to 185k, 82k and 61k characters at 900 characters a turn. A
12,000-character cut showed Haiku the last ~13 turns of a 225-turn chat.

**Fix:** A chat is read in windows of about 40,000 characters, one call each, in order, each window seeing
the facts saved so far. The whole chat's calls are reserved up front, so a chat is never left half done; a
chat larger than six windows, or than the daily limit, keeps its most recent part.

### F-29 · Phase 2 · A to-do fact would have been closed at once

**Status:** Caught before shipping.

**What:** Storing a to-do as `open` would have let the existing "close landed work" step close it on the
next prompt, since a fact touches no uncommitted file. Facts are always stored `done`; a to-do is marked
by its type and retired only by Haiku.

### F-30 · Phase 2 · Turning a chat into facts takes about 26 seconds a call

**Status:** Open, low.

**What:** On the real database the backfill averaged about 26 seconds per Haiku call. It runs in a
detached process after the chat, so nothing waits on it, but a long chat of several windows takes a few
minutes to land.

### F-31 · Release · Secrets written as `NAME=value` were not redacted

**Status:** Fixed, including memory saved earlier.

**What was wrong:** Redaction caught a secret after a name like `token` or `password` only when the value
was in quotes. `GITHUB_TOKEN=...`, `DATABASE_PASSWORD=...` and `token = ...` were stored as typed. The F-2
replay showed one: a token pasted into a prompt, then shown in a picked line, because picked lines quote
the earlier question.

**Fix:** Redaction moved to its own module (`src/capture/redact.ts`) and also replaces an unquoted value
after a secret-like name, when the value has a letter and is 8 or more characters, so `MAX_TOKENS=4096`
and "the token is saved" are left alone. The same redaction runs on memory text sent to Haiku and on every
line shown with a prompt.

**Memory saved earlier:** the first session after updating starts a one-time background clean-up
(`src/capture/scrub.ts`) that re-applies redaction to every saved row and chat summary, rebuilds the
vectors of rows it changes, and marks cleaned summaries newer so `sync` carries them. It runs once per
database and again whenever `REDACT_VERSION` is raised. `claude-db redact` runs it on demand. On the
maintainer's database it changed exactly 1 of 551 rows, the pasted token, and nothing else.

**Not covered:** a secret pasted into a chat also stays in Claude Code's own chat file, which claude-db
does not edit. A real secret should be rotated.

### F-32 · Release · The Node minimum was wrong: 22.16, not 22.5

**Status:** Fixed.

**What was wrong:** claude-db said "Node 22.5 or newer", and its install check let 22.5 through. The
default database needs more than that.

**Evidence,** by running real Node binaries:

| Node                         | `node:sqlite`                                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| 22.5.1 and 22.12.0           | Does not exist without a flag (`ERR_UNKNOWN_BUILTIN_MODULE`); loads with `--experimental-sqlite` on 22.12 |
| 22.13.0                      | Loads                                                                                                     |
| 22.13.1, 22.14.0 and 22.15.0 | Opens, but `no such module: fts5`: the full-text search table cannot be created                           |
| 22.16.0 and 22.17.0          | Works                                                                                                     |

The whole suite was then run on real Node 22.16.0: all 778 checks pass.

**Fix:** `engines`, the install check, the README, the site, CONTRIBUTING and the CI matrix now say 22.16.
CI tests 22.16 itself as well as 22.x and 24.x, so the minimum cannot silently break again. `.nvmrc` pins
the major version. `SqliteStore.init` turns `no such module: fts5` into a plain message that names 22.16.
Users and contributors now need the same Node, since the developer tools need 22.13 or later.

### F-33 · General · `claude-db view` crashed when loading failed

**Status:** Fixed.

**What was wrong:** The request handler sent the success header before it had loaded the data, so a
failure tried to send a second header and the unhandled rejection stopped the viewer. Found by ESLint's
`no-misused-promises`.

**Fix:** The response is built first, then written once.

### F-34 · Release · Compiled output of a deleted source kept shipping

**Status:** Fixed.

**What was wrong:** The build never cleared `dist/`, so a file removed from `src/` stayed in the package.
`dist/facts/recall.js` was still there after `recall.ts` was replaced by `render.ts`. Found by comparing
`dist` with `src`.

**Fix:** The build now runs `scripts/prune-dist.mjs`, which removes compiled files whose source is gone.

### F-35 · General · Two store tests passed without testing anything

**Status:** Fixed.

**What was wrong:** `createStore` was never imported in the scheme-routing test, so its checks caught
their own `ReferenceError` and passed. Found by ESLint's `no-undef`.

**Fix:** It is imported, and the unknown-scheme check now requires the real error message.

### F-36 · Release · `npm audit` reported 5 advisories, one critical

**Status:** Fixed.

**What was wrong:** The lockfile held five advisories (1 critical, 1 high, 3 moderate) in packages the
MCP SDK depends on: `proxy-addr`, `fast-uri`, `hono`, `ip-address` and `qs`. They were there before this
work.

**Fix:** `npm audit fix` updated them within their existing ranges: 0 vulnerabilities. The lockfile is
not published, so users already install the newest in-range versions; the fix keeps development, CI and
`npm ci` clean.

### F-37 · General · `install --project` was quiet when there was no `.gitignore`

**Status:** Fixed.

**What was wrong:** The warning that `.mcp.json` should not be committed was skipped when the project had
no `.gitignore` file, which is exactly when nothing keeps it out of a commit. Found by the new CLI test.

**Fix:** A missing `.gitignore` now counts as "not ignored" and the warning is shown.

### F-38 · Release · The driver install command was wrong for a global install

**Status:** Fixed.

**What was wrong:** The error message and four docs said `npm install pg` or `npm install mongodb`. A
globally installed claude-db looks for a driver next to itself, so a local install does not help.

**Evidence:** A packed copy of claude-db installed into a throwaway prefix: before installing the driver,
`claude-db use postgres://...` said "Postgres driver not installed"; after `npm install -g pg` it reached
the database (and failed only on the closed port).

**Fix:** The messages, the README, the databases page and the troubleshooting page say
`npm install -g pg` and `npm install -g mongodb`.

### F-39 · Release · The install page named wrong hooks and a wrong skill path

**Status:** Fixed.

**What was wrong:** The install page said the hooks were SessionStart, UserPromptSubmit and Stop. They
are SessionStart, UserPromptSubmit, SessionEnd and PreToolUse. It also put the `/cdb-scan` skill in
`~/.claude/skills`, where a project install writes it under `.claude/skills` in the project. The README
quoted 415 checks.

**Fix:** The page and the README now match what install writes.

### F-40 · General · `npm run lint` skipped files git did not track yet

**Status:** Fixed.

**What was wrong:** The house-rules lint listed files through `git ls-files`, so a new file was not
checked until it was staged.

**Fix:** It also lists untracked files that are not ignored. `npm run lint` now runs the house rules and
then ESLint.

---

## 9. Engineering and release hygiene

All on 2026-10-06, from 15:45.

### Tests

| Point in the work             | Checks | Lines covered |
| ----------------------------- | ------ | ------------- |
| After Phase 3                 | 651    | not measured  |
| After the pick                | 715    | 65%           |
| With the CLI and redact tests | 778    | 77%           |

Final coverage: 76.7% of statements and lines, 82.0% of branches, 74.1% of functions.

New end-to-end tests, each running the real thing in a temporary home:

- the six MCP tools through the real server, including an unknown id;
- the end-of-chat hook, including cleanup of a waiting pick;
- the CLI: install, status, doctor, uninstall, remember, search, forget, export, import, reset, prune,
  stats, projects, flush, view, pick and use;
- the pick from prompt to delivery, with a fake `claude`;
- fact-making and the start block;
- the redaction clean-up, including the background trigger.

The suite was also run on real Node 22.16.0: all 778 checks pass.

### Tooling

| Tool                            | What it checks                                        | Command                 |
| ------------------------------- | ----------------------------------------------------- | ----------------------- |
| ESLint 10, type-aware for `src` | Real bugs: missing `await`, unsafe types, dead code   | `npm run lint`          |
| House rules                     | No comments, no `any`, import extensions, file length | `npm run lint`          |
| knip                            | Unused files, exports and dependencies                | `npm run knip`          |
| c8                              | How much of the code the tests run                    | `npm run coverage`      |
| publint and arethetypeswrong    | The packed tarball and its types                      | `npm run check:package` |
| CodeQL                          | Security scan on every pull request and weekly        | GitHub workflow         |

Configuration: `eslint.config.js`, `knip.json`, `.c8rc.json`, `.nvmrc`, and
`.github/workflows/codeql.yml`. The build also prunes stale output (F-34).

CI now runs formatting, lint, the package check, knip and coverage in one job; the test suite on Linux
and macOS across Node 22.16, 22.x and 24.x; the Postgres and MongoDB smoke tests; and CodeQL.

What the lint pass found: about a hundred unused imports (left behind when the store was split into
modules), JSON read as `any`, rethrown errors that lost their cause, and the real bugs in F-33, F-34 and
F-35. One ESLint autofix would have broken the optional drivers (`pg`, `mongodb`, the embedding model),
which are loaded by name at run time; the type check caught it and they are now typed explicitly.

### Not yet proven

The new CI jobs, CodeQL and the Node 22.16 job have not run on GitHub; they run for the first time on
the first push. The new background picker and hooks have not been tried on Windows.

---

## 10. Open items

| Item                                                         | Why it is open                                                                                  | Next step                                                                              |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 8 in 10 shown memories useful                                | 61% to 70% reached. The judge agrees with itself on about 9 in 10 picks, so the ceiling is near | Improve what Haiku sees, or accept the ceiling; re-measure with `bench:inject --judge` |
| F-24: the "why is it like this" benchmark                    | Needs a machine with this repository's own history                                              | Re-run `bench-ab` there before the next release                                        |
| F-30: fact-making takes about 26 s a call                    | Runs in the background, so nothing waits, but long chats take minutes to land                   | Measure again; consider fewer, larger windows                                          |
| Phase 4: memory for each file                                | Not started. A shared file is weak evidence on its own (AUC 0.51)                               | Decide whether it is worth a hook                                                      |
| Phase 5: git-link keys, `/catchup`, `/handoff`               | Not started. Until then projects match by folder path                                           | Build the project map and the two skills                                               |
| Phase 6: smarter search                                      | Not built as planned; the measurements point elsewhere                                          | Revisit only if picking quality needs it                                               |
| Upgrade: backup, `upgrade --undo`, previous-version CI check | Designed in section 6, not built                                                                | Build if a destructive upgrade step is ever added; none is today                       |
| Windows                                                      | The picker and the new hooks were not tried there                                               | Run the suite and a real session on Windows                                            |
| The first GitHub run of the new CI and CodeQL                | They only prove themselves once pushed                                                          | Push on a branch and read the results                                                  |
| A secret pasted into a chat                                  | Stays in Claude Code's own chat file, which claude-db does not edit                             | Say so in the docs (done); rotate the secret                                           |

---

## 11. How the numbers were measured

**The data.** One real project: 21 chats, 551 memories (about 660 after the repair
recovered lost requests), replayed in time order. One person's chats, on one project, so the numbers show
how the method behaves, not how every project will. The replay for the F-2 work used the last 300
prompts, from 14 chats.

**Which prompts.** Unless stated otherwise, the Phase 1 and F-1 numbers come from the last 100 prompts
of 3 chats, and everything from the F-2 work onwards from the last 300 prompts of 14 chats.

**A frozen copy.** Comparisons run on one frozen copy of the chats and database. Two runs 90 minutes
apart replayed different prompts while the work went on, and gave a misleading "before" (F-8).

**The replay.** `scripts/bench-inject.mjs` feeds each past prompt to the real prompt pipeline, in time
order, with only the memory that existed at that moment, and records what would have been shown. With
Haiku picking, picks run in the bench process instead of the background.

**The judge.** Claude Sonnet, one prompt per call. It sees the end of the previous reply, the prompt and
the candidate memories, labels each one useful or not by id, and does not know which were shown. It runs
twice and the bench prints the agreement as kappa (agreement beyond chance). Of 2,531 labelled pairs,
2,521 were judged twice and the passes agreed at kappa 0.80 (95% raw agreement, 15% of pairs useful); on
the picked memories alone, kappa 0.75 (90% raw agreement). The earlier judge scored kappa 0.14.

**Commands.**

```bash
npm run bench:inject -- <project> --last 300 --judge
npm run bench:inject -- <project> --last 300 --judge --no-pick
npm run bench:inject -- <project> --last 300 --show 5
npm run bench:ab -- --recall-from <project> --last 300
npm run bench:tokens
```

`--no-pick` replays without Haiku, `--judge-model` chooses the judge, `--show` prints sample blocks, and
`bench:ab` prices recall and lookups in tokens.

**Limits.** The judge is a model, and a score near 80% cannot be told apart from noise at this agreement.
Haiku's picks vary a little from run to run, which is part of the 61% to 70% range. A single maintainer's
project is not a benchmark suite.

### Appendix A: earlier measurements, usefulness void

These came from the first judge (F-8). The "useful" column is void; prompt and row counts are not.

| Version                              | Prompts with memory | Rows | Useful     |
| ------------------------------------ | ------------------- | ---- | ---------- |
| A: earlier chats only (then shipped) | 51%                 | 252  | 23% to 27% |
| B: facts first                       | 57%                 | 266  | 18% to 20% |
| C: facts first, real embedding model | 60%                 | 286  | 13% to 15% |
| D: facts first, title-only matching  | 21%                 | 87   | 14% to 21% |
| E: earlier chats only, title-only    | 12%                 | 44   | 8% to 50%  |
| F: facts only, title-only            | 12%                 | 52   | 13% to 28% |

E and F were too small for their two judge passes to agree. The conclusion drawn then, that facts above
a prompt make recall worse and that the embedding model does not help, was wrong because of the judge.
With the reliable judge, facts offered to Haiku were right 60% of the time against 69% for chat rows,
which is why facts stay at the start of a chat.

---

## 12. Code map

New files, by area. Files that already existed and changed (for example `transcript.ts`,
`turn-extractor.ts`, `install.ts`, `sync.ts` and the three store adapters) are not listed.

| Area                | File                                  | What it does                                                              |
| ------------------- | ------------------------------------- | ------------------------------------------------------------------------- |
| `src/pick/`         | `prompt.ts`                           | Builds the picking prompt, then parses and checks Haiku's answer          |
|                     | `pending.ts`                          | Per-chat state: tokens, jobs and ready blocks                             |
|                     | `run.ts`                              | One pick end to end, with the daily limit                                 |
|                     | `worker.ts`                           | The detached background process                                           |
| `src/hooks/`        | `pick-deliver.ts`                     | The PreToolUse hook that hands Claude a ready pick                        |
|                     | `prompt-recall.ts`                    | Finds candidates, applies the word filter, and the strict fallback        |
|                     | `compact.ts`                          | Puts a chat's own decisions back after `/compact`                         |
|                     | `background.ts`                       | Starts the detached one-time and background jobs                          |
|                     | `start-legacy.ts`                     | The older start block, used when no facts exist yet                       |
| `src/facts/`        | `model.ts`                            | Fact types, scopes, ids and tags                                          |
|                     | `ops.ts`                              | The fact-making prompt, and the parsing and limits of the answer          |
|                     | `distill.ts`                          | Turns a chat into facts, and the backfill of older chats                  |
|                     | `claude-memory.ts`                    | Imports Claude Code's own memory files                                    |
|                     | `start.ts`, `render.ts`               | The start-of-chat block and the fact lines                                |
|                     | `budget.ts`, `notice.ts`              | The daily limit for facts, and the one-time notice                        |
| `src/capture/`      | `reingest.ts`                         | The one-time repair of memory saved by older versions                     |
|                     | `redact.ts`, `scrub.ts`               | The redaction rules, and the one-time clean-up of saved memory            |
| `src/store/`        | `each.ts`, `session-time.ts`          | Walk every row in pages; chat summary timestamps                          |
| `src/util/`         | `claude-cli.ts`                       | The headless `claude -p` runner                                           |
|                     | `daily-budget.ts`, `job-lock.ts`      | A generic daily counter and pause; locks and done marks for one-time jobs |
|                     | `day.ts`                              | Day formatting for memory lines                                           |
| `src/config/`       | `dir.ts`                              | `CONFIG_DIR` alone, so light hooks stay fast                              |
| `src/cli/commands/` | `pick.ts`, `distill.ts`               | The `pick` and `distill` commands                                         |
| `scripts/`          | `bench-inject.mjs`, `lib/replay.mjs`  | The replay bench and its judge                                            |
|                     | `lib/isolated.mjs`, `unit/isolated/*` | Run a test in a throwaway home; the end-to-end tests                      |
|                     | `prune-dist.mjs`                      | Removes compiled files whose source is gone                               |
| Configuration       | `eslint.config.js`, `knip.json`       | ESLint and knip                                                           |
|                     | `.c8rc.json`, `.nvmrc`                | Coverage; the Node major version                                          |
|                     | `.github/workflows/codeql.yml`        | The CodeQL scan                                                           |

New commands and settings:

| Addition                      | What it does                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------- |
| `claude-db pick [on\|off]`    | Turn Haiku picking on or off; with no argument, today's count                 |
| `claude-db distill [on\|off]` | Turn fact-making on or off; with no argument, what it has done                |
| `claude-db redact`            | Re-apply secret redaction to memory already saved                             |
| `claude-db flush --repair`    | Re-save only chats that already have memory, marking the broken rows          |
| `pick.*` in the config        | `enabled`, `model` and `dailyLimit` (default 150)                             |
| `distill.*` in the config     | `enabled`, `model`, `dailyLimit` (default 30) and `backfillDays` (default 90) |
| `inject.promptResults`        | Default 2: the most memories shown with one prompt                            |
