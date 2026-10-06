import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check } from '../lib/check.mjs';
import { config } from '../lib/fixtures.mjs';
import { observationId, observationsFromTurns, readTranscript } from '../../dist/capture/index.js';
import { isRelayedMessage, readablePrompt, withoutImageMarkers } from '../../dist/util/prompt.js';

const at = (second) => new Date(Date.UTC(2026, 9, 6, 9, 0, second)).toISOString();
const user = (second, content, extra = {}) => ({
  type: 'user',
  timestamp: at(second),
  message: { content },
  ...extra,
});
const assistant = (second, content) => ({
  type: 'assistant',
  timestamp: at(second),
  message: { content },
});
const say = (text) => [{ type: 'text', text }];
const edit = (text, file) => [
  { type: 'text', text },
  { type: 'tool_use', name: 'Edit', input: { file_path: file } },
];

export default async function run() {
  {
    check(
      'a subagent hand-back is a relayed message',
      isRelayedMessage(
        'Another Claude session sent a message:\n<agent-message from="a1">x</agent-message>',
      ),
    );
    check(
      'so is a task notification',
      isRelayedMessage('<task-notification>\n<task-id>b1</task-id>'),
    );
    check('a typed prompt is not', !isRelayedMessage('why does <agent-message> parse twice'));
    check(
      'a slash command reads as the user typed it',
      readablePrompt(
        '<command-name>/recap</command-name>\n<command-message>recap</command-message>\n<command-args>release notes</command-args>',
      ) === '/recap release notes',
    );
    check(
      'a slash command without arguments reads as its name',
      readablePrompt(
        '<command-message>recap</command-message>\n<command-name>/recap</command-name>',
      ) === '/recap',
    );
    check(
      'saved text drops IDE notes too',
      readablePrompt('<ide_opened_file>The user opened /p/a.ts.</ide_opened_file> rename it') ===
        'rename it',
    );
    check(
      'image markers leave no doubled spaces behind',
      withoutImageMarkers('see [Image: source: /tmp/a.png] here') === 'see here',
    );
  }

  const dir = mkdtempSync(join(tmpdir(), 'turns-'));
  const path = join(dir, 'session.jsonl');
  const handback =
    'Another Claude session sent a message:\n<agent-message from="a1">\n[Subagent hand-back] all 12 timers checked\n</agent-message>';
  const rows = [
    user(1, 'the banner gap is too wide, fix it', { origin: { kind: 'human' } }),
    user(2, [{ type: 'text', text: '[Image: source: /tmp/claude-1000/x/images/1.png]' }], {
      isMeta: true,
    }),
    assistant(3, edit('Removed the extra 10px of padding from the banner.', '/p/src/banner.tsx')),
    user(4, 'Base directory for this skill: /tmp/skills/recap', { isMeta: true }),
    user(5, handback, { isMeta: true, origin: { kind: 'peer' } }),
    assistant(
      6,
      edit(
        'The subagent confirmed the spacing, so I tightened the header too.',
        '/p/src/header.tsx',
      ),
    ),
    user(7, '<task-notification>\n<task-id>b1</task-id>\n</task-notification>', {
      origin: { kind: 'task-notification' },
    }),
    assistant(8, say('The background build finished cleanly.')),
    user(9, '<task-notification>\n<task-id>b2</task-id>\n</task-notification>'),
    assistant(10, say('The second build finished too.')),
    user(
      11,
      '<command-message>recap</command-message>\n<command-name>/recap</command-name>\n<command-args>release notes</command-args>',
      { origin: { kind: 'human' } },
    ),
    assistant(12, edit('Wrote the release notes script for the release.', '/p/notes/script.md')),
    user(13, '[Image: source: /tmp/claude-1000/x/images/2.png] the footer overlaps on mobile'),
    assistant(14, edit('Moved the footer below the fold on small screens.', '/p/src/footer.tsx')),
  ];
  writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);

  try {
    const { turns } = readTranscript(path);
    check(
      'hidden and relayed messages never start a turn',
      turns.length === 3,
      turns.map((t) => t.prompt.slice(0, 20)).join(' | '),
    );

    const [banner, recap, footer] = turns;
    check(
      'the typed request keeps its own words',
      banner?.prompt === 'the banner gap is too wide, fix it',
    );
    check(
      'work after an image, a skill body, a hand-back or a notification stays with that request',
      banner?.files.join() === '/p/src/banner.tsx,/p/src/header.tsx' &&
        banner.reasoning.includes('tightened the header') &&
        banner.reasoning.includes('second build finished'),
      banner?.files.join(),
    );
    check(
      'a slash command still starts its own turn',
      recap?.files.join() === '/p/notes/script.md',
    );

    const observations = observationsFromTurns(turns, 'session', '/p', config);
    const asked = observations.map((obs) => obs.body.split('\n')[0]);
    check(
      'saved text reads as typed: no image paths, commands as /name args',
      asked.join('|') ===
        'Asked: the banner gap is too wide, fix it|Asked: /recap release notes|Asked: the footer overlaps on mobile',
      asked.join(' | '),
    );
    check(
      'ids still come from the raw prompt, so re-ingesting updates rows in place',
      observations[2]?.id === observationId('session', footer.timestamp, footer.prompt) &&
        footer.prompt.startsWith('[Image: source:'),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
