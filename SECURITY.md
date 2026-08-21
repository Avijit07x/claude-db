# Security Policy

## Supported versions

Fixes land on the latest published minor. Older minors are not patched, so
upgrade before reporting a problem you can reproduce only on an old version.

| version | supported                                    |
| ------- | -------------------------------------------- |
| 0.7.x   | yes                                          |
| < 0.7   | no — upgrade with `npm install -g claude-db` |

## Reporting a vulnerability

Please report privately rather than opening a public issue.

Use GitHub's private reporting on this repository: **Security → Advisories →
Report a vulnerability**. If that is unavailable to you, contact the maintainer
through the address on the [@Avijit07x](https://github.com/Avijit07x) profile.

A useful report includes the version (`claude-db doctor` prints it), the
database backend, what an attacker would gain, and the smallest reproduction you
can manage. You will get an acknowledgement, and a fix or an explanation of why
the behaviour is intended.

Please do not test against anyone else's machine or database.

## What this software touches

Knowing the blast radius helps when judging whether something is a
vulnerability:

- **Everything is local by default.** Memory lives in a SQLite file under
  `~/.claude-memory/`, or in whatever MongoDB or Postgres URL you configure.
  There is no hosted service, no telemetry, and no account.
- **The only outbound request** is the update check against the npm registry,
  which sends nothing about you and can be disabled with `updates: "off"` in
  `~/.claude-memory/config.json`.
- **Memory contains your work.** Observations are built from session
  transcripts, so the database holds prompts, reasoning, and file paths. Treat
  it with the same care as the repository it describes.
- **Redaction is best-effort.** Text you wrap in `<private>...</private>` is
  stripped, as are private key blocks, credentials in URLs, and key-shaped
  tokens. That is a safety net, not a guarantee — anything pasted into a
  session may reach the database in some form.
- **Credentials in a database URL** are held in the config file and masked in
  command output, but the config file itself is plain text.
- **Hooks execute on your machine** with your permissions, as registered in
  `.claude/settings.local.json`. Installing from an untrusted checkout means
  running that checkout's code.
- **`.mcp.json` holds an absolute path** to the install, which is why the
  installer warns against committing it.

## Out of scope

- Anything requiring an attacker who already has your shell or filesystem
  access, since memory offers them nothing they could not read directly.
- Content of memory captured from your own sessions — that is the feature.
- Vulnerabilities in optional peer dependencies (`pg`, `mongodb`,
  `@xenova/transformers`); report those upstream, though tell us if claude-db
  uses them in a way that makes an upstream issue worse.
