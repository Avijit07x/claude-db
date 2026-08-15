import type { Config } from '../config/index.js';
import type { Observation, ObservationKind } from '../types.js';
import { classifyCommand } from './command.js';
import { observationId } from './identity.js';
import type { Turn } from './transcript.js';

/**
 * Builds observations from transcript turns.
 *
 * One observation per turn, titled by what was asked and bodied by what the
 * agent explained. That ordering matters: the prompt is the only record of
 * intent, and the assistant's prose is the only record of reasoning. A
 * file-path-based capture has access to neither, which is why it can never
 * produce a memory worth recalling.
 */
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

/**
 * A turn earns a slot only if it changed something.
 *
 * Conversation that produced no edit and no consequential command is chatter:
 * questions about state, requests to explain, "what's in your context". Those
 * are answered from the repo, not from memory.
 */
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

  return {
    id: observationId(sessionId, turn.timestamp, turn.prompt),
    sessionId,
    project,
    kind: classifyTurn(turn, commands.length > 0),
    title: buildTitle(turn, files),
    body,
    files,
    tags: [],
    createdAt: turn.timestamp,
  };
}

/**
 * Prefers the agent's own opening sentence over the raw prompt.
 *
 * The prompt states a request ("can you create one icon"); the reply states
 * what actually happened ("Built mouse-scroll-icon.tsx, first of the Huge
 * Tier 1 Gestures batch"). The second is what someone searching their history
 * is looking for, and it is written in the vocabulary of the codebase.
 */
function buildTitle(turn: Turn, files: string[]): string {
  const sentence = firstSentence(stripMarkdown(turn.reasoning));
  if (sentence && sentence.length >= 15) return headline(sentence);

  const prompt = firstSentence(turn.prompt);
  if (prompt) return headline(prompt);

  return files.length > 0 ? `Changed ${shortPath(files[0] ?? '')}` : 'Session work';
}

const TITLE_MAX = 80;

/**
 * Trims a sentence to a scannable headline.
 *
 * Titles are the entire payload of a layer-1 search result and of the injected
 * memory block, so every character is paid on every query. Cutting at a clause
 * boundary keeps the claim intact where a hard character truncation would sever
 * it mid-phrase.
 */
function headline(sentence: string): string {
  if (sentence.length <= TITLE_MAX) return sentence;

  const clause = sentence.slice(0, TITLE_MAX);
  const cut = Math.max(clause.lastIndexOf(', '), clause.lastIndexOf(' - '));
  if (cut >= 30) return clause.slice(0, cut);

  const word = clause.lastIndexOf(' ');
  return `${clause.slice(0, word > 30 ? word : TITLE_MAX)}...`;
}

function classifyTurn(turn: Turn, hasCommands: boolean): ObservationKind {
  const text = `${turn.prompt} ${turn.reasoning}`.toLowerCase();

  if (/\b(instead of|rather than|chose|decided|because|why we|trade-?off)\b/.test(text)) {
    return 'decision';
  }
  if (/\b(didn'?t work|failed|reverted|abandoned|dead ?end|gave up|doesn'?t scale)\b/.test(text)) {
    return 'deadend';
  }
  if (/\b(fix(ed)?|bug|broken|regression|error|crash)\b/.test(text)) return 'bugfix';
  if (turn.files.length > 0) return 'pattern';
  return hasCommands ? 'context' : 'context';
}

function firstSentence(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return '';
  const match = /^(.+?)(?:[.!?](?:\s|$)|\n)/s.exec(trimmed);
  return (match?.[1] ?? trimmed.split('\n')[0] ?? '').trim();
}

/** Markdown links and emphasis read badly in a one-line title. */
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

function redact(text: string): string {
  return text
    .replace(PRIVATE_BLOCK, '[redacted]')
    .replace(/\b(sk-[A-Za-z0-9_-]{16,})\b/g, '[redacted-key]')
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{16,})\b/g, '[redacted-token]')
    .replace(/(?<=(password|secret|token|api[_-]?key)"?\s*[:=]\s*)"[^"]+"/gi, '"[redacted]"');
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n... [truncated]`;
}
