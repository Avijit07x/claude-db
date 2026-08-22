export function usage(): void {
  console.log(`claude-db

  install [--project]         Register hooks + MCP server with Claude Code
  uninstall [--project]       Remove them again, leaving memory intact
  status                      Is it wired up, and has it recorded anything
  doctor [--deep]             Show resolved config; --deep proves a full
                              write, search, recall and delete round trip
  use [--force] <url>         Point memory at a database, once it answers
  search [--all] <query>      Search memory, this project or every project
         [--tag <name>]       ...limited to one repo or top-level directory
  remember [--kind k] <text>  Record something outright, e.g. a house rule
           [--key <name>]     ...under a stable name, replacing any earlier one
  forget <id> [id...]         Delete specific observations by id
         --session <id>       ...or clear one session's summary, so it stops being injected
  projects                    List every project with memory in this database
  merge [<old-path>] [--yes]  Move memory from an old project path onto this one
  stats                       What this project's memory is made of
  adoption                    How often sessions grep vs use the memory tools
  view [--export <file>]      See this project's memory live in the browser
  flush                       Re-ingest every transcript for this project
  seed --from-git [--limit n] Fill a cold memory from this repo's history
  scan [--force]              Map this repo's symbols and how they connect
  usages [--mode m] <symbol>  Who uses a symbol; --mode usages|explain|path
         [--target <symbol>]  ...the second symbol, for --mode path
         [--regex] [--context n] [--path <dir>] [--limit n]
  export [--all] > out.jsonl  Dump memory as JSONL, for backup or migration
  import <file.jsonl>         Load a dump back in (safe to repeat)
  sync <url> [--yes]          Two-way merge with another database
  update                      Install a newer compatible release now
  reembed [--project]         Re-embed with the current model
  prune --older-than <days>   Delete old memory (dry run without --yes)
  reset [--project] --yes     Delete stored memory (dry run without --yes)

  --project  scope to the current repo via .claude/settings.local.json
             instead of every project on this machine

Connection strings:
  mongodb+srv://user:pass@cluster.mongodb.net/memory
  postgres://user:pass@host:5432/memory
  /path/to/memory.db                          (SQLite, default)

Or set CLAUDE_DB_URL in the environment to override config.json.`);
}
