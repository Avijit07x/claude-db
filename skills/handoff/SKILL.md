---
name: handoff
description: Write a short handoff note for the next chat or a teammate, with what is done, what is open, what comes next and what was rejected and why. Saves it to project memory so the next chat sees it at the start, and prints it so it can be pasted into a message or a pull request. Use when the user ends a piece of work, switches tasks, or hands the project to someone.
---

# Write a handoff note

## 1. Gather the facts

Run this from the project root to see what memory and git already know:

```bash
claude-db catchup
```

Combine that with what happened in this chat. The chat is the best source for what was done and what is
still open. The output fills gaps and checks dates. If it shows a `Last handoff`, that is the note you
will carry forward in step 2.

## 2. Write the note

The first line is the title and has today's date. Get it with `date '+%b %-d'`. Then write at most 8 lines,
each under about 200 characters. The next chat reads this note at its start, so every line costs context.

```
Handoff, Oct 7:
- Done: timers, queue, mail family.
- Open: PR #18 not merged.
- Next: ask which retries to change on the worker queue.
- Decided: retries stay at 3, because the queue already backs off.
- Rejected: a second worker pool, because it doubled the mail cost.
- Watch out: tests read dist/, so run the build first.
- State: branch v0.12, 4 files uncommitted, last commit 1db3638.
```

Lines:

- `Done`, `Open` and `Next` are always there. One line each.
- `Decided`, `Rejected`, `Watch out` and `State` only when there is something real to say. Never pad.
- `Rejected` and `Decided` give the reason after "because". A rejected idea with no reason is not worth a line.
- `State` comes from the `catchup` output, not from memory: the `Branch` line and the newest of the
  `Recent commits`. Add a pull request number only if this chat mentioned one.
- `Decided` and `Rejected` start from `Decisions and dead ends` in the output, plus this chat.
- Name real things: a file, a pull request number, a command, a decision. Do not write `various changes`.
- Use only what this chat or the output showed. Mark anything you are unsure of with `(guess)`.
- If there is no clear next step, write `- Next: no clear next step yet.` Do not invent one.
- Leave out secrets, tokens, passwords and personal data.

Carry forward. Keep a line from the previous handoff when it is still true and still matters, and add the
date to it, for example `(Oct 5)`. Drop what is finished or wrong. If the note is over 8 lines, shorten lines
or drop the oldest finished ones. Never drop a `Rejected` line that is still true.

## 3. Save it

Call the `remember` memory tool once, with these exact values:

- `text`: the note
- `key`: `handoff`
- `kind`: `context`
- `tags`: `["handoff"]`

The key makes a new handoff replace the old one for this project, so there is one current note. The next
chat sees it at the start under `Last handoff`. It is shown for 14 days. Only the first 8 lines are shown,
each cut at about 220 characters.

## 4. Print it

Show the note in a code block so the user can paste it into a message or a pull request. Then say in one
line that it was saved, and that it replaces any earlier handoff for this project.

If the memory tool is not available, still print the note and say it was not saved.

## Sharing

A teammate sees the saved note when both of you use the same Postgres or MongoDB database. With the default
SQLite file on one machine, the printed note is the way to share it.

_Shipped with claude-db. It is replaced when claude-db updates._
