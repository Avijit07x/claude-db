import { extractFile } from '../../dist/graph/scan/extract.js';
import { languageFor } from '../../dist/graph/languages/index.js';
import { ruby } from '../../dist/graph/languages/ruby.js';
import { python } from '../../dist/graph/languages/python.js';
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

  const java = basicFor(
    'Patient.java',
    'public class Patient extends BaseRecord {\n' +
      '    public List<Survey> findSurveys() {\n' +
      '        return SurveyRepository.forPatient(this);\n' +
      '    }\n' +
      '}\n',
  );
  const named = (result, name) => result.symbols.find((s) => s.name === name);
  check('a language with no grammar pack still parses', java.symbols.length > 0);
  check('java class is a symbol', named(java, 'Patient')?.kind === 'class');
  check('java method is a symbol', named(java, 'findSurveys')?.kind === 'function');
  check('the symbol carries the real language label', named(java, 'Patient')?.lang === 'java');
  check(
    'a call inside it becomes a weak reference',
    java.references.some((r) => r.name === 'forPatient' && r.weak === true),
    JSON.stringify(java.references.map((r) => r.name)),
  );
  check(
    'the weak reference is attributed to the enclosing declaration',
    java.references.find((r) => r.name === 'forPatient')?.from?.name === 'findSurveys',
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

  check('an unknown extension stays unsupported', languageFor('notes.txt') === null);
}
