import { check } from '../lib/check.mjs';
import { edgesTo, project, symbolNamed } from '../lib/graph-scan.mjs';
import { packageName } from '../../dist/graph/modules/go/imports.js';
import { formatGraph } from '../../dist/graph/query/format.js';

const MOD = 'module example.com/app\n\ngo 1.22\n';

export default async function run() {
  check(
    'the name a package is imported under follows the last path segment, skipping a version',
    packageName('github.com/x/errors') === 'errors' &&
      packageName('github.com/x/y/v5') === 'y' &&
      packageName('gopkg.in/yaml.v3') === 'yaml' &&
      packageName('github.com/x/go-thing') === undefined,
  );

  {
    const { root, symbols, edges, done } = project({
      'go.mod': MOD,
      'util/util.go': 'package util\n\nfunc Do() {}\n',
      'main.go': 'package main\n\nimport "example.com/app/util"\n\nfunc main() {\n\tutil.Do()\n}\n',
    });
    const target = symbolNamed(symbols, 'Do');
    const answer = {
      mode: 'usages',
      symbol: 'Do',
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
      'usages for a go symbol lists who calls it and does not show an empty imported-by list',
      text.includes('Referenced by (1)') &&
        !text.includes('Imported by') &&
        !text.includes('not tracked'),
      text,
    );
    done();
  }
}
