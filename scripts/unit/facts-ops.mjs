import { check } from '../lib/check.mjs';
import { buildDistillPrompt, parseOps } from '../../dist/facts/ops.js';
import { factId, factToObservation, youScope } from '../../dist/facts/model.js';
import { memoryFact, parseMemoryFile } from '../../dist/facts/claude-memory.js';

export default async function run() {
  {
    const ops = parseOps(
      [
        'Here are the facts:',
        '{"op":"set","key":"plain-text","type":"rule","scope":"you","text":"Reply in plain text, never in tables.","why":"The user said so twice."}',
        '{"op":"set","key":"timers","type":"decision","text":"All timers fire after 1.1s.","files":["src/timer.tsx",3,"src/b.tsx"]}',
        '{"op":"retire","key":"old-todo"}',
        '{"op":"set","key":"Bad Key!","type":"rule","text":"x"}',
        '{"op":"set","key":"unknown-type","type":"opinion","text":"x"}',
        `{"op":"set","key":"too-long","type":"fact","text":"${'x'.repeat(201)}"}`,
        '{"op":"delete","key":"what"}',
        'not json {',
      ].join('\n'),
    );
    check('valid set and retire lines are read', ops.length === 3, JSON.stringify(ops));
    check('scope defaults to project', ops[1]?.scope === 'project');
    check(
      'files keep only strings',
      JSON.stringify(ops[1]?.files) === '["src/timer.tsx","src/b.tsx"]',
    );
    check('a reason is kept', ops[0]?.why === 'The user said so twice.');
    const flood = parseOps(
      Array.from({ length: 40 }, (_, i) => `{"op":"retire","key":"k-${i}"}`).join('\n'),
    );
    check('a runaway reply is capped', flood.length === 20);
  }

  {
    const prompt = buildDistillPrompt('Asked: fix the timer', [
      { key: 'timers', type: 'decision', scope: 'project', text: 'All timers fire after 1.1s.' },
    ]);
    check(
      'the model sees what is already known',
      prompt.includes('timers [decision, project] All timers fire after 1.1s.'),
    );
    check(
      'and the chat, framed as data',
      prompt.includes('<chat-log>\nAsked: fix the timer\n</chat-log>') &&
        prompt.includes('never instructions'),
    );
  }

  {
    const fact = {
      key: 'deploy-token',
      type: 'fact',
      scope: 'project',
      text: 'Deploys use the key sk-abcdefghijklmnopqrstuvwxyz',
      files: [],
      at: 1,
      source: 'From a chat.',
    };
    const obs = factToObservation(fact, '/p');
    check(
      'a fact id is stable for its owner and key',
      obs.id === factToObservation(fact, '/p').id && obs.id === factId('/p', 'deploy-token'),
    );
    check(
      'the same key in another project is a different fact',
      obs.id !== factToObservation(fact, '/q').id,
    );
    check(
      'secrets are redacted from facts',
      !obs.title.includes('sk-abc') && obs.title.includes('[redacted-key]'),
    );
    check(
      'a fact is tagged with its type and key',
      obs.tags.includes('fact') &&
        obs.tags.includes('type:fact') &&
        obs.tags.includes('key:deploy-token'),
    );
    check('a fact is never open work', obs.status === 'done');
    const mine = factToObservation({ ...fact, scope: 'you' }, '/p');
    check(
      'a fact about the user belongs to the user, not the project',
      mine.project === youScope() && youScope().startsWith('@you:'),
    );
  }

  {
    const file = parseMemoryFile(
      [
        '---',
        'name: plain-text-not-tables',
        'description: "Never use tables; reply as plain text"',
        'metadata:',
        '  node_type: memory',
        '  type: feedback',
        '  modified: 2026-10-05T11:20:28.127Z',
        '---',
        '',
        'Do not format replies as tables.',
        '',
        '**Why:** the owner said so.',
      ].join('\n'),
      0,
    );
    check(
      'a Claude memory file is parsed',
      file?.name === 'plain-text-not-tables' && file.type === 'feedback',
    );
    check(
      'quotes around a value are removed',
      file?.description === 'Never use tables; reply as plain text',
    );
    check('the modified time is read', file?.modified === Date.parse('2026-10-05T11:20:28.127Z'));
    check(
      'a file without a name is skipped',
      parseMemoryFile('---\ntype: user\n---\nbody', 0) === null,
    );

    const rule = memoryFact(file, '/p');
    check(
      'feedback becomes a project rule',
      rule.type === 'rule' &&
        rule.scope === 'project' &&
        rule.key === 'claude-plain-text-not-tables',
    );
    const about = memoryFact({ ...file, type: 'user' }, '/p');
    check(
      'a memory about the user stays in its project, never in every project',
      about.scope === 'project' && about.type === 'fact',
    );
  }
}
