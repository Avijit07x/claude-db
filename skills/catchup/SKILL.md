---
name: catchup
description: Answer "where did I stop?" for this project. Gives three short groups, done, open and next, taken from the last chat, the recorded to-dos, the last handoff note and git. Use when the user comes back to a project, starts a new chat, or asks where they left off. It writes nothing.
---

# Where did I stop?

Run this from the project root:

```bash
claude-db catchup
```

It prints what memory and git know about this project, in plain text. Some parts may be missing. A part
with nothing in it is left out.

- `Last handoff` is a note the user or a teammate saved on purpose. Trust it most.
- `Last chat` is the newest recorded chat, with a few lines of the work done in it.
- `Still to do` are to-dos found in earlier chats.
- `Not committed yet` is recorded work that no commit has covered.
- `Git status` and `Recent commits` are the live state of the repository.

If the output is `Nothing recorded for this project yet.`, say exactly that and stop.

## Answer in three groups

Reply with these three groups and nothing else. Keep each to a few short lines in plain words.

**Done**: what is finished. Take it from the last chat, the recent commits and the handoff's `Done` line.

**Open**: what is started but not finished. Take it from `Not committed yet`, `Git status`, the to-dos and the
handoff's `Open` line.

**Next**: what to do first. Take it from the handoff's `Next` line, then from the to-dos.

## Rules

- Use only what the output shows. Do not read other files or search memory unless the user asks.
- Mark anything you are unsure of with `(guess)`. Never state a guess as a fact.
- If there is no clear next step, write `No clear next step found.` Do not invent one.
- Say how old the information is. Use the dates in the output, for example `Last chat (Oct 6)`.
- Do not save anything. Do not run any command that changes the repository.

_Shipped with claude-db. It is replaced when claude-db updates._
