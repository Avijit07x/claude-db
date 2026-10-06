import { redact } from '../capture/redact.js';
import type { Observation, ObservationIndexEntry } from '../types.js';
import { meaningfulTokens } from '../search/stopwords.js';
import { formatDay } from '../util/day.js';
import { toShortId } from '../util/shortid.js';

type Matchable = { title: string; snippet?: string | undefined };

function tokens(text: string): Set<string> {
  return new Set(meaningfulTokens(text));
}

export function overlapCount(prompt: string, entry: Matchable): number {
  const offered = tokens(`${entry.title} ${entry.snippet ?? ''}`);
  let shared = 0;
  for (const word of tokens(prompt)) if (offered.has(word)) shared++;
  return shared;
}

export function clearsOverlap(prompt: string, entry: Matchable, floor: number): boolean {
  if (floor === 0) return true;
  return overlapCount(prompt, entry) >= Math.min(floor, tokens(prompt).size);
}

export function renderPromptContext(
  entries: ObservationIndexEntry[],
  maxChars: number,
  expanded: Observation[] = [],
  expandMaxChars = 900,
  shown: string[] = [],
  now = Date.now(),
): string | null {
  const bodies = new Map(expanded.map((obs) => [obs.id, obs.body]));
  const lines: string[] = [];
  const titles = new Set<string>();
  let budget = maxChars;

  for (const entry of entries) {
    if (titles.has(entry.title)) {
      shown.push(entry.id);
      continue;
    }
    titles.add(entry.title);
    const line = `- ${formatDay(entry.createdAt, now)}: ${redact(entry.title)} (${toShortId(entry.id)})`;
    const body = bodies.get(entry.id);
    if (body !== undefined) {
      lines.push(`${line}\n${indent(clip(redact(body), expandMaxChars))}`);
      shown.push(entry.id);
      continue;
    }
    if (line.length > budget) break;
    budget -= line.length + 1;
    lines.push(line);
    shown.push(entry.id);
  }

  if (lines.length === 0) return null;
  return ['<memory>', ...lines, '</memory>'].join('\n');
}

export interface PickedLine {
  memory: Observation;
  quote: string;
}

const ASKED_CHARS = 120;

function askedIn(body: string): string {
  const asked = /^Asked: (.*)$/m.exec(body)?.[1]?.replace(/\s+/g, ' ').trim() ?? '';
  return asked.length > ASKED_CHARS ? `${asked.slice(0, ASKED_CHARS)}…` : asked;
}

export function renderPicked(
  picks: PickedLine[],
  maxChars: number,
  shown: string[] = [],
  now = Date.now(),
): string | null {
  const lines: string[] = [];
  let budget = maxChars;
  for (const { memory, quote } of picks) {
    const asked = askedIn(memory.body);
    const text = redact(asked ? `asked "${asked}": ${quote}` : quote);
    const line = `- ${formatDay(memory.createdAt, now)}: ${text} (${toShortId(memory.id)})`;
    if (line.length > budget) break;
    budget -= line.length + 1;
    lines.push(line);
    shown.push(memory.id);
  }
  if (lines.length === 0) return null;
  return ['<memory>', ...lines, '</memory>'].join('\n');
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n... [truncated]`;
}
