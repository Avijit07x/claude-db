import { check } from '../lib/check.mjs';
import { edgesTo, project, symbolNamed } from '../lib/graph-scan.mjs';
import { formatGraph } from '../../dist/graph/query/format.js';

const CARGO = '[package]\nname = "app"\nversion = "0.1.0"\n';

export default async function run() {
  {
    const { root, symbols, edges, done } = project({
      'Cargo.toml': CARGO,
      'src/lib.rs': 'mod util;\n',
      'src/util.rs': 'pub fn helper() {}\n',
      'src/main.rs': 'use app::util::helper;\n\nfn go() {\n    helper();\n}\n',
    });
    const target = symbolNamed(symbols, 'helper');
    const answer = {
      mode: 'usages',
      symbol: 'helper',
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
      'usages for a rust symbol lists the files that import it and no longer says imports are not tracked',
      text.includes('Imported by (1)') && !text.includes('not tracked'),
      text,
    );
    done();
  }
}
