import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { check } from '../lib/check.mjs';
import { CONFIG_DIR } from '../../dist/config/index.js';
import { clearCursor } from '../../dist/capture/index.js';
import { markShown, readShown } from '../../dist/hooks/shown.js';

export default async function run() {
  const session = 'unit-shown-test';
  const path = join(CONFIG_DIR, 'cursors', `${session}.shown`);
  clearCursor(session);

  check('a session with no history has seen nothing', readShown(session).size === 0);

  markShown(session, ['a1', 'b2']);
  check(
    'injected ids are remembered',
    readShown(session).has('a1') && readShown(session).has('b2'),
  );

  markShown(session, ['b2', 'c3']);
  const seen = readShown(session);
  check('re-marking does not duplicate', seen.size === 3, [...seen].join(','));

  markShown(session, []);
  check('marking nothing is a no-op', readShown(session).size === 3);

  const many = Array.from({ length: 400 }, (_, i) => `x${i}`);
  markShown(session, many);
  const capped = readShown(session);
  check('the file cannot grow without bound', capped.size <= 300, capped.size);
  check('and it keeps the most recent ids', capped.has('x399'));

  clearCursor(session);
  check('session end clears what was shown', !existsSync(path) && readShown(session).size === 0);

  const hook = readFileSync('src/hooks/user-prompt.ts', 'utf8');
  check(
    'the prompt hook filters what it already injected',
    /found\.filter\(\(entry\) => !shown\.has\(entry\.id\)\)/.test(hook),
  );
  check(
    'and injects nothing when every match is already in context',
    /entries\.length === 0\) return;/.test(hook),
  );
}
