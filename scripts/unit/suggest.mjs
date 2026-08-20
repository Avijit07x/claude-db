import { nearest } from '../../dist/graph/index.js';
import { check } from '../lib/check.mjs';

export default async function run() {
  // The real graph shape: real symbols alongside the one-letter locals a scan collects.
  const names = [
    'HOOKS',
    'hooks',
    'hook',
    'hookCommand',
    'HookMatcher',
    'runHook',
    'embedObservations',
    'observationId',
    'findSymbols',
    'formatUsages',
    'e',
    'n',
    'ts',
    'ok',
    'sh',
    'get',
  ];

  const hooks = nearest(names, 'HOOK_EVENTS');
  check('a misremembered name finds its family', hooks.includes('HOOKS'), hooks.join(', '));
  check(
    'one and two letter locals never surface',
    !hooks.some((n) => n.length < 3),
    hooks.join(', '),
  );

  const typo = nearest(names, 'embedObservation');
  check(
    'a singular/plural typo ranks the real symbol first',
    typo[0] === 'embedObservations',
    typo[0],
  );

  const cased = nearest(names, 'find_symbols');
  check('snake_case finds camelCase first', cased[0] === 'findSymbols', cased[0]);

  check('an unrelated name suggests nothing', nearest(names, 'zzzqqxWidget').length === 0);
  check(
    'incidental substrings are not suggestions',
    !nearest(names, 'zzzqqxWidget').includes('get'),
  );
  check('the symbol itself is never suggested', !nearest(names, 'HOOKS').includes('HOOKS'));
}
