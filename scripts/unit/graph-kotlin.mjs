import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check } from '../lib/check.mjs';
import { edgesTo, project, symbolNamed } from '../lib/graph-scan.mjs';
import { formatGraph } from '../../dist/graph/query/format.js';
import { languageFor } from '../../dist/graph/languages/index.js';
import { isTracked } from '../../dist/graph/modules/registry.js';

export default async function run() {
  check(
    'kotlin is read with real syntax when its grammar is present',
    languageFor('A.kt')?.basic !== true && isTracked('kotlin'),
  );

  {
    const home = mkdtempSync(join(tmpdir(), 'languages-'));
    const cli = new URL('../../dist/cli/index.js', import.meta.url).pathname;
    const listed = spawnSync('node', [cli, 'languages'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', HOME: home },
    });
    check(
      'the languages command says how each grammar language is read',
      listed.status === 0 &&
        listed.stdout.includes('read with real syntax: typescript') &&
        listed.stdout.includes('kotlin     read with real syntax') &&
        listed.stdout.includes('typescript read with real syntax, built in'),
      listed.stdout + listed.stderr,
    );
    const added = spawnSync('node', [cli, 'languages', 'add', 'kotlin'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', HOME: home },
    });
    check(
      'languages add downloads nothing and says grammars ship with claude-db',
      added.status === 0 && added.stdout.includes('nothing to add or remove'),
      added.stdout + added.stderr,
    );
    rmSync(home, { recursive: true, force: true });
  }

  {
    const { root, symbols, edges, done } = project({
      'src/m/Thing.kt': 'package m\n\nclass Thing {\n  fun work() {}\n}\n',
      'src/u/Use.kt': 'package u\n\nimport m.Thing\n\nclass Use(val t: Thing)\n',
    });
    const target = symbolNamed(symbols, 'Thing');
    const answer = {
      mode: 'usages',
      symbol: 'Thing',
      definitions: [target],
      inbound: edgesTo(edges, target),
      outbound: [],
      path: [],
      refreshed: [],
      empty: false,
      suggestions: [],
    };
    const text = formatGraph(answer, root);
    check(
      'usages for a kotlin class lists the files that import it and does not say imports are not tracked',
      text.includes('Imported by (1)') && !text.includes('not tracked'),
      text,
    );
    done();
  }
}
