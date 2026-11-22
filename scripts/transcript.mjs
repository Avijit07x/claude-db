import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTranscript, observationsFromTurns, transcriptPathFor } from '../dist/capture/index.js';
import { ConfigSchema } from '../dist/config/index.js';

let f = 0;
const ck = (l, ok, d = '') => {
  if (!ok) f++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}${d ? `  (${d})` : ''}`);
};

const dir = mkdtempSync(join(tmpdir(), 'tx-'));
const path = join(dir, 's.jsonl');
const at = (m) => new Date(Date.now() - (60 - m) * 60000).toISOString();

const rows = [
  { type: 'user', timestamp: at(0), message: { content: 'what is in your context?' } },
  {
    type: 'assistant',
    timestamp: at(1),
    message: { content: [{ type: 'text', text: 'Here is what is loaded.' }] },
  },

  { type: 'user', timestamp: at(2), message: { content: 'read the docs folder' } },
  {
    type: 'assistant',
    timestamp: at(3),
    message: {
      content: [
        { type: 'text', text: 'Read all of docs/.' },
        { type: 'tool_use', name: 'Bash', input: { command: 'find docs -type f | head -50' } },
      ],
    },
  },

  { type: 'user', timestamp: at(4), message: { content: 'can you create one icon' } },
  {
    type: 'assistant',
    timestamp: at(5),
    message: {
      content: [
        {
          type: 'text',
          text: 'Built mouse-scroll-icon.tsx, first of the Gestures batch. The shell compresses at its desk contact point, origin 12,22 instead of the centre, because centre-origin looked wrong.',
        },
        {
          type: 'tool_use',
          name: 'Write',
          input: { file_path: '/repo/icons/huge/mouse-scroll-icon.tsx' },
        },
        { type: 'tool_use', name: 'Bash', input: { command: 'pnpm test 2>&1 | tail -25' } },
      ],
    },
  },

  {
    type: 'user',
    timestamp: at(6),
    isCompactSummary: true,
    message: {
      content:
        'This session is being continued from a previous conversation that ran out of context. Summary: we built the icon and argued about the origin point.',
    },
  },
  {
    type: 'assistant',
    timestamp: at(6),
    message: { content: [{ type: 'text', text: 'Picking the icon work back up.' }] },
  },

  {
    type: 'user',
    timestamp: at(6),
    message: { content: '<system-reminder>injected</system-reminder>' },
  },
  {
    type: 'user',
    timestamp: at(7),
    message: { content: '<recalled-memory>a1b2 pattern</recalled-memory>' },
  },
  {
    type: 'user',
    timestamp: at(8),
    message: { content: '<memory>\n- Oct 5: a1b2 pattern (a1b2c3d4-e5f6)\n</memory>' },
  },
];
writeFileSync(path, rows.map((r) => JSON.stringify(r)).join('\n') + '\n{"torn":');

const { turns, nextOffset } = readTranscript(path);
ck('parses despite a torn final line', turns.length > 0, `${turns.length} turns`);

const resumed = readTranscript(path, nextOffset);
ck(
  'cursor holds at the last (still open) turn',
  resumed.turns.length <= 1,
  `${resumed.turns.length} re-read`,
);
ck('cursor never moves backwards', resumed.nextOffset >= nextOffset);
const rotated = readTranscript(path, 10_000_000);
ck(
  'a truncated or rotated transcript restarts safely',
  rotated.turns.length === 0 || rotated.nextOffset >= 0,
);
ck('ignores injected pseudo-prompts', !turns.some((t) => t.prompt.includes('system-reminder')));
ck('ignores our own memory blocks', !turns.some((t) => t.prompt.includes('recalled-memory')));
ck('ignores the current memory block too', !turns.some((t) => t.prompt.startsWith('<memory>')));
ck(
  'a compaction summary is not mistaken for a prompt',
  !turns.some((t) => t.prompt.includes('continued from a previous conversation')),
);
ck(
  'captures the user prompt',
  turns.some((t) => t.prompt === 'can you create one icon'),
);
ck(
  'captures assistant reasoning',
  turns.some((t) => t.reasoning.includes('origin 12,22')),
);
ck(
  'attributes files to the right turn',
  turns.find((t) => t.prompt === 'can you create one icon')?.files.length === 1,
);

const config = ConfigSchema.parse({});
const obs = observationsFromTurns(turns, 's1', '/repo', config);

ck('drops pure conversation', !obs.some((o) => o.title.includes('what is loaded')));
ck(
  'drops exploration-only turns',
  !obs.some((o) => o.body.includes('find docs')),
  obs.length + ' kept',
);
ck('keeps the substantive turn', obs.length === 1, String(obs.length));

const o = obs[0];
ck('title is a claim, not a filename', /built/i.test(o.title), o.title);
ck('title stays scannable', o.title.length <= 80, String(o.title.length));
ck('body records intent', o.body.includes('Asked: can you create one icon'));
ck('body records reasoning', o.body.includes('centre-origin looked wrong'));
ck('body records the command', o.body.includes('Test run'));
ck('classified as file-backed work, not a decision', o.kind === 'pattern', o.kind);

{
  const { observationId } = await import('../dist/capture/index.js');
  const a = observationId('s1', 1000, 'add the icon');
  const b = observationId('s1', 1000, 'add the icon');
  ck('same turn yields the same id', a === b);
  ck('different session yields a different id', observationId('s2', 1000, 'add the icon') !== a);
  ck('different prompt yields a different id', observationId('s1', 1000, 'other') !== a);
  ck(
    'id is uuid-shaped so short ids still work',
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(a),
    a,
  );

  const again = observationsFromTurns(turns, 's1', '/repo', config);
  ck('re-extraction is stable', again[0].id === obs[0].id);
}

{
  const big = join(dir, 'big.jsonl');
  const line = JSON.stringify({
    type: 'assistant',
    timestamp: new Date().toISOString(),
    message: { content: [{ type: 'text', text: 'x'.repeat(500) }] },
  });
  writeFileSync(big, `${line}\n`.repeat(20000));

  const t0 = performance.now();
  const tail = readTranscript(big, 10_000_000);
  const elapsed = performance.now() - t0;
  ck(
    'reading from an offset skips the bulk of a large file',
    elapsed < 200,
    `${elapsed.toFixed(0)}ms`,
  );
  ck('offset read returns a sane cursor', tail.nextOffset > 0);
}

{
  const slugOf = (project) => transcriptPathFor(project, 's').split('/').at(-2);
  ck(
    'underscores in a project path become dashes, like Claude Code writes them',
    slugOf('/home/f/work/epiclin_2') === '-home-f-work-epiclin-2',
    slugOf('/home/f/work/epiclin_2'),
  );
  ck(
    'every non-alphanumeric becomes one dash, dashes kept',
    slugOf('/private/tmp/claude-501/probe_dir.x \u00fc/sub') ===
      '-private-tmp-claude-501-probe-dir-x---sub',
    slugOf('/private/tmp/claude-501/probe_dir.x \u00fc/sub'),
  );
}

{
  const { keepEnds } = await import('../dist/util/snippet.js');
  const { classifyTurn } = await import('../dist/capture/turn-extractor.js');
  const long = `Asked: fix the sweep race\n${'Checking the marker now. '.repeat(60)}\nThe fix reads the stored time.`;
  const kept = keepEnds(long, 900);
  ck(
    'a long text keeps its first line and its end, at the same size',
    kept.startsWith('Asked: fix the sweep race\n') &&
      kept.endsWith('The fix reads the stored time.') &&
      kept.length === 900,
    String(kept.length),
  );
  ck('a short text is kept whole', keepEnds('Asked: a\nb', 900) === 'Asked: a\nb');

  const turn = (over) => ({
    prompt: 'fix the sweep race',
    reasoning: 'Fixed it.',
    reply: 'Fixed it.',
    files: ['/repo/src/cursors.ts'],
    commands: [],
    timestamp: Date.now(),
    offset: 0,
    ...over,
  });
  const [saved] = observationsFromTurns(
    [
      turn({
        reasoning: `${'Checking the marker now. '.repeat(300)}\nThe fix reads the stored time.`,
      }),
    ],
    's1',
    '/repo',
    config,
  );
  ck(
    'a long turn keeps its prompt, its outcome and its files',
    saved.body.startsWith('Asked: fix the sweep race') &&
      saved.body.includes('The fix reads the stored time.') &&
      saved.body.includes('Files: '),
    saved.body.slice(-100),
  );

  const extract = (files) => observationsFromTurns([turn({ files })], 's1', '/repo', config)[0];
  const outside = extract(['/home/u/.claude/memory/note.md']);
  ck(
    'a turn that only wrote outside the project is not open work',
    outside.status === 'done',
    outside.status,
  );
  const mixed = extract(['/home/u/.claude/memory/note.md', '/repo/src/a.ts']);
  ck(
    'a turn that also wrote inside the project is open work',
    mixed.status === 'open',
    mixed.status,
  );

  const fixed = turn({
    prompt: 'make CI green',
    reasoning: 'The quality job failed on lint.\nFixed the import, CI is green.',
    reply: 'Fixed the import, CI is green.',
  });
  ck(
    'a failure in the narration does not make a fixed turn a dead end',
    classifyTurn(fixed) !== 'deadend',
    classifyTurn(fixed),
  );
  const titled = observationsFromTurns([fixed], 's1', '/repo', config)[0];
  ck(
    'a turn is titled from its final reply, not its first step',
    titled.title.startsWith('Fixed the import'),
    titled.title,
  );
  const reverted = turn({
    prompt: 'try a cache',
    reasoning: 'Added a cache.\nThe cache did not help, so I reverted it.',
    reply: 'The cache did not help, so I reverted it.',
  });
  ck(
    'a reply that says the approach was reverted is a dead end',
    classifyTurn(reverted) === 'deadend',
    classifyTurn(reverted),
  );

  const reported = turn({
    prompt: 'verify the release',
    reasoning: "Checking.\nFound and fixed one bug: the old rule didn't work on linked projects.",
    reply: "Found and fixed one bug: the old rule didn't work on linked projects.",
  });
  ck(
    'a reply that reports a fixed bug is not a dead end',
    classifyTurn(reported) !== 'deadend',
    classifyTurn(reported),
  );
  const testFirst = turn({
    prompt: 'add the tests',
    reasoning: 'Each new test failed before its change. The full suite passes now.',
    reply: 'Each new test failed before its change. The full suite passes now.',
  });
  ck(
    'a test that failed before its change does not make a dead end',
    classifyTurn(testFirst) !== 'deadend',
    classifyTurn(testFirst),
  );
  const undone = turn({
    prompt: 'fix the cache key',
    reasoning: "Tried a new key.\nThe fix didn't work, so I reverted it.",
    reply: "The fix didn't work, so I reverted it.",
  });
  ck(
    'a fix that did not work and was reverted is a dead end',
    classifyTurn(undone) === 'deadend',
    classifyTurn(undone),
  );
  const bulleted = observationsFromTurns(
    [turn({ reply: '- **Code:** all five fixes from the plan are committed (b3a9637).' })],
    's1',
    '/repo',
    config,
  )[0];
  ck(
    'a title drops a leading list marker',
    bulleted.title.startsWith('Code: all five fixes'),
    bulleted.title,
  );

  const cut = observationsFromTurns(
    [
      turn({
        reply:
          'The rejected daemon design, the duplicate, the wrong mtime fact and all four stale to-dos are gone.',
      }),
    ],
    's1',
    '/repo',
    config,
  )[0];
  ck(
    'a title cut short says so',
    cut.title.endsWith('...') && cut.title.startsWith('The rejected daemon design'),
    cut.title,
  );

  const replyPath = join(dir, 'reply.jsonl');
  const replyRows = [
    { type: 'user', timestamp: at(10), message: { content: 'run the tests' } },
    {
      type: 'assistant',
      timestamp: at(11),
      message: {
        content: [
          { type: 'text', text: 'Running them now.' },
          { type: 'tool_use', name: 'Read', input: { file_path: '/repo/a.ts' } },
        ],
      },
    },
    {
      type: 'assistant',
      timestamp: at(12),
      message: { content: [{ type: 'text', text: 'All tests pass.' }] },
    },
  ];
  writeFileSync(replyPath, replyRows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  const [replied] = readTranscript(replyPath).turns;
  ck(
    'a turn keeps the text after its last tool call as its reply',
    replied?.reply === 'All tests pass.',
    replied?.reply,
  );
}

rmSync(dir, { recursive: true, force: true });
console.log(f === 0 ? '\nTranscript extraction correct.' : `\n${f} failed.`);
process.exit(f ? 1 : 0);
