import { isSymbol, isWord, symbolsGreppedIn } from '../../dist/hooks/grep-symbols.js';
import { check } from '../lib/check.mjs';

export default async function run() {
  const caught = (command) => symbolsGreppedIn(command).length > 0;

  check('a recursive symbol grep is caught', caught('grep -rn "cmdReembed" src/'));
  check('a symbol grep with a path is caught', caught('grep -n "batchSize" src/config/schema.ts'));
  check('-v filters output, so it is left alone', !caught('grep -v ExperimentalWarning'));
  check('a piped grep is output filtering', !caught('npm test 2>&1 | grep -i "batchSize"'));
  check("plain text is grep's job", !caught('grep -rn "not a supported language" src/'));
  check('a lowercase word is a candidate for the graph gate', caught('grep -rn "provider" src/'));
  check("a word under four chars stays grep's job", !caught('grep -rn "get" src/'));
  check('a regex is not a symbol', !caught('grep -rnE "^FAIL|passed" src/'));
  check('a command without grep is ignored', !caught('ls -la && cat package.json'));
  check('git grep searches the tree without -r or a path', caught('git grep -n "findUsages"'));
  check('a piped grep after git is still output filtering', !caught('git log | grep memory'));
  check(
    'every symbol in one command is reported',
    symbolsGreppedIn('grep -rn "cmdReembed" src/ && grep -rn "eachObservation" src/').join(',') ===
      'cmdReembed,eachObservation',
  );

  check('the Grep tool pattern path recognises a symbol', isSymbol('embedObservations'));
  check('a plain word is not a structured symbol', !isSymbol('provider'));
  check('a plain word is a word', isWord('provider'));
  check('a structured symbol is not a plain word', !isWord('cmdReembed'));
  check('a short word is not a word', !isWord('get'));
  check('the Grep tool pattern path ignores a regex', !isSymbol('^FAIL|passed'));
}
