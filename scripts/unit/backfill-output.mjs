import { check } from '../lib/check.mjs';
import { createBackfillPrinter, stopLine } from '../../dist/cli/backfill-output.js';

const SPINNER = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/;
const idle = { used: 0, pausedUntil: 0, failures: 0, lastFailure: null };

function run(tty) {
  let text = '';
  let ticks = 0;
  let stopped = 0;
  const printer = createBackfillPrinter({
    write: (chunk) => (text += chunk),
    tty,
    every: () => {
      ticks += 1;
      return () => {
        stopped += 1;
      };
    },
  });
  printer.step({ kind: 'begin', total: 2 });
  printer.step({ kind: 'start', index: 1, total: 2 });
  printer.step({ kind: 'done', index: 1, total: 2, facts: 3 });
  printer.step({ kind: 'start', index: 2, total: 2 });
  printer.finish(
    { distilled: 1, facts: 3, remaining: 1, stopped: 'failed' },
    { ...idle, lastFailure: { at: 1, reason: 'timed out after 120 s' } },
    30,
  );
  return { text, ticks, stopped };
}

export default async function run_() {
  const piped = run(false);
  check(
    'output that is not a terminal has no spinner, no carriage return and no escape codes',
    !SPINNER.test(piped.text) && !piped.text.includes('\r') && !piped.text.includes('\u001b'),
    JSON.stringify(piped.text),
  );
  check('and starts no timer', piped.ticks === 0);
  check(
    'a pipe gets one line per finished chat and the stop reason last',
    piped.text.split('\n').filter(Boolean).slice(1).join('|') ===
      '1 of 2 chats, 3 facts made|stopped  : a Haiku call failed (timed out after 120 s), 1 chat(s) still waiting',
    JSON.stringify(piped.text),
  );

  const terminal = run(true);
  check('a terminal shows a spinner with the chat number', SPINNER.test(terminal.text));
  check('and the spinner names the chat', terminal.text.includes('chat 2 of 2'));
  check(
    'and every timer it started is stopped',
    terminal.ticks === 2 && terminal.stopped === 2,
    `${terminal.ticks} started, ${terminal.stopped} stopped`,
  );
  check(
    'and the permanent lines are the same as for a pipe',
    terminal.text.includes('1 of 2 chats, 3 facts made\n') &&
      terminal.text.endsWith('1 chat(s) still waiting\n'),
  );

  check(
    'a daily limit stop says the limit',
    stopLine({ distilled: 0, facts: 0, remaining: 4, stopped: 'over-budget' }, idle, 30) ===
      'stopped  : the daily limit of 30 calls is used up, 4 chat(s) still waiting',
  );
  const later = Date.now() + 3_600_000;
  check(
    'a stop during a pause says the pause',
    stopLine(
      { distilled: 0, facts: 0, remaining: 1, stopped: 'over-budget' },
      { ...idle, pausedUntil: later, failures: 1 },
      30,
    ).startsWith('stopped  : paused until '),
  );
}
