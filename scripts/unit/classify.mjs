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

  const ruleWhileWorking = observationsFromTurns(
    [
      turn({
        prompt: 'never push directly to main in this repo',
        reasoning: 'Fixed the pipeline. 140 checks pass, all green now.',
      }),
    ],
    's1',
    '/p',
    config,
  );
  check(
    "a preference's title is the rule, not the work around it",
    ruleWhileWorking[0].title.includes('never push directly to main'),
    ruleWhileWorking[0].title,
  );

  const secret = observationsFromTurns(
    [
      turn({
        prompt: 'always use pnpm here. <private>my api key is sk-12345</private>',
        reasoning: 'Noted the rule. <private>internal detail</private> Done.',
      }),
    ],
    's1',
    '/p',
    config,
  );
  check(
    'private-tagged content never reaches the observation',
    !JSON.stringify(secret[0]).includes('sk-12345') &&
      !JSON.stringify(secret[0]).includes('internal detail'),
    secret[0].title,
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

  const narrationTic = observationsFromTurns(
    [
      turn({
        prompt: 'ok now commit it also',
        reasoning:
          'Committed as 30daa92. No trailer - the attribution setting took effect, so it is off automatically now rather than needing a manual strip.',
      }),
    ],
    's1',
    '/p',
    config,
  );
  check(
    '"rather than" as narration tic in reasoning is not a decision',
    narrationTic[0].kind !== 'decision',
    narrationTic[0].kind,
  );

  const userFramed = observationsFromTurns(
    [
      turn({
        prompt: 'shell out to claude mcp add instead of rewriting the json, do this',
        reasoning: 'Wired the merge command through the CLI. 12 checks pass.',
      }),
    ],
    's1',
    '/p',
    config,
  );
  check(
    'the user weighing "instead of" in the prompt is a decision',
    userFramed[0].kind === 'decision',
    userFramed[0].kind,
  );

  const committed = observationsFromTurns(
    [
      turn({
        prompt: 'which store should be the default',
        reasoning: 'Chose SQLite over Postgres for the default store since it needs no server.',
      }),
    ],
    's1',
    '/p',
    config,
  );
  check(
    'a committed choice is still a decision',
    committed[0].kind === 'decision',
    committed[0].kind,
  );

  const recalled = observationsFromTurns(
    [
      turn({
        prompt: 'what did we decide about CLAUDE.local.md vs CLAUDE.md, and why?',
        reasoning: 'The decision: install writes to CLAUDE.local.md so the block stays private.',
      }),
    ],
    's1',
    '/p',
    config,
  );
  check('a recalled decision keeps its kind', recalled[0].kind === 'decision', recalled[0].kind);

  const pastedRule = observationsFromTurns(
    [
      turn({
        prompt: `# Update Config Skill\n\n${'Modify configuration by updating settings files. '.repeat(16)}Always run tests after code changes.`,
        reasoning: 'Read the pasted skill and applied the settings change to config.json.',
      }),
    ],
    's1',
    '/p',
    config,
  );
  check(
    'a rule-phrase buried in a long pasted prompt is not a preference',
    pastedRule[0].kind !== 'preference',
    pastedRule[0].kind,
  );

  const midPromptRule = observationsFromTurns(
    [
      turn({
        prompt: 'ok ship the fix, and never push directly to main in this repo',
        reasoning: 'Shipped on a branch. 14 checks pass.',
      }),
    ],
    's1',
    '/p',
    config,
  );
  check(
    'a rule arriving mid-prompt is still a preference',
    midPromptRule[0].kind === 'preference',
    midPromptRule[0].kind,
  );

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

  const answered = observationsFromTurns(
    [
      turn({
        prompt: 'why does capture read the transcript instead of the tool hooks',
        reasoning:
          'A PostToolUse hook only sees a file path. The transcript in src/capture/transcript.ts holds the prompt and the reasoning, which is why capture reads it instead.',
        files: [],
        commands: [],
      }),
    ],
    's1',
    '/p',
    config,
  );
  check('an answered question is kept even though it changed no files', answered.length === 1);
  check('and it is not left open, since it touched nothing', answered[0]?.status === 'done');

  const acked = observationsFromTurns(
    [turn({ prompt: 'ok', reasoning: 'Fixed src/a.ts in 3 places.', files: [], commands: [] })],
    's1',
    '/p',
    config,
  );
  check('a bare acknowledgement is still not worth storing', acked.length === 0);

  const named = observationsFromTurns(
    [
      turn({
        reasoning:
          'The find_usages tool reads src/usages/find.ts. It greps live, so the index never drifts.',
      }),
    ],
    's1',
    '/p',
    config,
  );
  check(
    'identifiers survive title generation intact',
    named[0]?.title.includes('find_usages'),
    named[0]?.title,
  );
}
