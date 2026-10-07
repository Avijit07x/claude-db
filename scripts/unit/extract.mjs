import { extractFile, symbolId } from '../../dist/graph/scan/extract.js';
import { languageFor } from '../../dist/graph/languages/index.js';
import { ruby } from '../../dist/graph/languages/ruby.js';
import { python } from '../../dist/graph/languages/python.js';
import { javascript, tsx } from '../../dist/graph/languages/ecmascript.js';
import { check } from '../lib/check.mjs';

export default async function run() {
  const rails = `class Patient < ApplicationRecord
  include Searchable
  def surveys
    Survey.where(patient: self)
  end
  def self.recent
    order(created_at: :desc)
  end
  def valid_for_survey?
    true
  end
end
module Billing
end
`;
  const rb = extractFile(
    { path: 'app/models/patient.rb', spec: ruby, source: rails, hash: 'x' },
    '/p',
  );
  const symbol = (name) => rb.symbols.find((s) => s.name === name);
  check('ruby class is a symbol', symbol('Patient')?.kind === 'class');
  check('ruby module is a symbol', symbol('Billing')?.kind === 'class');
  check('ruby instance method is a symbol', symbol('surveys')?.kind === 'method');
  check('ruby singleton method is a symbol', symbol('recent')?.kind === 'method');
  check('ruby predicate method keeps its question mark', !!symbol('valid_for_survey?'));

  const ref = (name, relation) =>
    rb.references.find((r) => r.name === name && r.relation === relation);
  check(
    'ruby superclass extracts as a clean extends edge',
    !!ref('ApplicationRecord', 'extends'),
    JSON.stringify(rb.references.filter((r) => r.relation === 'extends').map((r) => r.name)),
  );
  check('ruby method call is a calls edge', !!ref('where', 'calls'));
  check('ruby receiver constant is a reference', !!ref('Survey', 'references'));
  check('ruby include is a call', !!ref('include', 'calls'));
  check(
    'the calls edge from surveys attributes to the enclosing method',
    ref('where', 'calls')?.from?.name === 'surveys',
  );

  const py = extractFile(
    { path: 'a.py', spec: python, source: 'class Child(Base):\n    pass\n', hash: 'x' },
    '/p',
  );
  check(
    'python superclass is Base, not "(Base)"',
    !!py.references.find((r) => r.name === 'Base' && r.relation === 'extends'),
    JSON.stringify(py.references.map((r) => `${r.relation}:${r.name}`)),
  );

  const basicFor = (path, source) =>
    extractFile({ path, spec: languageFor(path), source, hash: 'x' }, '/p');

  const scala = basicFor(
    'Patient.scala',
    'class Patient extends BaseRecord {\n' +
      '  def findSurveys(): List[Survey] = {\n' +
      '    SurveyRepository.forPatient(this)\n' +
      '  }\n' +
      '}\n',
  );
  const named = (result, name) => result.symbols.find((s) => s.name === name);
  check('a language with no grammar pack still parses', scala.symbols.length > 0);
  check('scala class is a symbol', named(scala, 'Patient')?.kind === 'class');
  check('scala method is a symbol', named(scala, 'findSurveys')?.kind === 'function');
  check('the symbol carries the real language label', named(scala, 'Patient')?.lang === 'scala');
  check(
    'a call inside it becomes a weak reference',
    scala.references.some((r) => r.name === 'forPatient' && r.weak === true),
    JSON.stringify(scala.references.map((r) => r.name)),
  );
  check(
    'the weak reference is attributed to the enclosing declaration',
    scala.references.find((r) => r.name === 'forPatient')?.from?.name === 'findSurveys',
  );

  const minifiedSource =
    Array.from({ length: 3000 }, (_, i) => `function f${i}(){return 1}`).join(';') +
    ';var apiKey = "sk-abcdefghijklmnopqrstuvwxyz012345";';
  const began = Date.now();
  const minified = basicFor('bundle.min.js', minifiedSource);
  check(
    'a minified file with one very long line is read in under a second',
    Date.now() - began < 1000 && minified.symbols.length >= 3000,
    `${Date.now() - began} ms`,
  );
  check(
    'and no signature carries the secret on that line',
    minified.symbols.every((symbol) => !symbol.signature.includes('sk-abcdefghijkl')),
  );

  const swift = basicFor(
    'model.swift',
    'struct Patient: Identifiable {\n    func surveys() -> [Survey] {\n        return []\n    }\n}\n',
  );
  check('swift struct is a symbol', named(swift, 'Patient')?.kind === 'class');
  check('swift func is a symbol', named(swift, 'surveys')?.kind === 'function');

  const elixir = basicFor('billing.ex', 'defmodule Billing do\n  def charge(p) do\n  end\nend\n');
  check('elixir defmodule is a symbol', named(elixir, 'Billing')?.kind === 'class');
  check('elixir def is a symbol', named(elixir, 'charge')?.kind === 'function');

  const shell = basicFor('deploy.sh', '#!/bin/bash\nbuild_image() {\n  echo hi\n}\n');
  check('a shell function is a symbol', named(shell, 'build_image')?.kind === 'function');

  const control = basicFor(
    'guard.c',
    'int main(void) {\n    if (ready) {\n        while (x) {\n            run(x);\n        }\n    }\n}\n',
  );
  check('a C function is a symbol', named(control, 'main')?.kind === 'function');
  check(
    'control flow is never mistaken for a declaration',
    !named(control, 'if') && !named(control, 'while'),
    JSON.stringify(control.symbols.map((s) => s.name)),
  );

  const anonymous = basicFor('types.h', 'typedef struct {\n    int id;\n} Patient;\n');
  check(
    'an anonymous typedef does not become a symbol named "struct"',
    !named(anonymous, 'struct'),
    JSON.stringify(anonymous.symbols.map((s) => s.name)),
  );

  const screen = `import { Card } from './Card';

export function Screen() {
  const label = title();
  return (
    <div className="page">
      <Card>
        <Button onPress={save} />
      </Card>
      <span>{label}</span>
    </div>
  );
}
`;
  const jsx = extractFile({ path: 'src/Screen.tsx', spec: tsx, source: screen, hash: 'x' }, '/p');
  const rendered = (name) =>
    jsx.references.find((r) => r.name === name && r.relation === 'references');

  check('a rendered component with children is an edge', !!rendered('Card'));
  check('a self-closing component is an edge', !!rendered('Button'));
  check(
    'host elements are not mistaken for components',
    !rendered('div') && !rendered('span'),
    JSON.stringify(jsx.references.filter((r) => r.relation === 'references').map((r) => r.name)),
  );
  check(
    'a rendered component attributes to the enclosing function',
    rendered('Card')?.from?.name === 'Screen',
  );
  check('calls in a tsx file still extract', !!jsx.references.find((r) => r.name === 'title'));

  const jsxFile = extractFile(
    { path: 'src/Screen.jsx', spec: javascript, source: screen, hash: 'x' },
    '/p',
  );
  check(
    'a component rendered in a .jsx file is an edge too',
    !!jsxFile.references.find((r) => r.name === 'Card' && r.relation === 'references'),
    JSON.stringify(jsxFile.references.map((r) => r.name)),
  );
  check(
    '.jsx resolves to the spec that carries the jsx rules',
    languageFor('a.jsx') === javascript,
  );

  const dup = `export function first() {
  const total = 1;
  return total;
}

export function second() {
  const total = 2;
  return total;
}
`;
  const dupes = extractFile(
    { path: 'src/dup.ts', spec: languageFor('a.ts'), source: dup, hash: 'x' },
    '/p',
  ).symbols.filter((s) => s.name === 'total');
  check(
    'two declarations sharing a name and kind in one file keep separate ids',
    dupes.length === 2 && new Set(dupes.map((s) => s.id)).size === 2,
    `${dupes.length} symbols, ${new Set(dupes.map((s) => s.id)).size} ids`,
  );
  check(
    'the first occurrence keeps the id it had before, so existing graphs do not churn',
    symbolId('/p', 'src/dup.ts', 'total', 'const') === dupes[0].id,
  );

  const typed = `interface Props { a: number }
type Id = string;
export function use(p: Props): Id {
  const m: Map<Id, Props> = new Map();
  return m;
}
`;
  const types = extractFile(
    { path: 'src/types.ts', spec: languageFor('a.ts'), source: typed, hash: 'x' },
    '/p',
  );
  const typeRef = (name) =>
    types.references.filter((r) => r.name === name && r.relation === 'references');
  check('a type in argument position is an edge', typeRef('Props').length > 0);
  check('a type in return position is an edge', typeRef('Id').length > 0);
  check(
    'a type argument inside a generic is an edge',
    typeRef('Map').length > 0 && typeRef('Id').length > 1,
  );
  check(
    'declaring an interface or alias is not a reference to itself',
    !typeRef('Props').some((r) => r.line === 1) && !typeRef('Id').some((r) => r.line === 2),
    JSON.stringify(
      types.references.filter((r) => r.relation === 'references').map((r) => r.name + '@' + r.line),
    ),
  );

  check('an unknown extension stays unsupported', languageFor('notes.txt') === null);
}
