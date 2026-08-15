import type { Config } from '../config/index.js';
import type { Observation, ObservationKind } from '../types.js';
import { classifyCommand } from './command.js';
import { currentAuthor, observationId } from './identity.js';
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

  const author = currentAuthor();

  return {
    id: observationId(sessionId, turn.timestamp, turn.prompt),
    sessionId,
    project,
    ...(author ? { author } : {}),
    kind: classifyTurn(turn),
    // Redacted like the body: the title is injected above every future prompt.
    title: redact(buildTitle(turn, files)),
    body,
    files,
    tags: topLevelDirs(files, project),
    createdAt: turn.timestamp,
  };
}

/**
 * Sentences that announce work rather than report it.
 *
 * The original rule took the reply's opening sentence, assuming it stated the
 * outcome. Mid-task it almost never does: it says "Now the use command and the
 * top-level handler:" or "Right — let me do that properly". Measured on a real
 * database, about half of all titles were transitions like these, which is fatal
 * because the title is the whole payload of a search result and of the injected
 * block — the body may hold the answer, but nothing ever surfaces it.
 */
const ANNOUNCEMENT =
  /^(now|next|then|first|right|ok|okay|good question|great|sure|perfect|let me|let's|i'?ll|here'?s|two|three|four|before|starting|continuing)\b/i;

function announces(sentence: string): boolean {
  return sentence.endsWith(':') || ANNOUNCEMENT.test(sentence);
}

/**
 * Prefers the first sentence of the reply that reports something.
 *
 * The prompt states a request ("can you create one icon"); the reply states
 * what actually happened ("Built mouse-scroll-icon.tsx, first of the Huge
 * Tier 1 Gestures batch"). The second is what someone searching their history
 * is looking for, and it is written in the vocabulary of the codebase — but
 * only once the throat-clearing in front of it is skipped.
 */
function buildTitle(turn: Turn, files: string[]): string {
  const prose = stripMarkdown(turn.reasoning);

  // Bounded: past the first few sentences a reply has moved on to detail that
  // no longer summarises the turn.
  for (const sentence of sentences(prose).slice(0, 6)) {
    if (sentence.length >= 15 && !announces(sentence)) return headline(sentence);
  }

  const opening = firstSentence(prose);
  if (opening && opening.length >= 15) return headline(opening);

  const prompt = firstSentence(turn.prompt);
  if (prompt) return headline(prompt);

  return files.length > 0 ? `Changed ${shortPath(files[0] ?? '')}` : 'Session work';
}

/** Split on sentence enders followed by space, so "0.2.1" stays intact. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
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

/**
 * The first path segment under the project root, which is the repository name
 * when the project directory holds several repos, and the top-level source
 * folder when it is one repo. Tags carry real weight in every backend's index,
 * so this is what makes a pooled memory filterable by where the work happened.
 */
function topLevelDirs(files: string[], project: string): string[] {
  const prefix = project.endsWith('/') ? project : `${project}/`;
  const tags = new Set<string>();

  for (const file of files) {
    if (!file.startsWith(prefix)) continue;
    const parts = file.slice(prefix.length).split('/');
    // Two or more parts means the first is a directory, not a root-level file.
    if (parts.length > 1 && parts[0]) tags.add(parts[0]);
  }
  return [...tags].slice(0, 3);
}

function classifyTurn(turn: Turn): ObservationKind {
  const text = `${turn.prompt} ${turn.reasoning}`.toLowerCase();

  // Read from the prompt alone, and only where the phrasing is a standing
  // instruction. "the build always fails" is a bugfix, not a house rule, so
  // always/never have to be followed by something imperative to count.
  if (
    /\b(from now on|going forward|remember to|prefer)\b/.test(turn.prompt.toLowerCase()) ||
    /\b(always|never)\s+(use|run|do|add|write|call|put|name|commit|push|import|install)\b/.test(
      turn.prompt.toLowerCase(),
    )
  ) {
    return 'preference';
  }
  if (/\b(instead of|rather than|chose|decided|because|why we|trade-?off)\b/.test(text)) {
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
const PRIVATE_KEY =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;

export function redact(text: string): string {
  return text
    .replace(PRIVATE_BLOCK, '[redacted]')
    .replace(PRIVATE_KEY, '[redacted-private-key]')
    // Credentials inside a URL: postgres://, mongodb+srv://, https://. A
    // connection string is the likeliest secret to be pasted into a tool whose
    // whole job is remembering what you pasted. The host survives, so the
    // memory stays useful.
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
