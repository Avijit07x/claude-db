import { isSymbol, symbolsGreppedIn } from '../../dist/hooks/grep-symbols.js';
import { check } from '../lib/check.mjs';

export default async function run() {
  const caught = (command) => symbolsGreppedIn(command).length > 0;

  check('a recursive symbol grep is caught', caught('grep -rn "cmdReembed" src/'));
  check('a symbol grep with a path is caught', caught('grep -n "batchSize" src/config/schema.ts'));
  check('-v filters output, so it is left alone', !caught('grep -v ExperimentalWarning'));
  check('a piped grep is output filtering', !caught('npm test 2>&1 | grep -i "batchSize"'));
  check("plain text is grep's job", !caught('grep -rn "not a supported language" src/'));
  check('lowercase words are not symbols', !caught('grep -rn "provider" src/'));
  check('a regex is not a symbol', !caught('grep -rnE "^FAIL|passed" src/'));
  check('a command without grep is ignored', !caught('ls -la && cat package.json'));
  check(
    'every symbol in one command is reported',
    symbolsGreppedIn('grep -rn "cmdReembed" src/ && grep -rn "eachObservation" src/').join(',') ===
      'cmdReembed,eachObservation',
  );

  check('the Grep tool pattern path recognises a symbol', isSymbol('embedObservations'));
  check('the Grep tool pattern path ignores a plain word', !isSymbol('provider'));
  check('the Grep tool pattern path ignores a regex', !isSymbol('^FAIL|passed'));
}
