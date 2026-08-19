import { observationsFromTurns } from '../../dist/capture/index.js';
import { ConfigSchema } from '../../dist/config/index.js';
import { check } from '../lib/check.mjs';
import { now, config, turn } from '../lib/fixtures.mjs';

export default async function run() {
  const standing = observationsFromTurns(
    [turn({ prompt: 'always use pnpm in this repo, never npm' })],
    's1',
    '/p',
    config,
  );
  check(
    'standing rules are classified as preferences',
    standing[0].kind === 'preference',
    standing[0].kind,
  );

  const notARule = observationsFromTurns(
    [turn({ prompt: 'the build always fails on ci', reasoning: 'Fixed the broken cache key.' })],
    's1',
    '/p',
    config,
  );
  check(
    '"always" in a complaint is not a preference',
    notARule[0].kind !== 'preference',
    notARule[0].kind,
  );

  const explained = observationsFromTurns(
    [
      turn({
        prompt: 'fix the flaky test',
        reasoning: 'It was flaky because the clock was mocked.',
      }),
    ],
    's1',
    '/p',
    config,
  );
  check(
    '"because" alone no longer makes a decision',
    explained[0].kind === 'bugfix',
    explained[0].kind,
  );

  const weighed = observationsFromTurns(
    [
      turn({
        prompt: 'pick an index',
        reasoning: 'Went with FTS5 instead of a trigram index.',
      }),
    ],
    's1',
    '/p',
    config,
  );
  check('a weighed alternative still is', weighed[0].kind === 'decision', weighed[0].kind);

  const narrated = observationsFromTurns(
    [
      turn({
        reasoning:
          'Now the use command and the top-level handler:\nThe config was saved before the connection was verified, so a bad host bricked memory.',
      }),
    ],
    's1',
    '/p',
    config,
  );
  check(
    'a title skips the sentence that only announces the work',
    narrated[0].title.startsWith('The config was saved'),
    narrated[0].title,
  );

  const chatty = observationsFromTurns(
    [
      turn({
        reasoning:
          'Good question, and the answer is specific.\nFTS5 keeps a run of Han characters as a single token.',
      }),
    ],
    's1',
    '/p',
    config,
  );
  check(
    'and skips conversational filler',
    chatty[0].title.startsWith('FTS5 keeps'),
    chatty[0].title,
  );

  const allNarration = observationsFromTurns(
    [
      turn({
        prompt: 'store the api key somewhere',
        reasoning: 'Working through the improvements now.\nLet me start with that.',
      }),
    ],
    's1',
    '/p',
    config,
  );
  check(
    'a reply that only narrates falls back to what was asked',
    allNarration[0].title === 'store the api key somewhere',
    allNarration[0].title,
  );

  const buried = observationsFromTurns(
    [
      turn({
        reasoning:
          'Working through the improvements now.\nMoved the sweep into flush.ts so a cursor without a transcript is dropped.',
      }),
    ],
    's1',
    '/p',
    config,
  );
  check(
    'a neutral opening loses to a later sentence carrying evidence',
    buried[0].title.startsWith('Moved the sweep'),
    buried[0].title,
  );

  const pasted = observationsFromTurns(
    [
      turn({
        reasoning: 'Notes from the session follow.\nToken is "sk-abcdefghijkl1234567890".',
      }),
    ],
    's1',
    '/p',
    config,
  );
  check(
    'a redacted secret does not count as evidence',
    pasted[0].title.startsWith('Notes from'),
    pasted[0].title,
  );

  const excluded = observationsFromTurns([turn({ files: ['/p/.env'] })], 's1', '/p', config);
  check('excluded paths are never stored', excluded.length === 0);

  const chatter = observationsFromTurns(
    [turn({ files: [], commands: ['ls -la'] })],
    's1',
    '/p',
    config,
  );
  check('turns that changed nothing are dropped', chatter.length === 0);
}
