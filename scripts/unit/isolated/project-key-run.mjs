import '../../lib/require-isolated.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { report } from '../../lib/isolated.mjs';
import { createContext } from '../../../dist/context.js';
import { remember } from '../../../dist/capture/index.js';
import { factToObservation } from '../../../dist/facts/model.js';
import { startFacts } from '../../../dist/facts/start.js';

mkdirSync(join(homedir(), '.claude-memory'), { recursive: true });
writeFileSync(
  join(homedir(), '.claude-memory', 'config.json'),
  JSON.stringify({ distill: { enabled: false }, pick: { enabled: false }, updates: 'off' }),
);

function clone(name, origin) {
  const folder = join(homedir(), 'clones', name);
  mkdirSync(folder, { recursive: true });
  execFileSync('git', ['-C', folder, 'init', '-q']);
  if (origin) execFileSync('git', ['-C', folder, 'remote', 'add', 'origin', origin]);
  return realpathSync(folder);
}

const TOKEN_URL =
  'https://x-access-token:ghp_abcdefghijklmnopqrstuvwxyz0123@github.com/acme/shop.git';
const laptop = clone('laptop-shop', 'git@github.com:acme/shop.git');
const mac = clone('mac-shop', TOKEN_URL);
const bare = clone('bare', null);
const stranger = clone('stranger', 'git@github.com:acme/other.git');
const KEY = 'github.com/acme/shop';

const open = () => createContext();
const titles = async (ctx, project) =>
  (await ctx.store.list({ project, limit: 100 })).map((obs) => obs.title).sort();

const first = await open();
try {
  await remember(first, { project: laptop, text: 'Laptop note: retries are 3', kind: 'decision' });
  await remember(first, { project: bare, text: 'Bare note: no remote here' });
  await remember(first, { project: stranger, text: 'Stranger note: other repository' });
} finally {
  await first.close();
}

const second = await open();
try {
  await remember(second, { project: mac, text: 'Mac note: delay is 2s', kind: 'decision' });
  const fromMac = await titles(second, mac);
  const fromLaptop = await titles(second, laptop);
  report(
    'two clones in different folders share one memory',
    fromMac.join('|') === 'Laptop note: retries are 3|Mac note: delay is 2s' &&
      fromLaptop.join('|') === fromMac.join('|'),
    `${fromMac.join('|')} // ${fromLaptop.join('|')}`,
  );
  report(
    'a folder with no remote and a different repository stay separate',
    (await titles(second, bare)).join('|') === 'Bare note: no remote here' &&
      (await titles(second, stranger)).join('|') === 'Stranger note: other repository',
  );

  const hits = await second.search.search({ text: 'retries', project: mac, limit: 5 });
  report(
    'search from the second clone finds the note written in the first',
    hits.some((hit) => hit.title === 'Laptop note: retries are 3'),
    hits.map((hit) => hit.title).join('|'),
  );

  const stored = await second.store.list({ project: KEY, limit: 100 });
  const everyProject = (await second.store.listProjects()).map((entry) => entry.project);
  report(
    'rows are saved under the key and no token reaches the database',
    stored.length === 2 &&
      everyProject.includes(KEY) &&
      !everyProject.some((name) => name.includes('ghp_') || name.includes('@')),
    everyProject.join(' '),
  );
} finally {
  await second.close();
}

execFileSync('git', [
  '-C',
  laptop,
  'remote',
  'set-url',
  'origin',
  'git@github.com:acme/shop-renamed.git',
]);
const third = await open();
try {
  await remember(third, { project: laptop, text: 'Laptop after the move', kind: 'decision' });
  const after = await titles(third, laptop);
  report(
    'after the remote moves, the folder keeps every earlier note and adds the new one',
    after.join('|') === 'Laptop after the move|Laptop note: retries are 3|Mac note: delay is 2s',
    after.join('|'),
  );
  report(
    'and the other clone still reads what it had',
    (await titles(third, mac)).includes('Laptop note: retries are 3'),
  );
} finally {
  await third.close();
}

const facts = await open();
try {
  const fact = (project, at) =>
    factToObservation(
      {
        key: 'retries',
        type: 'decision',
        scope: 'project',
        text: 'Retries are 3.',
        files: [],
        at,
        source: 't',
      },
      project,
    );
  await facts.store.insertObservations([fact(laptop, Date.now() - 1000), fact(mac, Date.now())]);
  const block = (await startFacts(facts, mac))?.block ?? '';
  report(
    'the same fact saved by two clones is shown once',
    block.split('Retries are 3.').length === 2,
    block,
  );
} finally {
  await facts.close();
}

const status = spawnSync(
  process.execPath,
  ['--no-warnings', new URL('../../../dist/cli/index.js', import.meta.url).pathname, 'status'],
  {
    cwd: mac,
    env: process.env,
    encoding: 'utf8',
  },
);
report(
  'status counts what the other clone saved as this project memory',
  /recorded : (?!never)/.test(status.stdout),
  status.stdout.split('\n').find((line) => line.startsWith('recorded')),
);
