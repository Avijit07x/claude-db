import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check } from '../lib/check.mjs';
import { buildDistillPrompt, parseOps } from '../../dist/facts/ops.js';
import { factId, factToObservation, youScope } from '../../dist/facts/model.js';
import { importClaudeMemory, memoryFact, parseMemoryFile } from '../../dist/facts/claude-memory.js';
import { NoopEmbedder } from '../../dist/embed/index.js';
import { handoffBodyLines } from '../../dist/facts/handoff.js';

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
    check('no noted block when nothing was saved by hand', !prompt.includes('<noted-by-user>'));
    const withNotes = buildDistillPrompt('Asked: fix the timer', [], ['Always use pnpm here']);
    check(
      'rules saved by hand are listed so they are not repeated',
      withNotes.includes('<noted-by-user>\nAlways use pnpm here\n</noted-by-user>') &&
        withNotes.includes('never write a fact that repeats'),
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
  {
    const long = {
      body: [
        'Handoff, Oct 7:',
        ...Array.from({ length: 12 }, (_, i) => `- Line ${i}: ${'x'.repeat(400)}`),
      ].join('\n'),
    };
    const lines = handoffBodyLines(long);
    check(
      'a long handoff shows at most 8 lines, then says how many more there are',
      lines.length === 9 && lines[8] === '- ...4 more line(s) in the full note',
      String(lines.length),
    );
    check(
      'and each line is cut to a short length',
      lines.slice(0, 8).every((line) => line.length <= 220 && line.endsWith('…')),
      String(Math.max(...lines.slice(0, 8).map((line) => line.length))),
    );
    const short = { body: 'Handoff, Oct 7:\n- Done: a.\n- Open: b.\n- Next: c.' };
    check(
      'a short handoff is shown whole',
      JSON.stringify(handoffBodyLines(short)) === '["- Done: a.","- Open: b.","- Next: c."]',
    );
  }

  {
    const dir = mkdtempSync(join(tmpdir(), 'claude-memory-'));
    const path = join(dir, 'no-modified.md');
    writeFileSync(
      path,
      '---\nname: no-modified\ntype: project\n---\nA fact with no modified time.\n',
    );
    utimesSync(path, 1788415320.908391, 1788415320.908391);
    const saved = [];
    const ctx = {
      config: { embeddings: { batchSize: 8 } },
      embedder: async () => new NoopEmbedder(),
      store: {
        list: async () => [],
        insertObservations: async (rows) => saved.push(...rows),
        markReplaced: async () => 0,
      },
    };
    await importClaudeMemory(ctx, '/p', dir);
    check(
      'a memory file timed by its mtime stores a whole-millisecond time',
      saved.length === 1 && Number.isInteger(saved[0].createdAt),
      saved.map((obs) => obs.createdAt).join(','),
    );
    rmSync(dir, { recursive: true, force: true });
  }
}
