import type { Config } from '../config/index.js';
import type { Observation, ObservationKind } from '../types.js';
import { classifyCommand } from './command.js';
import { isInside } from '../util/paths.js';
import { isSearchable, readablePrompt } from '../util/prompt.js';
import { keepEnds } from '../util/snippet.js';
import { currentAuthor, observationId } from './identity.js';
import { redact } from './redact.js';
import type { Turn } from './transcript.js';
import { answers, buildTitle, shortPath } from './turn-title.js';

const ASKED_CHARS = 120;

export function clipAsked(text: string): string {
  const asked = text.replace(/\s+/g, ' ').trim();
  return asked.length > ASKED_CHARS ? `${asked.slice(0, ASKED_CHARS)}…` : asked;
}

export function askedIn(body: string): string {
  return clipAsked(/^Asked: (.*)$/m.exec(body)?.[1] ?? '');
}

export function stripPrivate(text: string): string {
  return text.replace(/<private>[\s\S]*?(?:<\/private>|$)/gi, '[private]');
}

export function observationsFromTurns(
  turns: Turn[],
  sessionId: string,
  project: string,
  config: Config,
): Observation[] {
  return turns
    .map(withoutPrivate)
    .map((turn) => ({
      id: observationId(sessionId, turn.timestamp, turn.prompt),
      turn: { ...turn, prompt: readablePrompt(turn.prompt) },
    }))
    .filter(({ turn }) => isSubstantive(turn, config))
    .map(({ id, turn }) => buildObservation(turn, id, sessionId, project, config));
}

function withoutPrivate(turn: Turn): Turn {
  return {
    ...turn,
    prompt: stripPrivate(turn.prompt),
    reasoning: stripPrivate(turn.reasoning),
    reply: stripPrivate(turn.reply),
  };
}

function isSubstantive(turn: Turn, config: Config): boolean {
  const files = turn.files.filter((file) => !isExcluded(file, config.capture.exclude));
  const commands = turn.commands.filter((command) => classifyCommand(command) !== null);
  if (files.length > 0 || commands.length > 0) return true;
  return isSearchable(turn.prompt) && answers(turn.reasoning);
}

function buildObservation(
  turn: Turn,
  id: string,
  sessionId: string,
  project: string,
  config: Config,
): Observation {
  const files = [...new Set(turn.files.filter((f) => !isExcluded(f, config.capture.exclude)))];
  const commands = turn.commands
    .map(classifyCommand)
    .filter((c): c is NonNullable<typeof c> => c !== null);

  const body = redact(
    keepEnds(
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
  const kind = classifyTurn(turn);

  return {
    id,
    sessionId,
    project,
    ...(author ? { author } : {}),
    status: files.some((file) => isInside(file, project)) ? 'open' : 'done',
    kind,
    title: redact(buildTitle(turn, files, kind)),
    body,
    files,
    tags: topLevelDirs(files, project),
    createdAt: turn.timestamp,
  };
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

const PREFERENCE_PROMPT_MAX = 600;

export function classifyTurn(turn: Turn): ObservationKind {
  const prompt = turn.prompt.toLowerCase();
  const text = `${turn.prompt} ${turn.reply || turn.reasoning}`.toLowerCase();

  if (
    prompt.length <= PREFERENCE_PROMPT_MAX &&
    (/\b(from now on|going forward|remember to|prefer)\b/.test(prompt) ||
      /\b(always|never)\s+(use|run|do|add|write|call|put|name|commit|push|import|install)\b/.test(
        prompt,
      ))
  ) {
    return 'preference';
  }
  if (
    /\b(opted for|went with|chose|settled on|decided?|decision|trade-?off|in favou?r of|why (did |do |does )?(we|i))\b/.test(
      text,
    ) ||
    /\b(instead of|rather than)\b/.test(prompt)
  ) {
    return 'decision';
  }
  const outcome = (turn.reply || turn.reasoning).toLowerCase();
  if (
    /\b(didn'?t work|reverted|abandoned|dead ?end|gave up|doesn'?t scale)\b/.test(text) &&
    !/\b(fixed|fixes)\b/.test(outcome)
  ) {
    return 'deadend';
  }
  if (/\b(fix(ed)?|bug|broken|regression|error|crash)\b/.test(text)) return 'bugfix';
  return turn.files.length > 0 ? 'pattern' : 'context';
}

function isExcluded(file: string, patterns: string[]): boolean {
  return patterns.some((pattern) => file.includes(pattern));
}
