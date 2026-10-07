# Setup guide: get the best results from claude-db

Last updated: 2026-10-06. This guide describes the version in this repository, including everything
listed under 0.10.0 in the [changelog](../CHANGELOG.md).

claude-db works after one install command. This guide covers what comes after that: how to check it
is working, how to give it a head start, which habits and settings change the results most, and what
it costs. Where a recommendation rests on a measurement, the number is given. The measurements are in
[memory-improvements.md](https://github.com/Avijit07x/claude-db/blob/main/docs/memory-improvements.md), and how it all works is in
[how-it-works.md](./how-it-works.md).

## The short version

1. Use Node 22.16 or newer, and a git repository.
2. `npm install -g claude-db`
3. In your project: `claude-db install --project`
4. Keep the personal files out of git (`.mcp.json`, `CLAUDE.local.md`).
5. Restart Claude Code.
6. Check it: `claude-db status` and `claude-db doctor`.
7. Give it a head start: `claude-db flush`, `claude-db scan`, `claude-db seed --from-git`.
8. Work as usual, and look again with `claude-db status` after a day.

The rest of this guide explains each step and what to do after it.

## 1. Requirements

| You need               | Why                                                                                                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node 22.16 or newer    | The default database is Node's built-in SQLite. Before 22.16 it either needs a flag or has no full-text search. An older Node is refused at install with a clear message. Check with `node -v` |
| A git repository       | `scan` and `seed` read your project through git, and the project's folder path is what its memory is filed under                                                                               |
| Claude Code, logged in | Two background features call Claude Haiku through your own login (see [cost and privacy](#7-cost-and-privacy)). The terminal CLI and the VS Code extension both work                           |

Nothing else is required. Postgres, MongoDB and the local embedding model are optional.

## 2. Install

```bash
npm install -g claude-db
cd your-project
claude-db install --project
```

Every command also works as `cdb`.

### One project or the whole machine

|                     | `claude-db install --project`             | `claude-db install`                             |
| ------------------- | ----------------------------------------- | ----------------------------------------------- |
| Applies to          | this repository only                      | every project you open on this machine          |
| Hooks go in         | `.claude/settings.local.json` in the repo | `~/.claude/settings.json`                       |
| Memory instructions | `CLAUDE.local.md` in the repo             | `~/.claude/CLAUDE.md`                           |
| MCP server in       | `.mcp.json` in the repo                   | your Claude Code user config (`~/.claude.json`) |
| Good for            | trying it, or keeping it off some repos   | using it everywhere without thinking about it   |

Memory itself is always one database for the whole machine (`~/.claude-memory/memory.db`), filed by
project. The choice above only decides where claude-db is switched on.

### What install registers

Five hooks, which is why nothing needs to be run by hand afterwards:

| Hook                       | What it does                                                            |
| -------------------------- | ----------------------------------------------------------------------- |
| SessionStart               | Shows what matters at the start of a chat, and starts background upkeep |
| UserPromptSubmit           | Saves the previous turn and looks for memory that fits your new prompt  |
| PreToolUse (every tool)    | Hands Claude the memory Haiku picked, with its first tool call          |
| PreToolUse (Bash and Grep) | Points symbol searches at the code graph instead of grep                |
| SessionEnd                 | Saves the last turn and starts turning the chat into facts              |

It also writes a standing instruction ("search memory before asking the user to re-explain") and three
skills: `/cdb-scan`, `/catchup` and `/handoff`. If you already have a skill with the same name, claude-db keeps
yours and says so.

### Keep personal files out of git

`.mcp.json` holds an absolute path on your machine, so committing it breaks the project for everyone
else. `CLAUDE.local.md` and `.claude/settings.local.json` are meant to be personal too. Make sure all
three are ignored:

```bash
printf '\n.mcp.json\nCLAUDE.local.md\n.claude/settings.local.json\n' >> .gitignore
```

The installer only reminds you about `.mcp.json`, and only when no `.gitignore` lists it.

### Restart Claude Code

The MCP server and the hooks are loaded when Claude Code starts. A session that was already open does
not have them.

## 3. Check that it works

```bash
claude-db status
```

Right after install you should see this, with your own paths:

```text
project  : ~/shop
database : ~/.claude-memory/memory.db
hooks    : this project
mcp      : registered (~/shop/.mcp.json)
sessions : 0 recorded for this project
worked   : never
recorded : never
facts    : 0 for this project, 0 about you
waiting  : 0 chat(s) not yet turned into facts
pick     : on (haiku), 0 of 150 picks used today
```

"Nothing recorded yet" is normal here. Memory is written as you work, only for turns that changed
something, so a chat of questions leaves nothing behind. After your first real session, `sessions`
and `recorded` fill in.

```bash
claude-db doctor
```

`doctor` shows the version, the database, whether it can be reached, the embedder, and whether the
hooks are wired once each (`wiring   : ok`). `claude-db doctor --deep` goes further: it writes one
test memory, searches for it, reads it back and deletes it, and tells you which step failed if any.

## 4. Give it a head start

A fresh install has nothing to recall. These steps fill it from what already exists.

| Step                                 | Command                                             | What it does                                                                                                                                                | Cost               |
| ------------------------------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Load your past chats                 | `claude-db flush`                                   | Reads the chats Claude Code already saved for this project and turns them into memory. Claude Code keeps chat files for about 30 days, so do this early     | none               |
| Map the code                         | `claude-db scan`                                    | Stores every symbol and how they connect. About a second on a mid-size repo. After the first scan it refreshes itself at each session start                 | none               |
| Read the git history                 | `claude-db seed --from-git`                         | Turns your commit history into memory so search has something to match                                                                                      | none               |
| Or do the mapping from inside Claude | `/cdb-scan`                                         | A skill that builds the graph, then writes five notes about your stack, layout, conventions, workflows and architecture                                     | a normal chat turn |
| Ask where you stopped                | `/catchup`                                          | Prints done, open and next from the last chat, the recorded to-dos, the last handoff and git. Writes nothing. The raw facts are also in `claude-db catchup` | a normal chat turn |
| Hand work to the next chat           | `/handoff`                                          | Writes a short note (done, open, next), saves it as the project's one current handoff and prints it. The next chat sees it at the start for 14 days         | a normal chat turn |
| State your standing rules            | `claude-db remember "always use pnpm in this repo"` | Stored as a rule for this project and recalled when relevant                                                                                                | none               |

After you have used it for a session or two, a background job starts turning your older chats into
**facts**: short rules, decisions with their reasons, dead ends and to-dos. It works newest chat first,
only on the last 90 days, and at most 30 Haiku calls a day. `claude-db distill` shows how many chats
are still waiting. Claude Code's own memory files for the project (`~/.claude/projects/*/memory/`) are
imported as facts too, at no cost.

## 5. Work in ways that help memory

These follow from how recall works. The numbers come from replaying 300 real prompts; see
[memory-improvements.md](https://github.com/Avijit07x/claude-db/blob/main/docs/memory-improvements.md).

- **Be specific.** A prompt needs at least two meaningful words, and a past memory is only considered
  if it shares at least two of them with your prompt. "Make the order feed reconnect with backoff"
  finds things. "ok", "continue" and "do it" find nothing, on purpose.
- **Expect memory with Claude's first tool call, not before your prompt.** Haiku reads the closest
  ten memories and picks at most two, only when they carry something specific for this task. Most
  prompts get none: in testing about 30% did, and about 6 to 7 in 10 of what was shown was judged
  useful. A turn in which Claude uses no tools never shows a pick.
- **Say why.** "We chose a websocket because polling hammered the API" becomes a decision with its
  reason. "That approach failed because..." becomes a dead end. These are what a later chat needs.
- **State a rule once, plainly.** Tell Claude to remember it, or run `claude-db remember`.
- **Commit finished work.** Work that changed files stays listed as "Not committed" in `status` and at
  the start of a chat until those files are committed.
- **Wrap anything private in `<private>...</private>`.** It is removed before the turn is saved.
- **Use `/compact` freely.** When a chat is compacted, its own decisions and open work are put back.
- **Keep `CLAUDE.md` for a stable overview of the project.** claude-db stores what happened, which is
  a different job.
- **Look at what it holds.** `claude-db search <words>`, `claude-db stats`, and `claude-db view` for a
  page in the browser.

## 6. Settings

Settings live in `~/.claude-memory/config.json`. The file is optional and every key has a default.
It is created the first time a command changes a setting, such as `claude-db pick off`,
`claude-db distill off` or `claude-db use`. Edit it by hand for the rest, and list only the keys you
want to change.

| Key                    | Default  | What it does                                                     | Change it when                                              |
| ---------------------- | -------- | ---------------------------------------------------------------- | ----------------------------------------------------------- |
| `pick.enabled`         | `true`   | Let Haiku pick the memory shown with a prompt                    | you want no Claude usage for this (`claude-db pick off`)    |
| `pick.dailyLimit`      | `150`    | Most picks a day. After that, only strong word matches are shown | you work a lot in one day                                   |
| `pick.model`           | `haiku`  | `haiku`, `sonnet` or `opus`                                      | almost never; Haiku was the one measured                    |
| `distill.enabled`      | `true`   | Turn finished chats into facts                                   | you want no Claude usage for this (`claude-db distill off`) |
| `distill.dailyLimit`   | `30`     | Most fact-making calls a day                                     | you have many old chats to catch up on                      |
| `distill.backfillDays` | `90`     | How far back older chats are turned into facts                   | you want a shorter or longer reach                          |
| `inject.perPrompt`     | `true`   | Show related memory with prompts at all                          | you want memory only at the start of a chat                 |
| `inject.minOverlap`    | `2`      | Meaningful words a memory must share with the prompt             | almost never; 2 was the best floor measured                 |
| `inject.promptResults` | `2`      | Most memories shown with one prompt                              | you want more or fewer lines                                |
| `project.remote`       | `origin` | The git remote that names a project                              | your main remote is not `origin` (a fork's `upstream`)      |
| `updates`              | `notify` | `notify`, `auto` or `off`                                        | you want updates installed for you, or never checked        |
| `embeddings.provider`  | `auto`   | `auto`, `local`, `builtin` or `none`                             | you install the optional embedding model, or want none      |

### Three ready-made setups

**The default** needs no file. It uses Haiku for picking and for facts, inside the daily limits.

**No Claude usage.** Memory is still recorded and searched, but nothing calls Claude:

```json
{
  "pick": { "enabled": false },
  "distill": { "enabled": false }
}
```

The cost is quality. Without Haiku, a prompt only gets memory when the closest one shares four
meaningful words with it. In testing that showed memory on about 12% of prompts, and it was useful
43% of the time, against about 6 to 7 in 10 with Haiku. No new facts are made, so the start of a
chat shows the facts it already has, or recent session summaries if there are none.

**Heavy use.** Raise the limits if you hit them. `claude-db pick` and `claude-db distill` show how
much of today's limit is used:

```json
{
  "pick": { "dailyLimit": 400 },
  "distill": { "dailyLimit": 60 }
}
```

### Better embeddings are optional

The built-in embedder works without installing anything. For semantic matching in `search`:

```bash
npm install -g @xenova/transformers
claude-db reembed
```

This is a large download (about 200 MB of libraries plus a model). It is not needed for picking, and
its effect on the memory shown with prompts was not measured.

## 7. Cost and privacy

Nothing leaves your machine except the things below, and each can be turned off.

| What          | When                         | What is sent                                                                                                   | Cost                                                   | Limit      | Turn it off             |
| ------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------- | ----------------------- |
| Picking       | A prompt has related memory  | Your prompt, the end of Claude's previous reply, and up to ten memory excerpts of 600 characters, all redacted | About 3,000 input and 100 output Haiku tokens per pick | 150 a day  | `claude-db pick off`    |
| Facts         | After a chat ends            | The chat's saved, redacted text, in pieces of about 40,000 characters                                          | One Haiku call per piece                               | 30 a day   | `claude-db distill off` |
| Update check  | Once a day                   | A request to the npm registry                                                                                  | none                                                   | once a day | `"updates": "off"`      |
| Your database | Only if you set a remote one | Your memory                                                                                                    | depends on the host                                    | none       | `claude-db use <path>`  |

Both Haiku features go through your own Claude Code login, so they count against your plan like any
other use. Haiku is the lightest model, and a pick is small next to an ordinary chat turn. A failed
call pauses that feature for an hour, then six hours, then a day if calls keep failing, while recording
carries on. `claude-db status` shows the reason.

What is never stored: `.env` files, anything under `secrets/`, `node_modules` and `.git/`. Text in
`<private>...</private>` is stripped. API keys, tokens, private keys, connection-string passwords and
`NAME=value` secrets are redacted before anything is saved or sent. `claude-db redact` re-applies the
current rules to memory saved earlier; it also runs once on its own after an update.

One limit to know about: a secret you paste into a chat also stays in Claude Code's own chat file,
which claude-db does not edit. If you paste a real secret, rotate it.

## 8. Teams and several machines

SQLite is the default and needs no setup. To share memory, point claude-db at a database everyone can
reach:

```bash
npm install -g pg
claude-db use "postgres://user:pass@host:5432/memory"
```

Use `mongodb` and a `mongodb+srv://` address for MongoDB. Install the driver the same way claude-db
was installed, since neither ships by default. `use` checks the database answers before it saves the
address, and warns if the database already holds tables that are not claude-db's. Give it a database
of its own.

- **Projects are matched by git remote.** A repository with an `origin` remote is one project wherever it
  is cloned, so `github.com/acme/shop` on your laptop and on your Mac share memory. `ssh` and `https`
  addresses of the same repository match, and any token in the address is never stored. A folder with no
  remote is matched by its path, as before. A fork has its own remote, so it is its own project. Set
  `project.remote` to use a remote other than `origin`. Memory saved before this, under a folder path, is
  still found and is not moved. `claude-db merge <old-path> --yes` still works for a folder with no remote.
- **Personal rules stay personal.** A rule about how you like to work is filed under your git email,
  so it follows you into every project and never reaches a teammate on a shared database. Set
  `git config user.email` so it is filed under the right name. Everything else belongs to the
  project and is shared.
- **Two databases, one memory.** `claude-db sync <url>` merges two databases in both directions, so a
  laptop and a desktop can each work offline and reconcile later. `claude-db export` and
  `claude-db import` do the same with a file.
- **Use a restricted account.** Connection strings are redacted whenever claude-db prints them, but
  the account should only be able to reach its own database.

## 9. Keep it healthy

| How often                 | Command                            | Why                                                                   |
| ------------------------- | ---------------------------------- | --------------------------------------------------------------------- |
| Now and then              | `claude-db status`                 | Wired up, last recorded, open work, how many picks used today         |
| Now and then              | `claude-db stats`                  | What memory is made of, by kind and by area                           |
| After a big refactor      | `claude-db scan`                   | Refreshes the code graph (it also refreshes at each session start)    |
| When memory is stale      | `claude-db prune --older-than 180` | A dry run that counts what would go; add `--yes` to delete            |
| When something is wrong   | `claude-db forget <id>`            | Deletes a memory that turned out to be wrong, so it stops coming back |
| After moving a repository | `claude-db merge <old-path> --yes` | Brings memory filed under the old path across                         |

`claude-db uninstall --project` removes the hooks, the MCP entry and the instructions, and leaves your
memory untouched. Only `forget`, `prune` and `reset` delete memory, and the last two do nothing without
`--yes`.

## 10. Upgrading

```bash
npm install -g claude-db
```

or `claude-db update`. Then restart Claude Code once. At the first session after an update, a few
one-time jobs may run in the background, and none of them blocks a chat:

- repairing memory that an older version saved badly (`claude-db flush --repair`),
- re-applying secret redaction to everything already saved (`claude-db redact`),
- turning older chats into facts, which carries on over the next sessions within the daily limit.

Hooks that an earlier install registered are brought up to date automatically at session start, so a
new hook arrives without running `install` again. The first chat after you get facts says so once, and
how to switch that off with `claude-db distill off`.

## 11. When something is off

| What you see                                      | Check                                                                                                                                                                                                                            |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nothing is recorded                               | Did you restart Claude Code after installing? Was `install` run in this repository? Did any turn change a file? Questions and read-only commands are skipped by design                                                           |
| Memory rarely shows up                            | Early on there is little to find, so run the head start steps in section 4. Prompts of one or two words, or filler, get none. Run `claude-db pick`: it says if picking is off, paused after a failed call, or past today's limit |
| Memory never shows in a chat of questions         | Picks arrive with Claude's first tool call, so a turn with no tools never shows one                                                                                                                                              |
| `doctor` says `registered 2x`                     | Run `claude-db install` again. It replaces its own entries                                                                                                                                                                       |
| Install stops with a Node version message         | Upgrade to Node 22.16 or newer                                                                                                                                                                                                   |
| `reachable: no`                                   | For Postgres or MongoDB, install the driver (`npm install -g pg` or `npm install -g mongodb`) and check `CLAUDE_DB_URL` is not set to something old                                                                              |
| A moved repository looks empty                    | A repository with a remote keeps its memory. With no remote, run `claude-db merge <old-path> --yes`                                                                                                                              |
| Search got worse after adding the embedding model | Run `claude-db reembed`                                                                                                                                                                                                          |

The [troubleshooting page](https://claude-db.vercel.app/docs/troubleshooting) covers the rest.

## 12. Where things live

| Path                                    | What it is                                                              |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `~/.claude-memory/memory.db`            | The default SQLite database                                             |
| `~/.claude-memory/config.json`          | Your settings (optional)                                                |
| `~/.claude-memory/cursors/`             | How far each chat has been read, and what a chat has already been shown |
| `~/.claude-memory/pick/`                | Picks in flight and today's pick count                                  |
| `~/.claude-memory/distill/`             | Today's fact-making count                                               |
| `~/.claude-memory/reingest/`, `redact/` | Marks that a one-time job has finished, per project or database         |
| `.claude/settings.local.json`           | The hooks, for a project install                                        |
| `.mcp.json`                             | The MCP server, for a project install                                   |
| `CLAUDE.local.md`                       | The standing instruction to search memory                               |
| `.claude/skills/cdb-scan/`              | The `/cdb-scan` skill                                                   |
| `.claude/skills/catchup/`, `handoff/`   | The `/catchup` and `/handoff` skills                                    |

To delete everything claude-db has stored, remove `~/.claude-memory`.
