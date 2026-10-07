import { check } from '../lib/check.mjs';
import { edgesTo, project, symbolNamed } from '../lib/graph-scan.mjs';
import { formatGraph } from '../../dist/graph/query/format.js';
import { jvmResolver, packageName } from '../../dist/graph/modules/jvm/packages.js';

export default async function run() {
  {
    const { root, done } = project({
      'weird/dir/One.java':
        '/* license header\n package fake.words; */\npackage real.pkg;\n\npublic class One {}\n',
      'elsewhere/Two.java': 'package real.pkg.sub;\n\nclass Two {}\n',
    });
    const resolver = jvmResolver(root, new Set(['weird/dir/One.java', 'elsewhere/Two.java']), [
      '.java',
    ]);
    check(
      'the package comes from the package line, not from the folder, and a comment does not count',
      resolver.unit('weird/dir/One.java') === 'real.pkg' &&
        resolver.resolve('x', 'real.pkg.One') === 'real.pkg' &&
        resolver.resolve('x', 'real.pkg.sub.Two') === 'real.pkg.sub' &&
        resolver.resolve('x', 'java.util.List') === null &&
        packageName('class A {}') === '(default)',
    );
    done();
  }

  {
    const { root, symbols, edges, done } = project({
      'src/m/Thing.java': 'package m;\n\npublic class Thing {\n  public void work() {}\n}\n',
      'src/u/Use.java': 'package u;\n\nimport m.Thing;\n\npublic class Use {\n  Thing t;\n}\n',
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
      'usages for a java class lists the files that import it and does not say imports are not tracked',
      text.includes('Imported by (1)') && !text.includes('not tracked'),
      text,
    );
    done();
  }
}
