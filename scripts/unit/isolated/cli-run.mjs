import '../../lib/require-isolated.mjs';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { report } from '../../lib/isolated.mjs';

const CLI = new URL('../../../dist/cli/index.js', import.meta.url).pathname;
const home = homedir();
const memoryDir = join(home, '.claude-memory');
mkdirSync(memoryDir, { recursive: true });
writeFileSync(join(memoryDir, 'config.json'), JSON.stringify({ updates: 'off' }));
mkdirSync(join(home, 'shop'), { recursive: true });
const project = realpathSync(join(home, 'shop'));
execFileSync('git', ['init', '-q'], { cwd: project });

const fakeClaude = join(home, 'fake-claude');
writeFileSync(fakeClaude, "#!/usr/bin/env node\nprocess.stdout.write('ok');\n");
chmodSync(fakeClaude, 0o755);

const baseEnv = { ...process.env, CLAUDE_CODE_EXECPATH: fakeClaude };
delete baseEnv.CLAUDE_CODE_ENTRYPOINT;
delete baseEnv.CLAUDE_DB_CAPTURE;

function cli(args, { env = baseEnv, cwd = project } = {}) {
  const run = spawnSync(process.execPath, ['--no-warnings', CLI, ...args], {
    cwd,
    env,
    encoding: 'utf8',
  });
  return { code: run.status, out: run.stdout, err: run.stderr };
}
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const idIn = (text) => /([0-9a-f]{8}-[0-9a-f]{4})/.exec(text)?.[1];

const help = cli([]);
report(
  'with no command, the usage lists every command, pick included',
  help.out.includes('install [--project]') && help.out.includes('pick [on|off]'),
);

const version = readJson(new URL('../../../package.json', import.meta.url).pathname).version;
const long = cli(['--version']);
const short = cli(['-v']);
report(
  '--version and -v print the package version and exit 0',
  long.code === 0 &&
    short.code === 0 &&
    long.out === `${version}\n` &&
    short.out === `${version}\n`,
  `${JSON.stringify(long.out)} ${JSON.stringify(short.out)} vs ${version}`,
);
report('the usage lists the version flag', help.out.includes('--version, -v'));

const installed = cli(['install', '--project']);
const settingsPath = join(project, '.claude', 'settings.local.json');
function registeredHooks(path) {
  try {
    return Object.values(readJson(path).hooks)
      .flatMap((entries) =>
        entries.flatMap((entry) => entry.hooks.map((h) => h.command.split('/').pop())),
      )
      .sort();
  } catch {
    return [];
  }
}
const hookFiles = registeredHooks(settingsPath);
report(
  'install --project registers every hook in this project only',
  installed.code === 0 &&
    hookFiles.join(',') ===
      'pick-deliver.js,prefer-usages.js,session-end.js,session-start.js,user-prompt.js',
  hookFiles.join(',') || installed.err,
);
report(
  'install registers the MCP server and writes the guidance',
  Boolean(readJson(join(project, '.mcp.json')).mcpServers?.memory) &&
    readFileSync(join(project, 'CLAUDE.local.md'), 'utf8').includes('claude-db:start'),
);
report(
  'install warns that .mcp.json should not be committed when nothing ignores it',
  installed.out.includes('.mcp.json holds an absolute path'),
);
writeFileSync(join(project, '.gitignore'), '.mcp.json\n');
report(
  'install stays quiet once .gitignore lists .mcp.json',
  !cli(['install', '--project']).out.includes('.mcp.json holds an absolute path'),
);

const status = cli(['status']);
report(
  'status shows the project install, the MCP server and the pick count',
  status.out.includes('this project') &&
    status.out.includes('mcp      : registered') &&
    status.out.includes('0 of 150 picks used today'),
  status.out,
);

const doctor = cli(['doctor']);
report(
  'doctor reaches the database and finds the wiring sound',
  doctor.code === 0 &&
    doctor.out.includes('reachable: yes') &&
    doctor.out.includes('adapter  : sqlite') &&
    doctor.out.includes('wiring   : ok'),
  doctor.out,
);
report('doctor shows the same version', doctor.out.includes(`version  : ${version}`), version);
const deep = cli(['doctor', '--deep']);
report(
  'doctor --deep proves a write, search, read and delete',
  deep.code === 0 &&
    ['write', 'search', 'expand', 'cleanup'].every((step) =>
      new RegExp(`ok\\s+${step}`).test(deep.out),
    ),
  deep.out.slice(-300),
);

const settings = readJson(settingsPath);
settings.hooks.UserPromptSubmit.push(settings.hooks.UserPromptSubmit[0]);
writeFileSync(settingsPath, JSON.stringify(settings));
const doubled = cli(['doctor']);
report(
  'doctor reports a hook registered twice',
  doubled.out.includes('UserPromptSubmit user-prompt.js registered 2x'),
  doubled.out
    .split('\n')
    .filter((line) => line.startsWith('wiring'))
    .join(' | '),
);

const removed = cli(['uninstall', '--project']);
report(
  'uninstall removes the hooks, the server and the guidance',
  removed.code === 0 &&
    !readJson(settingsPath).hooks &&
    !readJson(join(project, '.mcp.json')).mcpServers &&
    !existsSync(join(project, 'CLAUDE.local.md')),
);
report('status then says nothing is installed', cli(['status']).out.includes('NOT INSTALLED'));

const remembered = cli([
  'remember',
  '--kind',
  'decision',
  'Chose a websocket for the order feed because polling hammered the API',
]);
const decisionId = idIn(remembered.out);
report(
  'remember records a decision and prints its id',
  remembered.code === 0 && remembered.out.startsWith('Remembered') && Boolean(decisionId),
  remembered.out,
);
cli(['remember', 'Always use pnpm in this repo']);
const found = cli(['search', 'websocket', 'order', 'feed']);
report('search finds it by its words', found.out.includes(decisionId), found.out);
report('search without a query explains its usage', cli(['search']).code === 1);

const exported = cli(['export', '--all']);
const lines = exported.out.trim().split('\n').filter(Boolean);
report(
  'export --all writes one JSON object per line',
  lines.length >= 2 && lines.every((line) => typeof JSON.parse(line) === 'object'),
  `${lines.length} lines`,
);
const dump = join(home, 'memory.jsonl');
writeFileSync(dump, exported.out);

const dryReset = cli(['reset']);
report('reset without --yes deletes nothing', dryReset.out.includes('Nothing was deleted'));
const reset = cli(['reset', '--yes']);
report(
  'reset --yes empties memory',
  /Deleted \d+ observation/.test(reset.out) &&
    cli(['search', 'websocket']).out.includes('No matching'),
  reset.out,
);

const imported = cli(['import', dump]);
report(
  'import brings an export back',
  /Imported 2 observation/.test(imported.out) &&
    cli(['search', 'websocket']).out.includes(decisionId),
  imported.out,
);
const broken = join(home, 'broken.jsonl');
writeFileSync(broken, `${lines[0]}\nnot json\n`);
report(
  'import skips a line it cannot read and says so',
  cli(['import', broken]).out.includes('skipped 1 unreadable line'),
);
report('import without a file explains its usage', cli(['import']).code === 1);

const stats = cli(['stats']);
report(
  'stats counts what is stored',
  /observations: 2/.test(stats.out) && stats.out.includes('by kind'),
  stats.out,
);
const projects = cli(['projects']);
report(
  'projects marks the one you are in',
  projects.out.includes(`*`) && projects.out.includes(project),
);

const forgot = cli(['forget', decisionId]);
report(
  'forget deletes by id',
  forgot.out.includes('Forgot 1 observation') &&
    !cli(['search', 'websocket']).out.includes(decisionId),
  forgot.out,
);

const old = { ...JSON.parse(lines[0]), id: randomUUID(), title: 'An old note from last week' };
old.createdAt = Date.now() - 3 * 86_400_000;
const oldDump = join(home, 'old.jsonl');
writeFileSync(oldDump, `${JSON.stringify(old)}\n`);
cli(['import', oldDump]);
const dryPrune = cli(['prune', '--older-than', '2']);
report(
  'prune without --yes only counts what is older',
  dryPrune.out.includes('This would delete 1 observation') &&
    dryPrune.out.includes('Nothing was deleted'),
  dryPrune.out,
);
report('prune needs a positive number of days', cli(['prune', '--older-than', '0']).code === 1);
const pruned = cli(['prune', '--older-than', '2', '--yes']);
report(
  'prune --yes deletes only what is older',
  /Pruned 1 observation/.test(pruned.out) &&
    cli(['search', 'pnpm']).out.includes('Always use pnpm'),
  pruned.out,
);

const sessionId = randomUUID();
const transcripts = join(home, '.claude', 'projects', project.replace(/[^a-zA-Z0-9]/g, '-'));
mkdirSync(transcripts, { recursive: true });
const at = new Date(Date.now() - 60_000).toISOString();
writeFileSync(
  join(transcripts, `${sessionId}.jsonl`),
  [
    {
      type: 'user',
      timestamp: at,
      message: { content: 'make the order feed reconnect with backoff' },
    },
    {
      type: 'assistant',
      timestamp: at,
      message: {
        content: [
          { type: 'text', text: 'The order feed now reconnects with exponential backoff.' },
          {
            type: 'tool_use',
            id: 't1',
            name: 'Edit',
            input: { file_path: join(project, 'feed.ts') },
          },
        ],
      },
    },
  ]
    .map((entry) => JSON.stringify(entry))
    .join('\n') + '\n',
);
const flushed = cli(['flush']);
report(
  'flush records the chats already on disk',
  /1 observations from 1 transcript/.test(flushed.out) &&
    cli(['search', 'reconnect', 'backoff']).out.includes('exponential backoff'),
  flushed.out,
);

const page = join(home, 'memory.html');
const viewed = cli(['view', '--export', page]);
report(
  'view --export writes a page with this project in it',
  viewed.code === 0 &&
    existsSync(page) &&
    readFileSync(page, 'utf8').includes('exponential backoff'),
  viewed.err,
);

const off = cli(['pick', 'off']);
report(
  'pick off is saved and reported',
  off.code === 0 &&
    readJson(join(memoryDir, 'config.json')).pick?.enabled === false &&
    cli(['pick']).out.includes('pick     : off'),
);
cli(['pick', 'on']);
report('pick on turns it back on', cli(['pick']).out.includes('pick     : on'));

const useEnv = { ...baseEnv };
delete useEnv.CLAUDE_DB_URL;
const firstDb = join(home, 'first.db');
const secondDb = join(home, 'second.db');
const usedFirst = cli(['use', firstDb], { env: useEnv });
report(
  'use switches to a database it can reach and saves it',
  usedFirst.code === 0 &&
    usedFirst.out.includes('Connected. Using sqlite.') &&
    readJson(join(memoryDir, 'config.json')).database === firstDb,
  usedFirst.out + usedFirst.err,
);
cli(['remember', 'A rule kept in the first database'], { env: useEnv });
const usedSecond = cli(['use', secondDb], { env: useEnv });
report(
  'leaving a database that holds memory says how to move it',
  usedSecond.out.includes('still holds 1 observation'),
  usedSecond.out,
);
const unreachable = cli(['use', 'redis://localhost:6379'], { env: useEnv });
report(
  'use refuses a database it cannot reach and changes nothing',
  unreachable.code === 1 &&
    unreachable.err.includes('Nothing was changed') &&
    readJson(join(memoryDir, 'config.json')).database === secondDb,
  unreachable.err,
);
report('use without a database explains its usage', cli(['use'], { env: useEnv }).code === 1);
