import { check } from '../lib/check.mjs';
import { e, now, day } from '../lib/fixtures.mjs';

export default async function run() {
  {
    const { summarize } = await import('../../dist/capture/index.js');
    const obs = (kind, title) => ({ kind, title });

    check(
      'a decision outranks the command that followed it',
      summarize([obs('context', 'Build'), obs('decision', 'Chose WebSocket')]).startsWith('Chose'),
      summarize([obs('context', 'Build'), obs('decision', 'Chose WebSocket')]),
    );

    const first = summarize([obs('decision', 'Chose WebSocket')]);
    const second = summarize([obs('context', 'Ran the build')], first);
    check('earlier work survives later flushes', second.includes('Chose WebSocket'), second);
    check(
      'summaries stay at three segments',
      summarize([obs('context', 'd'), obs('context', 'e')], 'a | b | c').split(' | ').length === 3,
    );
    check(
      'a repeated title is not duplicated',
      summarize([obs('decision', 'a')], 'a | b') === 'a | b',
    );
  }
}
