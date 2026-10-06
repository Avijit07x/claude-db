import { homedir, tmpdir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';

const offset = relative(resolve(tmpdir()), resolve(homedir()));
const insideTemp = offset !== '' && !offset.startsWith('..') && !isAbsolute(offset);

if (process.env.CLAUDE_DB_ISOLATED !== '1' || !insideTemp) {
  console.error(
    'Refusing to run: this script rewrites files under HOME. Start it through runIsolated (npm run unit).',
  );
  process.exit(2);
}
