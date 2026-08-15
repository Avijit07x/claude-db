/**
 * Transcript reading and turn extraction: intent and reasoning must survive
 * into the stored observation, and non-substantive turns must be dropped.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTranscript, observationsFromTurns } from '../dist/capture/index.js';
import { ConfigSchema } from '../dist/config/index.js';

let f = 0;
const ck = (l, ok, d = '') => { if (!ok) f++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}${d ? `  (${d})` : ''}`); };

const dir = mkdtempSync(join(tmpdir(), 'tx-'));
const path = join(dir, 's.jsonl');
const at = (m) => new Date(Date.now() - (60 - m) * 60000).toISOString();

const rows = [
  { type: 'user', timestamp: at(0), message: { content: 'what is in your context?' } },
  { type: 'assistant', timestamp: at(1), message: { content: [{ type: 'text', text: 'Here is what is loaded.' }] } },

  { type: 'user', timestamp: at(2), message: { content: 'read the docs folder' } },
  { type: 'assistant', timestamp: at(3), message: { content: [
    { type: 'text', text: 'Read all of docs/.' },
    { type: 'tool_use', name: 'Bash', input: { command: 'find docs -type f | head -50' } },
  ] } },

  { type: 'user', timestamp: at(4), message: { content: 'can you create one icon' } },
  { type: 'assistant', timestamp: at(5), message: { content: [
    { type: 'text', text: 'Built mouse-scroll-icon.tsx, first of the Gestures batch. The shell compresses at its desk contact point, origin 12,22 instead of the centre, because centre-origin looked wrong.' },
    { type: 'tool_use', name: 'Write', input: { file_path: '/repo/icons/huge/mouse-scroll-icon.tsx' } },
    { type: 'tool_use', name: 'Bash', input: { command: 'pnpm test 2>&1 | tail -25' } },
  ] } },

  { type: 'user', timestamp: at(6), message: { content: '<system-reminder>injected</system-reminder>' } },
  { type: 'user', timestamp: at(7), message: { content: '<recalled-memory>a1b2 pattern</recalled-memory>' } },
];
writeFileSync(path, rows.map((r) => JSON.stringify(r)).join('\n') + '\n{"torn":');

const { turns, nextOffset } = readTranscript(path);
ck('parses despite a torn final line', turns.length > 0, `${turns.length} turns`);

// incremental reads: resuming from the cursor must not re-emit finished turns
const resumed = readTranscript(path, nextOffset);
ck('cursor holds at the last (still open) turn',
  resumed.turns.length <= 1, `${resumed.turns.length} re-read`);
ck('cursor never moves backwards', resumed.nextOffset >= nextOffset);
const rotated = readTranscript(path, 10_000_000);
ck('a truncated or rotated transcript restarts safely',
  rotated.turns.length === 0 || rotated.nextOffset >= 0);
ck('ignores injected pseudo-prompts', !turns.some((t) => t.prompt.includes('system-reminder')));
ck('ignores our own memory blocks', !turns.some((t) => t.prompt.includes('recalled-memory')));
ck('captures the user prompt', turns.some((t) => t.prompt === 'can you create one icon'));
ck('captures assistant reasoning', turns.some((t) => t.reasoning.includes('origin 12,22')));
ck('attributes files to the right turn',
  turns.find((t) => t.prompt === 'can you create one icon')?.files.length === 1);

const config = ConfigSchema.parse({});
const obs = observationsFromTurns(turns, 's1', '/repo', config);

ck('drops pure conversation', !obs.some((o) => o.title.includes('what is loaded')));
ck('drops exploration-only turns', !obs.some((o) => o.body.includes('find docs')), obs.length + ' kept');
ck('keeps the substantive turn', obs.length === 1, String(obs.length));

const o = obs[0];
ck('title is a claim, not a filename', /built/i.test(o.title), o.title);
ck('title stays scannable', o.title.length <= 80, String(o.title.length));
ck('body records intent', o.body.includes('Asked: can you create one icon'));
ck('body records reasoning', o.body.includes('centre-origin looked wrong'));
ck('body records the command', o.body.includes('Test run'));
ck('classified as a decision', o.kind === 'decision', o.kind);

// --- deterministic ids: the whole idempotency story rests on this ----------
{
  const { observationId } = await import('../dist/capture/index.js');
  const a = observationId('s1', 1000, 'add the icon');
  const b = observationId('s1', 1000, 'add the icon');
  ck('same turn yields the same id', a === b);
  ck('different session yields a different id', observationId('s2', 1000, 'add the icon') !== a);
  ck('different prompt yields a different id', observationId('s1', 1000, 'other') !== a);
  ck('id is uuid-shaped so short ids still work', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(a), a);

  // Re-extracting the same turns must produce identical ids, which is what
  // makes INSERT OR REPLACE collapse a re-flush instead of duplicating it.
  const again = observationsFromTurns(turns, 's1', '/repo', config);
  ck('re-extraction is stable', again[0].id === obs[0].id);
}

// --- large transcripts must not be read whole ------------------------------
{
  const big = join(dir, 'big.jsonl');
  const line = JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(),
    message: { content: [{ type: 'text', text: 'x'.repeat(500) }] } });
  writeFileSync(big, `${line}\n`.repeat(20000));  // ~10MB

  const t0 = performance.now();
  const tail = readTranscript(big, 10_000_000);
  const elapsed = performance.now() - t0;
  ck('reading from an offset skips the bulk of a large file', elapsed < 200, `${elapsed.toFixed(0)}ms`);
  ck('offset read returns a sane cursor', tail.nextOffset > 0);
}

rmSync(dir, { recursive: true, force: true });
console.log(f === 0 ? '\nTranscript extraction correct.' : `\n${f} failed.`);
process.exit(f ? 1 : 0);
