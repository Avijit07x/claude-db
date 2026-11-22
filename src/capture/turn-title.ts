import type { ObservationKind } from '../types.js';
import { redact } from './redact.js';
import type { Turn } from './transcript.js';

export function answers(reasoning: string): boolean {
  const scored = scoreSentences(stripMarkdown(redact(reasoning)));
  return scored.length >= 2 && scored.some(([, score]) => score > 0);
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

export function buildTitle(turn: Turn, files: string[], kind: ObservationKind): string {
  if (kind === 'preference') {
    const rule = firstSentence(redact(turn.prompt));
    if (rule) return headline(rule);
  }

  const prose = stripMarkdown(redact(turn.reasoning));
  const reply = stripMarkdown(redact(turn.reply));

  const best =
    bestSentence(reply, 1) ??
    bestSentence(prose, 1) ??
    bestSentence(reply, 0) ??
    bestSentence(prose, 0);
  if (best) return headline(best);

  const prompt = firstSentence(redact(turn.prompt));
  if (prompt) return headline(prompt);

  const opening = firstSentence(prose);
  if (opening && opening.length >= 15) return headline(opening);

  return files.length > 0 ? `Changed ${shortPath(files[0] ?? '')}` : 'Session work';
}

function bestSentence(prose: string, least: number): string | undefined {
  return scoreSentences(prose).find(([, score]) => score >= least)?.[0];
}

function scoreSentences(prose: string): (readonly [string, number])[] {
  return sentences(prose)
    .slice(0, 6)
    .filter((sentence) => sentence.length >= 15)
    .map((sentence) => [sentence, reports(sentence)] as const);
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
  if (cut >= 30) return `${clause.slice(0, cut)}...`;

  const word = clause.lastIndexOf(' ');
  return `${clause.slice(0, word > 30 ? word : TITLE_MAX)}...`;
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
    .replace(/^\s*(?:[-+]|\d+\.)\s+/gm, '')
    .replace(/[*`#]/g, '')
    .trim();
}

export function shortPath(path: string): string {
  return path.split('/').filter(Boolean).slice(-2).join('/');
}
