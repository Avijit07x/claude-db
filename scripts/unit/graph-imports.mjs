import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { check } from '../lib/check.mjs';
import { scanRepository } from '../../dist/graph/scan/index.js';
import { scan } from '../lib/graph-scan.mjs';
import { ecmascriptResolver } from '../../dist/graph/modules/ecmascript/resolver.js';
import { formatGraph } from '../../dist/graph/query/format.js';

export default async function run() {
  const lib = 'export function alpha() { return 1; }\nexport type Shape = { a: number };\n';

  {
    const root = mkdtempSync(join(tmpdir(), 'alias-'));
    const put = (path, text) => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    };
    put(
      'tsconfig.json',
      '{\n  // root alias\n  "compilerOptions": { "baseUrl": ".", "paths": { "~/*": ["src/*"], },\n  /* trailing */ },\n}\n',
    );
    put('src/a.ts', 'export function alpha() { return 1; }\n');
    put('src/b.ts', "import { alpha } from '~/a';\nalpha();\n");
    put('site/tsconfig.json', '{ "compilerOptions": { "paths": { "@/*": ["./*"] } } }\n');
    put('site/components/Card.ts', 'export function Card() { return 1; }\n');
    put('site/page.ts', "import { Card } from '@/components/Card';\n");
    put('other/x.ts', "import { alpha } from '~/a';\n");
    put('site/own.ts', "import { alpha } from '~/a';\n");
    const git = (...args) =>
      execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
        stdio: 'ignore',
      });
    git('init', '-q');
    git('add', '-A');
    git('commit', '-qm', 'seed');

    const result = await scanRepository({ root, project: root });
    const bound = (file, name) =>
      result.edges.find(
        (edge) => edge.relation === 'imports' && edge.file === file && edge.dstName === name,
      );
    check(
      'an aliased import binds to its file and is certain',
      bound('src/b.ts', 'alpha')?.confidence === 'EXTRACTED' &&
        bound('site/page.ts', 'Card')?.confidence === 'EXTRACTED',
      JSON.stringify([bound('src/b.ts', 'alpha'), bound('site/page.ts', 'Card')]),
    );
    check(
      'a folder with no tsconfig of its own uses the one above it',
      bound('other/x.ts', 'alpha')?.confidence === 'EXTRACTED',
    );
    check(
      'a folder with its own paths does not borrow the root ones, and an unresolved alias is not guessed',
      bound('site/own.ts', 'alpha')?.dstId === '',
      bound('site/own.ts', 'alpha')?.dstId,
    );
    rmSync(root, { recursive: true, force: true });
  }

  {
    const root = mkdtempSync(join(tmpdir(), 'self-'));
    const put = (path, text) => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    };
    put('tsconfig.json', '{ "compilerOptions": { "paths": { "pkg": ["./src/index.ts"] } } }\n');
    put('src/index.ts', "export { create } from './create';\n");
    put('src/create.ts', 'export function create() { return 1; }\n');
    put('tests/a.test.ts', "import { create } from 'pkg';\ncreate();\n");
    put('tests/b.test.ts', "import { join } from 'node:path';\njoin('a');\n");
    const git = (...args) =>
      execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
        stdio: 'ignore',
      });
    git('init', '-q');
    git('add', '-A');
    git('commit', '-qm', 'seed');
    const result = await scanRepository({ root, project: root });
    const edge = (file, relation, name) =>
      result.edges.find((e) => e.file === file && e.relation === relation && e.dstName === name);
    check(
      'a package name that points at the repo own barrel keeps its links, for imports and calls',
      edge('tests/a.test.ts', 'imports', 'create')?.dstId !== '' &&
        edge('tests/a.test.ts', 'calls', 'create')?.dstId !== '',
      JSON.stringify([edge('tests/a.test.ts', 'imports', 'create')]),
    );
    check(
      'a real package import has no link, but its calls keep the old name matching',
      edge('tests/b.test.ts', 'imports', 'join')?.dstId === '',
    );
    rmSync(root, { recursive: true, force: true });
  }

  {
    const root = mkdtempSync(join(tmpdir(), 'conditions-'));
    const put = (path, text) => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    };
    put(
      'package.json',
      JSON.stringify({
        name: 'pkg',
        exports: { '.': { '@src': './src/index.ts', default: './dist/index.js' } },
      }),
    );
    put('tsconfig.json', '{ "compilerOptions": { "customConditions": ["@src"] } }\n');
    put('src/index.ts', 'export function make() { return 1; }\n');
    put('tests/a.test.ts', "import { make } from 'pkg';\nmake();\n");
    const git = (...args) =>
      execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
        stdio: 'ignore',
      });
    git('init', '-q');
    git('add', '-A');
    git('commit', '-qm', 'seed');
    const result = await scanRepository({ root, project: root });
    const edge = result.edges.find(
      (e) => e.file === 'tests/a.test.ts' && e.relation === 'imports' && e.dstName === 'make',
    );
    check(
      'a package that maps to its source through a custom condition named in tsconfig is followed',
      edge?.dstId !== '' && edge?.confidence === 'EXTRACTED',
      JSON.stringify(edge),
    );
    rmSync(root, { recursive: true, force: true });
  }

  {
    const files = new Set(['src/a.ts', 'src/lib/index.ts']);
    const { resolve } = ecmascriptResolver('/nowhere', files);
    check(
      'module resolution works from the importing file and ignores packages',
      resolve('src/deep/x.ts', '../a') === 'src/a.ts' &&
        resolve('src/x.ts', './lib') === 'src/lib/index.ts' &&
        resolve('src/x.ts', 'pkg') === null &&
        resolve('src/x.ts', './nope') === null,
    );
  }

  {
    const { symbols, edges } = scan({
      'src/a.ts': lib,
      'src/b.ts': "import { alpha } from './a';\nalpha();\n",
      'src/c.ts': "export { alpha } from './a';\n",
    });
    const alpha = symbols.find((symbol) => symbol.name === 'alpha');
    const answer = {
      mode: 'usages',
      symbol: 'alpha',
      definitions: [alpha],
      inbound: edges.filter((edge) => edge.dstId === alpha.id),
      outbound: [],
      path: [],
      refreshed: [],
      empty: false,
      suggestions: [],
    };
    const text = formatGraph(answer, '/p');
    check(
      'usages prints an Imported by group beside Referenced by',
      text.includes('Referenced by (1):') &&
        text.includes('Imported by (2):') &&
        text.includes('<-- src/b.ts:1') &&
        text.includes('<-- src/c.ts:1'),
      text,
    );
    check(
      'and says nothing about untracked languages for TypeScript',
      !text.includes('not tracked'),
    );
    const untracked = { ...alpha, lang: 'ruby' };
    check(
      'a language without import tracking says so',
      formatGraph({ ...answer, definitions: [untracked] }, '/p').includes(
        'Imports are not tracked yet for: ruby',
      ),
    );
  }
}
