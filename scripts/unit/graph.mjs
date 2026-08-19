import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { check } from '../lib/check.mjs';
import { newRepo } from '../lib/repo.mjs';
import { scanRepository } from '../../dist/graph/index.js';
import { languageFor, LANGUAGES } from '../../dist/graph/index.js';

export default async function run() {
  const { repo, git } = newRepo('graph-');
  mkdirSync(join(repo, 'src'));

  writeFileSync(
    join(repo, 'src', 'widget.ts'),
    [
      "import { helper } from './helper.js';",
      '',
      'export class Widget extends Base {',
      '  render() {',
      '    return helper(1);',
      '  }',
      '}',
      '',
      'export function build() {',
      '  return new Widget();',
      '}',
      '',
      'export interface Shape {',
      '  a: number;',
      '}',
      '',
      'export const NAME = 1;',
    ].join('\n'),
  );
  writeFileSync(join(repo, 'src', 'helper.ts'), 'export function helper(n) {\n  return n;\n}\n');
  writeFileSync(join(repo, 'notes.md'), '# not code\n');
  git('add', '-A');
  git('commit', '-qm', 'seed');

  const scan = scanRepository({ root: repo, project: repo, known: new Map() });
  const named = (name) => scan.symbols.filter((s) => s.name === name);

  check('scan finds a class', named('Widget')[0]?.kind === 'class', named('Widget')[0]?.kind);
  check('scan finds a function', named('build')[0]?.kind === 'function');
  check('scan finds a method', named('render')[0]?.kind === 'method');
  check('scan finds an interface', named('Shape')[0]?.kind === 'interface');
  check('scan finds a const', named('NAME')[0]?.kind === 'const');
  check(
    'a symbol records where it lives',
    named('helper')[0]?.file === 'src/helper.ts',
    named('helper')[0]?.file,
  );
  check('a non-source file is not scanned', !scan.symbols.some((s) => s.file === 'notes.md'));

  const edgeTo = (name) => scan.edges.filter((e) => e.dstName === name);
  check(
    'a call becomes an edge',
    edgeTo('helper').some((e) => e.relation === 'calls'),
  );
  check(
    'an extends clause becomes an edge',
    edgeTo('Base').some((e) => e.relation === 'extends'),
  );
  check(
    'an import becomes an edge',
    scan.edges.some((e) => e.relation === 'imports'),
  );

  const helperEdge = edgeTo('helper').find((e) => e.relation === 'calls');
  check(
    'a call is attributed to the enclosing function, not the file',
    helperEdge?.srcName === 'render',
    helperEdge?.srcName,
  );
  check(
    'a cross-file match is INFERRED, not claimed as read',
    helperEdge?.confidence === 'INFERRED' && helperEdge?.score < 1,
    `${helperEdge?.confidence} ${helperEdge?.score}`,
  );

  const defines = scan.edges.filter((e) => e.relation === 'defines');
  check(
    'a class defines its methods, so a path can cross the boundary',
    defines.some((e) => e.srcName === 'Widget' && e.dstName === 'render'),
    defines.map((e) => `${e.srcName}>${e.dstName}`).join(','),
  );
  check(
    'a containment edge is read from the syntax, not guessed',
    defines.find((e) => e.dstName === 'render')?.confidence === 'EXTRACTED',
  );

  const external = scan.edges.find((e) => e.dstName === 'Base');
  check(
    'a target with no definition here carries no id',
    external?.dstId === '',
    String(external?.dstId),
  );

  const again = scanRepository({ root: repo, project: repo, known: new Map() });
  check(
    'ids are content-derived, so a rescan replaces rather than duplicates',
    again.symbols[0]?.id === scan.symbols[0]?.id,
  );

  const hashes = new Map(scan.files.map((f) => [f.path, f.hash]));
  const cached = scanRepository({ root: repo, project: repo, known: hashes });
  check('an unchanged file is skipped', cached.changed.length === 0, cached.skipped);

  writeFileSync(
    join(repo, 'src', 'helper.ts'),
    'export function helper(n) {\n  return n + 1;\n}\n',
  );
  const partial = scanRepository({ root: repo, project: repo, known: hashes });
  check(
    'only the changed file is re-parsed',
    partial.changed.length === 1 && partial.changed[0] === 'src/helper.ts',
    partial.changed.join(','),
  );

  writeFileSync(join(repo, 'src', 'fresh.ts'), 'export function fresh() {}\n');
  const untracked = scanRepository({ root: repo, project: repo, known: new Map() });
  check(
    'a never-committed file is scanned',
    untracked.symbols.some((s) => s.name === 'fresh'),
  );

  check(
    'every language maps at least one extension',
    LANGUAGES.every((l) => l.extensions.length > 0),
  );
  check('a known extension resolves to a language', languageFor('a.ts')?.label === 'typescript');
  check('an unknown extension resolves to nothing', languageFor('a.zzz') === null);

  rmSync(repo, { recursive: true, force: true });
}
