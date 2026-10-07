import { GRAMMARS, PLATFORM, hasGrammar } from '../../graph/grammars.js';
import { languageNames } from '../../graph/index.js';

const SHIPPED =
  'Grammars ship with claude-db for each platform, so there is nothing to add or remove.';

const stateOf = (name: string): string =>
  hasGrammar(name)
    ? 'read with real syntax'
    : `read by pattern: no grammar for ${PLATFORM} in this install`;

function listLanguages(): void {
  console.log(`read with real syntax: ${languageNames()}`);
  for (const name of GRAMMARS) console.log(`  ${name.padEnd(8)} ${stateOf(name)}`);
  if (GRAMMARS.some((name) => !hasGrammar(name))) {
    console.log('Reinstall claude-db to add the grammars for this platform.');
  }
}

export function cmdLanguages(argv: (string | undefined)[]): void {
  const [action] = argv.filter((arg): arg is string => arg !== undefined);
  if (action === undefined || action === 'list') return listLanguages();
  if (action === 'add' || action === 'remove') return console.log(SHIPPED);
  throw new Error('usage: claude-db languages [list]');
}
