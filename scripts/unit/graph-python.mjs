import { check } from '../lib/check.mjs';
import { edgesTo, scan, symbolNamed } from '../lib/graph-scan.mjs';
import { pythonResolver } from '../../dist/graph/modules/python/resolver.js';
import { formatGraph } from '../../dist/graph/query/format.js';

export default async function run() {
  {
    const files = new Set([
      'pkg/__init__.py',
      'pkg/a.py',
      'pkg/sub/__init__.py',
      'pkg/sub/b.py',
      'top.py',
    ]);
    const { resolve, child } = pythonResolver('/nowhere', files);
    check(
      'dots count folders up from the importing file, and past the repository root finds nothing',
      resolve('pkg/sub/b.py', '..a') === 'pkg/a.py' &&
        resolve('pkg/sub/b.py', '.') === 'pkg/sub/__init__.py' &&
        resolve('pkg/a.py', '...x') === null &&
        resolve('top.py', '.top') === 'top.py',
    );
    check(
      'a package has submodules, a plain module does not',
      child('pkg/__init__.py', 'a') === 'pkg/a.py' &&
        child('pkg/__init__.py', 'sub') === 'pkg/sub/__init__.py' &&
        child('pkg/a.py', 'x') === null,
    );
  }

  {
    const { symbols, edges } = scan({
      'a.py': 'def run():\n    return 1\n',
      'main.py': 'from a import run\n\nrun()\n',
    });
    const run = symbolNamed(symbols, 'run');
    const answer = {
      mode: 'usages',
      symbol: 'run',
      definitions: [run],
      inbound: edgesTo(edges, run),
      outbound: [],
      path: [],
      refreshed: [],
      empty: false,
      suggestions: [],
    };
    const text = formatGraph(answer, '/p');
    check(
      'usages for a python symbol lists the files that import it and no longer says imports are not tracked',
      text.includes('Imported by (1)') && !text.includes('not tracked'),
      text,
    );
  }
}
