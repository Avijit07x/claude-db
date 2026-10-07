import { check } from '../lib/check.mjs';
import { extras, linkedUses, score } from '../bench-usages/compare.mjs';
import { codeOnly } from '../bench-usages/oracles/lexer.mjs';
import { parseUses } from '../bench-usages/oracles/rust-modules.mjs';
import { machine, regressions } from '../bench-usages/report.mjs';

const symbol = (id, name, file, kind = 'function') => ({ id, name, file, kind });
const edge = (fields) => ({ confidence: 'EXTRACTED', relation: 'calls', srcId: '', ...fields });

function lexer() {
  const rust = { rust: true, nested: true };
  const nested = '/*! docs\n* src/**/foo.rs\nuse x;\n*/\nuse y;';
  check(
    'a nested block comment hides everything up to its own end, not the first */',
    codeOnly(nested, rust).trimStart().startsWith('use y;') &&
      !codeOnly(nested, rust).includes('use x'),
    JSON.stringify(codeOnly(nested, rust)),
  );
  const raw = 'let s = r#"a " quote // no"#; use z;';
  check(
    'a raw string can hold a quote and // without ending the code',
    codeOnly(raw, rust).includes('use z;') && !codeOnly(raw, rust).includes('quote'),
    JSON.stringify(codeOnly(raw, rust)),
  );
  const life = "fn f<'a>(x: &'a str) -> char { '\"' }";
  check(
    'a lifetime is code and a char literal holding a quote is not',
    codeOnly(life, rust).includes("<'a>") && !codeOnly(life, rust).includes('"'),
    JSON.stringify(codeOnly(life, rust)),
  );
  const kotlin = 'val s = """a /* b\n c"""; /* d */ val t = 1';
  check(
    'a Kotlin triple-quoted string hides a comment opener, and lines and length stay the same',
    codeOnly(kotlin, { nested: true, tripleQuotes: true }).endsWith('val t = 1') &&
      codeOnly(kotlin, { nested: true, tripleQuotes: true }).length === kotlin.length &&
      codeOnly(kotlin, { nested: true, tripleQuotes: true }).split('\n').length === 2,
  );
}

function rustUses() {
  const leaves = parseUses('use crate::a::{\n    B,\n    c::D as E,\n    f::*,\n};\nuse ::g::H;\n');
  const show = JSON.stringify(leaves);
  check(
    'each name in a use tree keeps its own line',
    leaves.some((leaf) => leaf.path.join('::') === 'crate::a::B' && leaf.line === 2) &&
      leaves.some((leaf) => leaf.path.join('::') === 'crate::a::c::D' && leaf.alias === 'E'),
    show,
  );
  check(
    'a glob and a leading :: are read as paths',
    leaves.some((leaf) => leaf.path.join('::') === 'crate::a::f::*') &&
      leaves.some((leaf) => leaf.path.join('::') === 'g::H' && leaf.line === 6),
    show,
  );
}

function scoring() {
  const target = symbol('t', 'target', 'lib.ts');
  const alias = symbol('a', 'renamed', 'index.ts');
  const result = {
    symbols: [target, alias],
    edges: [
      edge({ relation: 'aliases', srcId: 'a', dstId: 't', file: 'index.ts', line: 1 }),
      edge({ dstId: 'a', file: 'app.ts', line: 3 }),
      edge({ relation: 'defines', dstId: 't', file: 'lib.ts', line: 9 }),
      edge({ dstId: 't', file: 'other.ts', line: 7 }),
    ],
  };
  const linked = linkedUses(result);
  check(
    'a use of a re-export alias counts as a use of the symbol it renames',
    linked.has('app.ts\x003\x00lib.ts\x00target'),
    JSON.stringify([...linked.keys()]),
  );

  const entries = [
    { bucket: 'reexport', file: 'index.ts', line: 1, target: 'lib.ts\0target', name: 'target' },
    { bucket: 'use', file: 'app.ts', line: 3, target: 'lib.ts\0target', name: 'target' },
    { bucket: 'use', file: 'app.ts', line: 3, target: 'lib.ts\0target', name: 'target' },
    { bucket: 'use', file: 'missing.ts', line: 1, target: 'lib.ts\0target', name: 'target' },
  ];
  const scored = score({ root: '/nowhere', entries, linked });
  check(
    'an expected line is counted once, and one the graph and text both miss is listed',
    scored.buckets.use.total === 2 && scored.buckets.use.linked === 1 && scored.missed.length === 1,
    JSON.stringify(scored.buckets),
  );
  const extra = extras(linked, scored.expected, (found) => found.name === 'target');
  check(
    'a structural defines link is not counted as a wrong use, an unconfirmed call is',
    extra.extra === 1 && extra.checked === 3,
    JSON.stringify(extra),
  );
}

function gate() {
  const base = {
    name: 'r',
    buckets: { use: { total: 100, linked: 99, covered: 100 } },
    extra: { checked: 100, extra: 1 },
    scanMs: 100,
  };
  const baseline = { machine: machine(), results: [base] };
  const same = regressions(baseline, [{ ...base }]);
  check('the same numbers pass the gate', same.problems.length === 0, same.problems.join('; '));

  const worse = regressions(baseline, [
    { ...base, buckets: { use: { total: 100, linked: 98, covered: 100 } } },
  ]);
  check('a drop of one point fails the gate', worse.problems.length === 1, worse.problems[0]);

  const slow = regressions(baseline, [{ ...base, scanMs: 200 }]);
  check('a scan twice as slow fails on the same machine', slow.problems.length === 1);

  const elsewhere = regressions({ ...baseline, machine: 'other' }, [{ ...base, scanMs: 200 }]);
  check('speed is not gated against another machine', elsewhere.problems.length === 0);

  const skipped = regressions(baseline, [{ name: 'r', skipped: 'no network' }]);
  check('a repository that could not be measured fails the gate', skipped.problems.length === 1);
}

export default async function run() {
  lexer();
  rustUses();
  scoring();
  gate();
}
