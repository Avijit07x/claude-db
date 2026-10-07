# Setup guide

Get the best results from claude-db in five steps. For how it works inside, see
[how-it-works.md](./how-it-works.md).

## 1. Requirements

- Node 22.16 or newer (`node -v`)
- A git repository
- Claude Code, logged in

## 2. Install

```bash
npm install -g claude-db
cd your-project
claude-db install --project
```

Then restart Claude Code. Hooks and the MCP server load only when Claude Code starts.

- Use `claude-db install` instead to switch it on for every project on this machine.
- Keep `.mcp.json` and `CLAUDE.local.md` out of git. They hold personal paths and rules.

## 3. Check it works

```bash
claude-db doctor
claude-db status
```

`doctor` should end with `wiring : ok`. After your first real session, `status` shows what was
recorded. Nothing is saved for a chat that only asked questions, and that is normal.

## 4. Give it a head start

A fresh install has nothing to recall. Run these once:

| Command                     | What you get                                                     |
| --------------------------- | ---------------------------------------------------------------- |
| `claude-db flush`           | Your past chats for this project, loaded into memory             |
| `claude-db scan`            | A map of your code, so Claude can find symbols and their callers |
| `claude-db seed --from-git` | Your commit history, loaded into memory                          |

Old chats are also turned into short facts in the background, newest first, within a daily limit.

## 5. Work in ways that help

- **Be specific.** "Make the order feed reconnect with backoff" finds memory. "ok" and "continue" do not.
- **Say why.** "We chose a websocket because polling hammered the API" is kept as a decision with its reason.
- **State a rule once.** Tell Claude to remember it, or run `claude-db remember "always use pnpm"`.
- **Commit finished work.** Uncommitted work stays listed as open.
- **Wrap private text in `<private>...</private>`.** It is removed before saving.
- **Use `/catchup` when you return and `/handoff` when you stop.**

## Cost and privacy

Two small background features call Claude Haiku through your own login:

- Picking the best memory for a prompt (up to 150 a day).
- Turning finished chats into facts (up to 30 a day).

Turn either off with `claude-db pick off` and `claude-db distill off`. Memory is still recorded and
searched without them, but fewer prompts get relevant memory. Secrets such as API keys and `.env`
files are never stored or sent.

## Teams and several machines

By default memory is one SQLite file on your machine. To share it, point everyone at one database:

```bash
npm install -g pg
claude-db use "postgres://user:pass@host:5432/memory"
```

For MongoDB, install `mongodb` and use a `mongodb+srv://` address. Clones of one repository share
memory by git remote, so every machine must run 0.11.0 or newer.

## Upgrading

```bash
npm install -g claude-db
```

Then restart Claude Code. Memory is kept.

## When something is off

- **Nothing recorded:** restart Claude Code, and check that `install` ran in this repository.
- **Memory rarely shows up:** run the head start steps, and run `claude-db pick` to see if picking
  is off or at its limit.
- **`doctor` shows `reachable: no`:** for Postgres or MongoDB, install the driver (`pg` or `mongodb`).
- **Remove it:** `claude-db uninstall --project`. Your memory is kept.

Commands are in the [README](../README.md) and `claude-db --help`. Every setting is listed in
[architecture.md](./architecture.md).
