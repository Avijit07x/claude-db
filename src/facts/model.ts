import { execFileSync } from 'node:child_process';
import { hostname } from 'node:os';
import type { Observation, ObservationKind } from '../types.js';
import { currentAuthor, observationId } from '../capture/identity.js';
import { redact } from '../capture/redact.js';
import { scopeToken } from '../util/scope.js';

export const FACT_SESSION = 'facts';
export const FACT_TAG = 'fact';
export const CLAUDE_MEMORY_TAG = 'claude-memory';
export const FACT_TYPES = ['rule', 'decision', 'deadend', 'todo', 'fact'] as const;
export const FACT_SCOPES = ['you', 'project'] as const;

export type FactType = (typeof FACT_TYPES)[number];
export type FactScope = (typeof FACT_SCOPES)[number];

export interface Fact {
  key: string;
  type: FactType;
  scope: FactScope;
  text: string;
  why?: string;
  files: string[];
  at: number;
  source: string;
  tags?: string[];
}

const KINDS: Record<FactType, ObservationKind> = {
  rule: 'preference',
  decision: 'decision',
  deadend: 'deadend',
  todo: 'context',
  fact: 'context',
};

const LABELS: Record<FactType, string> = {
  rule: 'Rule',
  decision: 'Decided',
  deadend: 'Dead end',
  todo: 'To do',
  fact: 'Fact',
};

let you: string | null = null;

export function youScope(): string {
  if (you === null) {
    let email = '';
    try {
      email = execFileSync('git', ['config', '--get', 'user.email'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {}
    you = `@you:${email || currentAuthor() || 'unknown'}`;
  }
  return you;
}

export function machineTag(): string {
  return `machine:${scopeToken(hostname())}`;
}

export function originTag(project: string): string {
  return `origin:${scopeToken(project)}`;
}

export function scopeProject(scope: FactScope, project: string): string {
  return scope === 'you' ? youScope() : project;
}

export function factId(owner: string, key: string): string {
  return observationId(FACT_SESSION, 0, `${owner}\0${key}`);
}

export function factType(obs: Observation): FactType | null {
  return FACT_TYPES.find((type) => obs.tags.includes(`type:${type}`)) ?? null;
}

export function factKey(obs: Observation): string | null {
  return obs.tags.find((tag) => tag.startsWith('key:'))?.slice(4) ?? null;
}

export function onePerKey(rows: Observation[]): Observation[] {
  const seen = new Set<string>();
  return rows.filter((obs) => {
    const key = factKey(obs);
    if (key === null) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function factLabel(obs: Observation): string | null {
  const type = factType(obs);
  if (type) return LABELS[type];
  return obs.sessionId === 'manual' ? LABELS.rule : null;
}

export function factToObservation(fact: Fact, project: string): Observation {
  const owner = scopeProject(fact.scope, project);
  const text = redact(fact.text);
  const why = fact.why ? redact(fact.why) : '';
  const author = currentAuthor();
  return {
    id: factId(owner, fact.key),
    sessionId: FACT_SESSION,
    project: owner,
    kind: KINDS[fact.type],
    title: text,
    body: [text, why ? `Why: ${why}` : '', redact(fact.source)].filter(Boolean).join('\n\n'),
    files: fact.files,
    tags: [FACT_TAG, `type:${fact.type}`, `key:${fact.key}`, ...(fact.tags ?? [])],
    createdAt: fact.at,
    status: 'done',
    ...(author ? { author } : {}),
  };
}
