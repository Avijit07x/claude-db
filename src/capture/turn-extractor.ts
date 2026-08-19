import type { Config } from '../config/index.js';
import type { Observation, ObservationKind } from '../types.js';
import { classifyCommand } from './command.js';
import { currentAuthor, observationId } from './identity.js';
import type { Turn } from './transcript.js';

export function observationsFromTurns(
  turns: Turn[],
  sessionId: string,
  project: string,
  config: Config,
): Observation[] {
  return turns
    .filter((turn) => isSubstantive(turn, config))
    .map((turn) => buildObservation(turn, sessionId, project, config));
}

function isSubstantive(turn: Turn, config: Config): boolean {
  const files = turn.files.filter((file) => !isExcluded(file, config.capture.exclude));
  const commands = turn.commands.filter((command) => classifyCommand(command) !== null);
  return files.length > 0 || commands.length > 0;
}

function buildObservation(
  turn: Turn,
  sessionId: string,
  project: string,
  config: Config,
): Observation {
  const files = [...new Set(turn.files.filter((f) => !isExcluded(f, config.capture.exclude)))];
  const commands = turn.commands
    .map(classifyCommand)
    .filter((c): c is NonNullable<typeof c> => c !== null);

  const body = redact(
    truncate(
      [
        `Asked: ${turn.prompt}`,
        '',
        turn.reasoning,
        files.length > 0 ? `\nFiles: ${files.map(shortPath).join(', ')}` : '',
        commands.length > 0 ? `Ran: ${commands.map((c) => c.label).join('; ')}` : '',
      ]
        .filter((line) => line !== '')
        .join('\n'),
      config.capture.maxBodyChars,
    ),
  );

  const author = currentAuthor();

  return {
    id: observationId(sessionId, turn.timestamp, turn.prompt),
    sessionId,
    project,
    ...(author ? { author } : {}),
    status: 'open',
    kind: classifyTurn(turn),
    title: redact(buildTitle(turn, files)),
    body,
    files,
    tags: topLevelDirs(files, project),
    createdAt: turn.timestamp,
  };
}

const ANNOUNCEMENT =
  /^(now|next|then|first|right|ok|okay|good question|great|sure|perfect|let me|let's|i'?ll|here'?s|two|three|four|before|starting|continuing)\b/i;

const IN_PROGRESS =
  /^(work|add|fix|runn|updat|writ|build|mak|mov|remov|check|test|switch|wir|tak|go|do|try|look|read|creat|implement|refactor|pull|push|sett)ing\b/i;

const BACKREFERENCE =
  /^(that'?s|this is|these are|it'?s|there'?s|you'?(ve|re)|we'?(ve|re)|yes\b|no\b|exactly|correct|agreed|fair enough|both\b|either\b|same\b)/i;

function announces(sentence: string): boolean {
  return (
    sentence.endsWith(':') ||
    ANNOUNCEMENT.test(sentence) ||
    BACKREFERENCE.test(sentence) ||
    IN_PROGRESS.test(sentence)
  );
}

const EVIDENCE = [
  /[\w-]+\.(ts|tsx|js|jsx|mjs|json|md|sql|py|go|rs|ya?ml|sh|toml|txt|css|html|lock)\b/i,
  /\b\w{3,}ed\b/i,
  /\d/,
];

function reports(sentence: string): number {
  if (announces(sentence)) return -1;
  const text = sentence.replace(/\[redacted[^\]]*\]/g, '');
  return EVIDENCE.some((test) => test.test(text)) ? 1 : 0;
}

function buildTitle(turn: Turn, files: string[]): string {
  const prose = stripMarkdown(redact(turn.reasoning));

  const scored = sentences(prose)
    .slice(0, 6)
    .filter((sentence) => sentence.length >= 15)
    .map((sentence) => [sentence, reports(sentence)] as const);

  const best = scored.find(([, score]) => score > 0) ?? scored.find(([, score]) => score === 0);
  if (best) return headline(best[0]);

  const prompt = firstSentence(redact(turn.prompt));
  if (prompt) return headline(prompt);

  const opening = firstSentence(prose);
  if (opening && opening.length >= 15) return headline(opening);

  return files.length > 0 ? `Changed ${shortPath(files[0] ?? '')}` : 'Session work';
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

const TITLE_MAX = 80;

function headline(sentence: string): string {
  if (sentence.length <= TITLE_MAX) return sentence;

  const clause = sentence.slice(0, TITLE_MAX);
  const cut = Math.max(clause.lastIndexOf(', '), clause.lastIndexOf(' - '));
  if (cut >= 30) return clause.slice(0, cut);

  const word = clause.lastIndexOf(' ');
  return `${clause.slice(0, word > 30 ? word : TITLE_MAX)}...`;
}

export function topLevelDirs(files: string[], project: string): string[] {
  const prefix = project.endsWith('/') ? project : `${project}/`;
  const tags = new Set<string>();

  for (const file of files) {
    if (!file.startsWith(prefix)) continue;
    const parts = file.slice(prefix.length).split('/');
    if (parts.length > 1 && parts[0]) tags.add(parts[0]);
  }
  return [...tags].slice(0, 3);
}

export function classifyTurn(turn: Turn): ObservationKind {
  const text = `${turn.prompt} ${turn.reasoning}`.toLowerCase();

  if (
    /\b(from now on|going forward|remember to|prefer)\b/.test(turn.prompt.toLowerCase()) ||
    /\b(always|never)\s+(use|run|do|add|write|call|put|name|commit|push|import|install)\b/.test(
      turn.prompt.toLowerCase(),
    )
  ) {
    return 'preference';
  }
  if (
    /\b(instead of|rather than|in favou?r of|opted for|went with|chose|decided|trade-?off|why we)\b/.test(
      text,
    )
  ) {
    return 'decision';
  }
  if (/\b(didn'?t work|failed|reverted|abandoned|dead ?end|gave up|doesn'?t scale)\b/.test(text)) {
    return 'deadend';
  }
  if (/\b(fix(ed)?|bug|broken|regression|error|crash)\b/.test(text)) return 'bugfix';
  return turn.files.length > 0 ? 'pattern' : 'context';
}

function firstSentence(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return '';
  const match = /^(.+?)(?:[.!?](?:\s|$)|\n)/s.exec(trimmed);
  return (match?.[1] ?? trimmed.split('\n')[0] ?? '').trim();
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#]/g, '')
    .trim();
}

function shortPath(path: string): string {
  return path.split('/').filter(Boolean).slice(-2).join('/');
}

function isExcluded(file: string, patterns: string[]): boolean {
  return patterns.some((pattern) => file.includes(pattern));
}

const PRIVATE_BLOCK = /<private>[\s\S]*?<\/private>/gi;
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;

export function redact(text: string): string {
  return text
    .replace(PRIVATE_BLOCK, '[redacted]')
    .replace(PRIVATE_KEY, '[redacted-private-key]')
    .replace(/\/\/[^\s:/@]+:[^\s@]+@/g, '//[redacted]@')
    .replace(/\b(sk-[A-Za-z0-9_-]{16,})\b/g, '[redacted-key]')
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{16,})\b/g, '[redacted-token]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[redacted-key]')
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, '[redacted-token]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[redacted-jwt]')
    .replace(/(?<=(password|secret|token|api[_-]?key)"?\s*[:=]\s*)"[^"]+"/gi, '"[redacted]"');
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n... [truncated]`;
}
