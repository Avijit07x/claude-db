---
name: handoff
description: Write a short handoff note for the next chat or a teammate, with what is done, what is open and what comes next. Saves it to project memory so the next chat sees it at the start, and prints it so it can be pasted into a message or a pull request. Use when the user ends a piece of work, switches tasks, or hands the project to someone.
---

# Write a handoff note

## 1. Gather the facts

Run this from the project root to see what memory and git already know:

```bash
claude-db catchup
```

Combine that with what happened in this chat. The chat is the best source for what was done and what is
still open. The output fills gaps and checks dates.

## 2. Write the note

Use this exact shape. The first line is the title and has today's date. Get it with `date '+%b %-d'`.

```
Handoff, Oct 6:
- Done: timers, queue, mail family.
- Open: PR #18 not merged.
- Next: ask which retries to change on the worker queue.
```

Rules for each line:

- One line each for `Done`, `Open` and `Next`. Keep each under about 120 characters.
- Name real things: a file, a pull request number, a command, a decision. Do not write `various changes`.
- Use only what this chat or the output showed. Mark anything you are unsure of with `(guess)`.
- If there is no clear next step, write `- Next: no clear next step yet.` Do not invent one.
- Leave out secrets, tokens, passwords and personal data.

## 3. Save it

Call the `remember` memory tool once, with these exact values:

- `text`: the note
- `key`: `handoff`
- `kind`: `context`
- `tags`: `["handoff"]`

The key makes a new handoff replace the old one for this project, so there is one current note. The next
chat sees it at the start under `Last handoff`. It is shown for 14 days.

## 4. Print it

Show the note in a code block so the user can paste it into a message or a pull request. Then say in one
line that it was saved, and that it replaces any earlier handoff for this project.

If the memory tool is not available, still print the note and say it was not saved.

## Sharing

A teammate sees the saved note when both of you use the same Postgres or MongoDB database. With the default
SQLite file on one machine, the printed note is the way to share it.

_Shipped with claude-db. It is replaced when claude-db updates._
