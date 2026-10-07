# Next improvements

What to build next, why, and how to know each one is done. Each item carries a status line. An item is
marked done only after its checks ran and passed.

The list comes from the 0.10.2 and 0.10.3 releases. A real project showed that the Haiku features
(facts and picks) had been failing for days with no sign of it, and it showed a few small gaps around that.

## Contents

- [1. Say when the Haiku features cannot run](#1-say-when-the-haiku-features-cannot-run)
- [2. Show progress while `distill --backfill` runs](#2-show-progress-while-distill---backfill-runs)
- [3. Test the parent-process lookup on macOS](#3-test-the-parent-process-lookup-on-macos)
- [4. Add `claude-db --version`](#4-add-claude-db---version)
- [5. Picks usefulness above 70%](#5-picks-usefulness-above-70)
- [6. `/catchup` and `/handoff` skills](#6-catchup-and-handoff-skills)
- [7. Match projects by git link](#7-match-projects-by-git-link)
- [Order](#order)

---

## 1. Say when the Haiku features cannot run

**Status: done, verified 2026-10-07.** Not released yet.

**Problem.** Facts and picks call Claude through its binary. Claude Code does not hand that path to its
hooks, so where `claude` is not on `PATH`, every call failed with `claude was not found`. The only symptom
was "0 facts" with chats waiting. `claude-db doctor` printed `wiring: ok` the whole time. 0.10.3 fixes the
cause on Linux and macOS, but the same silence would hide the next cause, whatever it is.

**Plan.**

- One function finds the Claude binary and says how it was found: the `CLAUDE_CODE_EXECPATH` variable, the
  saved path, a parent process, or `PATH`. The hooks, the background jobs and `doctor` all call it, so they
  cannot disagree.
- `doctor` prints a `claude` line with the path and where it came from. When nothing is found it says so and
  gives one next step, for example "put `claude` on `PATH`".
- `doctor --deep` can make one small Haiku call and report the result. It stays opt-in, because it uses one
  of the day's calls.
- `status` warns when chats have been waiting for facts for a long time and none were made. A pause with its
  reason is already shown; this covers the case where nothing was even tried.

**Done when.**

- On a machine with no `claude`, `doctor` says it was not found and how to fix it.
- A test runs `doctor` with an empty `PATH` and no saved path, and checks the line and the exit code.
- A test for `status` covers waiting chats with no facts, past the limit and under it.
- The hooks and `doctor` are checked to resolve the same binary for the same environment.

**Decided.** "A long time" is one day. `status` warns when a waiting chat is more than a day old, no call was
tried today, and no pause is active.

**What was verified.**

- `doctor` prints `claude   : <path> (from <source>)`. With no `claude` it prints `NOT FOUND`, the fix, and
  exits 1 when facts or picks are on. Tested with an empty `PATH` and no saved path.
- `doctor --deep` makes one Haiku call, not counted against the daily limits, and reports it. Tested for
  success, a failed call and no binary.
- `status` shows the warning for a chat past a day, and not for one under a day, a day with a call tried, or
  a pause. Tested on the pure rule and on a real `status` run.
- `claudeBinary` and `resolveClaude` share one lookup, so the hooks and `doctor` agree for the same
  environment. Tested.
- A real `doctor --deep` on this machine, with the real `claude` and a temporary database: the store check
  passed and the Haiku call printed `ok   call - ok`. The whole run took about 6 seconds.
- Full `npm test`, `npm run lint`, `typecheck` and `knip` pass. On this machine `doctor` shows the path and
  `CLAUDE_CODE_EXECPATH` as the source.

**Found while testing, not fixed.** When `claude` is not logged in, it prints `Not logged in · Please run
/login` to standard output, not standard error, and exits 1. The failure reason is read from standard error
only, so `doctor --deep` shows just `exited with code 1` with no cause. Facts and picks use the same code, so
their recorded reason has the same gap. A small fix is to fall back to the first line of standard output when
standard error is empty. It touches shared code, so it is left for a decision.

**What was not tested.**

- A by-hand run of `doctor` with no `claude` anywhere. The test does it, but a manual run from inside
  Claude Code always finds Claude above it as the parent process.
- A real failure from `doctor --deep` other than not being logged in. A wrong model name or a network
  failure was not seen. The tests use a fake `claude` script for failures.
- Windows. The `PATH` search looks for `claude.exe` and `claude.cmd`, and the parent lookup is skipped there.
  Neither ran on Windows.
- macOS. The parent lookup there uses `ps` and is still covered only by item 3.
- The `status` warning with a real Postgres or MongoDB database. It ran on SQLite only.
- The one-day limit on real use. It is a first guess and may warn too often for someone who rarely opens
  Claude Code.
- A `claude` that is on `PATH` but not runnable. `doctor` reports it as found and only `--deep` shows the
  failure.

---

## 2. Show progress while `distill --backfill` runs

**Status: done, verified 2026-10-07.** Not released yet.

**Problem.** The command prints nothing until every waiting chat is done. Each Haiku call can take up to two
minutes and a chat can need several calls, so a backfill of a handful of chats runs for minutes with a blank
screen. It looks stuck, and a user may stop it.

**Plan.**

- Print one line when a chat starts and one when it finishes, for example `3 of 6 chats, 2 facts made`.
- Say up front how many chats are waiting and that it can take a few minutes.
- Show a spinner or a repeating dot only on a terminal. Output that goes to a file or a pipe stays plain, one
  line per chat.
- A stop because of the daily limit or a failure prints its reason as the last line. (Today the command
  prints nothing at all, so this is new, not kept.)

**Done when.**

- A test with a fake runner checks the lines for a run that finishes, one that fails and one that hits the
  daily limit.
- Output sent to a pipe has no spinner characters.

**Decided.** A terminal shows a spinner line while a chat runs, and that line is replaced by the finished line.
A pipe or file gets only the header, one finished line per chat, and the last line. It gets no start line,
because the plan asked for "one line per chat" there. The facts count in each line is the running total.

**What was verified.**

- A fake runner checks the lines for a run that finishes, one that fails, one that hits the daily limit,
  and one with nothing waiting.
- Output for a pipe has no spinner characters, no carriage return and no escape codes, and starts no timer.
  Output for a terminal stops every timer it starts.
- The real `claude-db distill --backfill` ran against a temporary database, with a fake `claude`, into a
  pipe and in a real pseudo-terminal. The pipe output was plain. The terminal showed the spinner for each
  chat, kept only the finished lines, and exited with code 0.
- In the real command, a failing `claude` ended with `stopped  : a Haiku call failed (...)` and the chats
  left. A second run straight after ended with `stopped  : paused until ...`. A daily limit of 1 with three
  chats ended with `stopped  : the daily limit of 1 calls is used up, 2 chat(s) still waiting`.
- One waiting chat prints `1 chat(s) waiting` and `1 of 1 chats, 1 fact made`.
- A real Haiku call: two chats on a real `claude` took 13.7 seconds and wrote two real facts.
- The hook path: `session-start` ran five times in a fresh home. On the third run the detached
  `distill --backfill` turned both waiting chats into facts, and the hook's own output was normal.
- The VS Code terminal panel, run by the user on 2026-10-07. A screenshot taken mid-run shows the spinner
  line `chat 1 of 4` under the header, and the user saw it animate. A screenshot taken after the run shows
  the header, one finished line per chat and the `done` line, with no leftover spinner characters or stray
  text.
- Full `npm test`, `npm run lint`, `typecheck` and `knip` pass.

**What was not tested.**

- Terminals other than the Linux pseudo-terminal and the VS Code panel: macOS Terminal and Windows Terminal.
  The spinner uses Braille characters and `\r` with an erase-line code, which some fonts or consoles may not
  draw. To check, run the command on a temporary database with a fake `claude` that answers after two seconds, in
  each one, and look at the screen.
- A very narrow terminal. The widest spinner line is `x chat 10 of 10`, 15 characters, so it would wrap
  below about 15 columns. That was reasoned from the text, not seen, because no screen reader was available
  here.
- A long real run. The real call test used two short chats. A chat that needs several calls, or one that
  takes the full two-minute timeout, was not run.
- `importClaudeMemory`, which runs first and still prints nothing. This is a choice, not a gap in the tests.
- Small wording that reads oddly: `1 chat(s)`, `1 of 1 chats` and `daily limit of 1 calls`.

---

## 3. Test the parent-process lookup on macOS

**Status: built, not done yet.** The check passes on Linux here. It is done only when CI passes it on
`macos-latest`, which has not run.

**Problem.** The 0.10.3 lookup reads `/proc` on Linux and runs `ps` on macOS. Only the Linux path was tried
on a real machine. The macOS path is covered by logic tests with a fake process table, not by a real `ps`.

**Plan.**

- Export the real inspection function and call it on the test's own process id.
- Check that it returns a parent that is a positive number and a path that exists.
- CI already runs on `macos-latest`, so this proves the `ps` path there on every push with no new setup.

**Done when.** The check passes on both `ubuntu-latest` and `macos-latest` in CI.

**What was built.** `inspectProcess` and `inspectWithPs` are exported. Two checks in
`scripts/unit/claude-cli.mjs` call them on the test's own process id. One checks that the parent is a positive
number, equals `process.ppid`, and that the executable path exists. The other checks that the `ps` reading
finds the same parent. The test job in `ci.yml` already runs `npm test` on `ubuntu-latest` and `macos-latest`,
so no workflow change was needed.

**What was verified.** Both checks pass on Linux here, and the full `npm test`, `lint`, `typecheck` and `knip`
pass.

**What was not tested.**

- macOS. The `ps` path only runs there, and it was never run on a Mac. The check assumes macOS `ps` prints the
  full path of the program for `comm`. If it prints only a name, the "executable path exists" check fails in
  CI, and the check, not the lookup, needs adjusting.
- The `ps` reading on Linux is not representative: it prints `MainThread` as the name, so only its parent was
  checked. Linux uses `/proc`, so this does not affect the lookup.
- Windows, where the lookup is skipped and the checks do not run.

**Next step.** Push the branch or open a pull request, and read the `test` job result for
`macos-latest` on all three Node versions. Mark this item done only when all pass.

---

## 4. Add `claude-db --version`

**Status: done, verified 2026-10-07.** Not released yet.

**Problem.** The command does not exist, and `claude-db` with no arguments prints only the usage. A user who
wants to know which version is installed has to know about `doctor` or `npm ls -g`.

**Plan.**

- `claude-db --version` and `-v` print the same value as the `version` line in `doctor`.
- The usage text lists the flag.

**Done when.** A test runs the built CLI with each flag and checks the output equals `package.json`'s
version.

**What was verified.**

- The built CLI printed `0.10.3` for both `--version` and `-v`, with exit code 0 and nothing else on the
  line. A test in `scripts/unit/isolated/cli-run.mjs` checks both against `package.json`'s version.
- The usage text lists `--version, -v`, and `doctor` shows the same version. Both are tested.
- It also works through a symlink to the built file, which is how npm links the `claude-db` and `cdb`
  commands.
- Full `npm test`, `npm run lint`, `typecheck` and `knip` pass.

**What was not tested.**

- A real global install from the packed tarball. CI does that step and runs `claude-db doctor`, not
  `--version`, so the flag is not covered there.
- The `cdb` alias by name. It points at the same file, so it was only covered through the symlink check.
- Windows, where npm creates `.cmd` shims instead of symlinks.
- `claude-db --version` when another word follows it, such as `claude-db --version extra`. It prints the
  version and ignores the rest.

---

## 5. Picks usefulness above 70%

**Problem.** The goal is 8 in 10 shown memories useful. The measured range is 61% to 70%. The judge agrees
with itself on about 9 in 10 picks, so the ceiling is near. See section 7 and section 10 of
[memory-improvements.md](./memory-improvements.md).

**Plan.** Do not start yet.

- Collect more real use first. One project and one person is not enough to tell a real gain from noise.
- Candidate directions: what Haiku sees for each candidate, and how many candidates it gets.
- Re-measure with `npm run bench:inject -- <project> --last 300 --judge` before and after.

**Done when.** A change moves the measured figure by more than the run-to-run spread, on more than one
project.

---

## 6. `/catchup` and `/handoff` skills

**Status: done, verified 2026-10-07.** Not released yet.

Designed in Phase 5b of [memory-improvements.md](./memory-improvements.md). Not started.

**Problem.** A new chat starts with facts and picks, but nothing answers "where did I stop?". After a break
you reread the last chat or the git log to find out. Handing work to a teammate, or to your next chat, has
no standard note at all.

**Plan.** Ship two skills the way `/cdb-scan` ships today, as folders under `skills/`.

- `/catchup` answers "where did I stop?". It reads the last chat's notes through the memory tools, plus
  `git status` and the recent commits, and prints three short groups: done, open, next. It writes nothing.
- `/handoff` writes a note for the next chat or a teammate with the same three groups, and saves it as a
  memory note tagged `handoff`, so the next chat sees it at the start. It also prints the note, so it can be
  pasted into a pull request or a message.
- The note keeps to what the chat actually showed. Anything it is unsure of is marked as a guess, not
  stated as a fact.
- Sharing with a teammate works when both use the same database, which is the Postgres or MongoDB setup.
  With the default SQLite file, the printed note is the way to share.

Example of a `/handoff` note:

```
Handoff, Oct 6:
- Done: timers, queue, mail family.
- Open: PR #18 not merged.
- Next: ask which retries to change on the worker queue.
```

**Done when.**

- Both skills install with the rest, and `claude-db doctor` lists them.
- A test with a prepared chat and a temporary git repository checks that `/catchup` names the done, open
  and next items, and that `/handoff` saves a note a second chat can find.
- A note made from a chat with no clear next step says so, and does not invent one.

**Risks.**

- A skill is instructions to Claude, so its quality depends on the model. Test the wording on several real
  chats, not one.
- A handoff note is saved memory. Run it through the same secret removal as every other note.

**What was built.**

- Two skill files, `skills/catchup/SKILL.md` and `skills/handoff/SKILL.md`.
- A read-only command, `claude-db catchup`, that gathers the facts both skills use: the newest handoff, the last
  chat with a few lines of its work, the to-dos, the uncommitted recorded work, `git status` and the last five
  commits. It prints nothing for a part that is empty. This was not in the plan. The memory `search` tool
  ranks by words, so a skill alone cannot reliably find "the last chat". Doing the gathering in code makes
  it repeatable and testable, and the skill only turns it into done, open and next.
- A skill registry, `src/cli/skills.ts`. Install, refresh and uninstall handle all three skills.
  `catchup` and `handoff` carry the line `Shipped with claude-db.` A skill file that does not carry it is
  yours: install keeps it and says so, refresh does not overwrite it, and uninstall does not delete it. A
  refresh in a project where claude-db is already installed adds the two new skills.
- `claude-db doctor` prints a `skills   :` line that lists each skill as ok or MISSING, with the fix.
- Session start shows the newest handoff, up to 14 days old, under `Last handoff (date):` with its three lines.
  Before this change a saved note would have shown only its first line, because the start block prints a
  note's title. Saved with the key `handoff`, a new note replaces the old one, so there is one current handoff
  per project.

**What was verified.**

- 27 new checks pass, in `scripts/unit/skills.mjs` and `scripts/unit/isolated/catchup-run.mjs`:
  - Every skill file has a name equal to its folder, a description and, for the new two, the marker.
  - Install, a second install, uninstall, refresh of a stale file, the add-on-upgrade case, a file that is not
    ours, and a project that never had claude-db all behave as described above.
  - On a prepared chat and a temporary git repository, `catchup` names the last chat and its work, the to-do,
    the uncommitted work, the untracked file and the commits. With nothing recorded it says so.
  - A saved handoff shows its done, open and next lines in `catchup`, and in the output of the real
    `session-start` hook for a second chat. It is not repeated as a plain rule line.
  - A new handoff replaces the old one. A secret in a handoff is removed before saving. A handoff older than
    14 days is not shown.
- The skill wording was run with the real `claude` on Haiku, in five temporary projects, with the real memory
  server and `claude-db catchup`:
  - A full project: `/catchup` gave Done, Open and Next that matched the data.
  - No handoff, no to-do, no uncommitted work: `/catchup` said `No clear next step found.` and invented
    nothing. It did the same for a project with only commits.
  - `/handoff` with the three lines given in the request saved the note with the key `handoff`, the kind
    `context` and the tag `handoff`, in the exact shape, and printed it.
  - `/handoff` with no clear next step wrote `- Next: no clear next step yet.` and saved it.
- `claude-db catchup` ran read-only on this project's real memory, and every part printed.
- Full `npm test`, `npm run lint`, `typecheck` and `knip` pass.

**What was not tested.**

- The wording on real chats from real users. The five runs used prepared projects, not chats that someone had
  actually worked in. One model (Haiku) was used. Sonnet or Opus may word things differently.
- `/handoff` in the middle of a long real chat, where "what happened in this chat" is much larger than in these
  runs.
- Two people on one shared Postgres or MongoDB database. Only SQLite was used.
- The skills in the global scope (`~/.claude/skills`). Tests used the project scope only. The code path is the
  same, with a different folder.
- Windows: the `date '+%b %-d'` command in `/handoff` does not exist there. Claude may fall back to its own
  date, which was not tried.
- A long first line in a handoff. Session start shows the lines after the title and drops the title, so a note
  written without the `Handoff, <date>:` title loses its first line there.
- The "Last chat" lines are noisy on real memory. They are the raw recorded notes, which can be chat lines, so a
  real project can show half-sentences. That comes from what is recorded, not from `catchup`, and `facts`
  (item 2 of the memory plan) is the cleaner source.

---

## 7. Match projects by git link

Designed in Phase 5a of [memory-improvements.md](./memory-improvements.md). Not started.

**Problem.** A project is keyed by its folder path, for example `/home/dev/Code/shop`. The same repository on
another machine, or in another folder, is a different project with no shared memory. `claude-db merge` moves
memory by hand when that happens.

**Plan.**

- Key a project by its git remote, written as `github.com/acme/shop`. Fall back to the folder path when
  there is no remote, as today.
- Strip any credentials from the remote before it is used. An `https` remote can hold a token, and the key
  is stored and can be shared.
- Treat the `ssh` and `https` forms of one remote as the same key.
- Do not move old rows. A project map links every folder to its key, and a lookup by folder follows the map.
- Where a repository has several remotes, use `origin`, and let a config setting choose another.

**Done when.**

- Two clones of one repository in different folders share the same memory.
- A repository with no remote still works by folder path.
- The `ssh` and `https` forms give one key, and a remote with a token in it gives a key with no token.
- A test covers a changed remote, so memory is not lost when the remote moves.
- Rows saved before the change are still found.

**Risks.**

- It changes how every row is matched to a project, so it needs the most careful tests of this list. Ship
  it alone, with its own release note.
- A fork and its upstream have different remotes and stay separate projects. Say so in the docs.
- A monorepo with several packages stays one project, as today.

---

## Order

| #   | Item                                   | Size   | Why in this place                                 |
| --- | -------------------------------------- | ------ | ------------------------------------------------- |
| 1   | Say when the Haiku features cannot run | Medium | Done. The real failure that went unseen for days  |
| 2   | Progress for `distill --backfill`      | Small  | Done. It looked stuck on a real run               |
| 3   | macOS test of the lookup               | Small  | Built. Waits for CI on macOS. Closes a 0.10.3 gap |
| 4   | `claude-db --version`                  | Small  | Done. Missing basic command                       |
| 5   | Picks usefulness above 70%             | Large  | Needs more data first, and the ceiling is near    |
| 6   | `/catchup` and `/handoff` skills       | Medium | Done. Used on every return to work                |
| 7   | Match projects by git link             | Large  | Changes how every row is matched; ship it alone   |

Items 2 to 4 are small enough to ship together in one release. Item 1 is better on its own, so the release
note can explain it. Item 6 can follow in its own release. Item 7 changes how rows are matched to projects,
so it ships alone.

The code graph work is planned in separate files, starting from
[find-usages-accuracy.md](./find-usages-accuracy.md).
