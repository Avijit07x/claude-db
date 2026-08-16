import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { Observation } from '../types.js';
import { observationId } from './identity.js';
import { classifyTurn, redact, topLevelDirs } from './turn-extractor.js';

/**
 * Builds memory from git history.
 *
 * A fresh install knows nothing and stays useless for weeks while it fills up,
 * which is the worst moment to be asking someone to trust it. Git history is
 * already a near-perfect source for exactly the fields an observation wants —
 * subject, reasoning, files, author, date — and unlike a profile written by a
 * model it is a record of things that actually happened.
 *
 * Ids derive from the commit sha, so this is safe to re-run: later commits are
 * added and earlier ones are rewritten in place rather than duplicated.
 */

// Unit and record separators: neither can appear in a commit message, so the
// output parses without any quoting rules.
const RECORD = '';
const FIELD = '';

/** Releases and formatting sweeps touch many files and explain nothing. */
const NOT_WORTH_KEEPING =
  /^(v?\d+\.\d+\.\d+|merge |revert "|bump |release |chore\(release\)|\d+\.\d+\.\d+$)/i;

export function observationsFromGit(project: string, limit: number): Observation[] {
  const raw = execFileSync(
    'git',
    [
      '-C',
      project,
      'log',
      `-n${limit}`,
      '--no-merges',
      `--pretty=format:${RECORD}%H${FIELD}%an${FIELD}%aI${FIELD}%s${FIELD}%b${FIELD}`,
      '--name-only',
    ],
    { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 },
  );

  const observations: Observation[] = [];
  for (const record of raw.split(RECORD)) {
    const observation = toObservation(record, project);
    if (observation) observations.push(observation);
  }
  return observations;
}

function toObservation(record: string, project: string): Observation | null {
  if (record.trim().length === 0) return null;

  // The format string ends with a separator, so --name-only's paths arrive as
  // their own field rather than having to be told apart from the body — which
  // cannot be done by looking, since commit bodies contain blank lines too.
  const [sha, author, date, subject, body = '', paths = ''] = record.split(FIELD);
  if (!sha || !subject || !date) return null;
  if (NOT_WORTH_KEEPING.test(subject.trim())) return null;

  const files = paths
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((path) => join(project, path));

  if (files.length === 0) return null;

  const createdAt = Date.parse(date);
  if (!Number.isFinite(createdAt)) return null;

  const timestamp = createdAt;
  return {
    // The sha alone, so re-seeding rewrites rather than appends and two
    // machines seeding the same repository agree on every id.
    id: observationId('git', 0, sha),
    sessionId: 'git',
    project,
    ...(author ? { author } : {}),
    kind: classifyTurn({
      prompt: subject,
      reasoning: body,
      files,
      commands: [],
      timestamp,
      offset: 0,
    }),
    title: redact(subject.trim()).slice(0, 80),
    body: redact(
      [
        `Committed ${sha.slice(0, 8)}${author ? ` by ${author}` : ''}`,
        '',
        subject.trim(),
        body.trim(),
        '',
        `Files: ${files.slice(0, 20).map(shortPath).join(', ')}`,
      ]
        .filter((line, index) => line !== '' || index > 0)
        .join('\n'),
    ),
    files,
    tags: topLevelDirs(files, project),
    createdAt,
  };
}

function shortPath(path: string): string {
  return path.split('/').filter(Boolean).slice(-2).join('/');
}
