import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { check } from '../lib/check.mjs';
import { newRepo } from '../lib/repo.mjs';
import { createStore } from '../../dist/store/index.js';
import { formatGraph, queryGraph, refreshGraph } from '../../dist/graph/index.js';

const FILES = {
  'src/router.ts': 'export type AnyRouter = { a: 1 };\nexport function build() { return 1; }\n',
  'src/index.ts': [
    "export type { AnyRouter as AnyTRPCRouter } from './router';",
    "export { build as makeBuild } from './router';",
  ].join('\n'),
  'src/app.ts': [
    "import type { AnyTRPCRouter } from './index';",
    "import { makeBuild } from './index';",
    'export const x: AnyTRPCRouter = makeBuild();',
  ].join('\n'),
  'src/own.ts': 'function helper() { return 1; }\nexport { helper as publicHelper };\n',
  'src/use.ts': "import { publicHelper } from './own';\npublicHelper();\n",
  'src/chain.ts':
    "import { publicHelper } from './own';\nexport { publicHelper as finalHelper };\n",
  'src/last.ts': "import { finalHelper } from './chain';\nfinalHelper();\n",
  'src/plain.ts':
    'export function stay() { return 1; }\nexport { stay };\nexport { stay as stay };\n',
  'src/button.ts': 'export default function Button() { return 1; }\n',
  'src/page.ts': "import Btn from './button';\nBtn();\n",
  'src/loop.ts': 'export function a() { return 1; }\nexport { a as b };\nexport { b as a };\n',
};

export default async function run() {
  const { repo, git } = newRepo('alias-');
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  }
  git('add', '-A');
  git('commit', '-qm', 'seed');

  const store = await createStore(join(mkdtempSync(join(tmpdir(), 'alias-db-')), 'memory.db'));
  await store.init();
  await refreshGraph(store, repo, repo);

  const usages = (symbol, mode = 'usages') => queryGraph(store, repo, { mode, symbol, limit: 50 });
  const files = (answer) => [...new Set(answer.inbound.map((edge) => edge.file))].sort().join();

  const symbols = await store.findSymbols({ project: repo, name: 'AnyTRPCRouter' });
  check(
    'an export under another name is a symbol of its own, with the export line as its signature',
    symbols.length === 1 &&
      symbols[0].file === 'src/index.ts' &&
      symbols[0].signature.includes('AnyRouter as AnyTRPCRouter'),
    JSON.stringify(symbols),
  );
  check(
    'a plain export, and an export under the same name, make no alias symbol',
    (await store.findSymbols({ project: repo, name: 'stay' })).length === 1,
  );

  const original = await usages('AnyRouter');
  check(
    'the original lists the alias and the files that import the public name',
    original.inbound.some(
      (edge) => edge.relation === 'aliases' && edge.srcName === 'AnyTRPCRouter',
    ) && files(original).includes('src/app.ts'),
    files(original),
  );
  check(
    'a re-exported function is followed the same way',
    files(await usages('build')).includes('src/app.ts'),
  );

  const local = await usages('helper');
  check(
    'a local alias reaches the importers, including through a second alias',
    files(local).includes('src/use.ts') && files(local).includes('src/last.ts'),
    files(local),
  );
  check(
    'an alias is not listed twice',
    new Set(local.inbound.map((edge) => edge.id)).size === local.inbound.length,
  );

  const publicName = await usages('publicHelper', 'explain');
  check(
    'asking for the public name finds its own users, and explain shows what it stands for',
    files(publicName).includes('src/use.ts') &&
      publicName.outbound.some((edge) => edge.relation === 'aliases' && edge.dstName === 'helper'),
    files(publicName),
  );
  check('the output names the alias relation', formatGraph(local, repo).includes('[aliases]'));

  const component = await usages('Button');
  check(
    'a default import under another name is found when asking for the declaration',
    files(component).includes('src/page.ts'),
    files(component),
  );

  const cycle = await usages('a');
  check(
    'two names that alias each other do not loop',
    cycle.inbound.length >= 1,
    String(cycle.inbound.length),
  );

  writeFileSync(
    join(repo, 'src/use.ts'),
    "import { publicHelper } from './own';\npublicHelper();\npublicHelper();\n",
  );
  await refreshGraph(store, repo, repo);
  const again = await usages('helper');
  check(
    'after a file changes and the graph refreshes, the answer has no duplicates and keeps the alias',
    new Set(again.inbound.map((edge) => edge.id)).size === again.inbound.length &&
      files(again).includes('src/last.ts'),
    files(again),
  );
  await store.close?.();
}
