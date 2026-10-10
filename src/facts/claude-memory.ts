import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { RecallContext } from '../context.js';
import type { Observation } from '../types.js';
import { embedObservations } from '../capture/flush.js';
import type { Fact, FactType } from './model.js';
import {
  CLAUDE_MEMORY_TAG,
  FACT_SESSION,
  factToObservation,
  machineTag,
  originTag,
  youScope,
} from './model.js';

const MAX_TITLE = 200;

export interface ImportResult {
  files: number;
  saved: number;
  retired: number;
}

interface MemoryFile {
  name: string;
  description: string;
  type: string;
  body: string;
  modified: number;
}

export function claudeMemoryDir(project: string): string {
  return join(homedir(), '.claude', 'projects', project.replace(/[^a-zA-Z0-9]/g, '-'), 'memory');
}

export function parseMemoryFile(text: string, fallbackTime: number): MemoryFile | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return null;
  const fields = new Map<string, string>();
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const field = /^\s*([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (field?.[1] && field[2] !== undefined) fields.set(field[1], unquote(field[2]));
  }
  const name = fields.get('name') ?? '';
  const body = (match[2] ?? '').trim();
  if (!name || !body) return null;
  const modified = Date.parse(fields.get('modified') ?? '');
  return {
    name,
    description: fields.get('description') ?? '',
    type: fields.get('type') ?? '',
    body,
    modified: Number.isNaN(modified) ? fallbackTime : modified,
  };
}

export function memoryFact(file: MemoryFile, project: string): Fact {
  const type: FactType = file.type === 'feedback' ? 'rule' : 'fact';
  const firstLine = file.body.split('\n')[0] ?? '';
  const title = (file.description || firstLine).replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
  return {
    key: `claude-${file.name.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}`.slice(0, 60),
    type,
    scope: 'project',
    text: title,
    why: '',
    files: [],
    at: file.modified,
    source: `${file.body}\n\nFrom Claude Code's memory: ${file.name}.md`,
    tags: [CLAUDE_MEMORY_TAG, machineTag(), originTag(project)],
  };
}

export async function importClaudeMemory(
  ctx: RecallContext,
  project: string,
  dir = claudeMemoryDir(project),
): Promise<ImportResult> {
  const files = memoryFiles(dir);
  const facts = files.map((file) => factToObservation(memoryFact(file, project), project));
  const stored = await importedFacts(ctx, project);

  const byId = new Map(stored.map((obs) => [obs.id, obs]));
  const changed = facts.filter((fact) => {
    const old = byId.get(fact.id);
    return !old || old.status === 'replaced' || old.title !== fact.title || old.body !== fact.body;
  });
  await embedObservations(ctx, changed);
  await ctx.store.insertObservations(changed);

  const present = new Set(facts.map((fact) => fact.id));
  const gone = stored
    .filter((obs) => obs.status !== 'replaced' && !present.has(obs.id))
    .map((obs) => obs.id);
  const retired = await ctx.store.markReplaced(gone);
  return { files: files.length, saved: changed.length, retired };
}

function memoryFiles(dir: string): MemoryFile[] {
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.md') && name !== 'MEMORY.md');
  } catch {
    return [];
  }
  const files: MemoryFile[] = [];
  for (const name of names) {
    try {
      const path = join(dir, name);
      const parsed = parseMemoryFile(
        readFileSync(path, 'utf8'),
        Math.trunc(statSync(path).mtimeMs),
      );
      if (parsed) files.push(parsed);
    } catch {}
  }
  return files;
}

async function importedFacts(ctx: RecallContext, project: string): Promise<Observation[]> {
  const mine = [machineTag(), originTag(project)];
  const rows: Observation[] = [];
  for (const owner of [project, youScope()]) {
    const batch = await ctx.store.list({ project: owner, sessionId: FACT_SESSION, limit: 5000 });
    rows.push(
      ...batch.filter(
        (obs) =>
          obs.tags.includes(CLAUDE_MEMORY_TAG) && mine.every((tag) => obs.tags.includes(tag)),
      ),
    );
  }
  return rows;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const quoted = /^(["'])([\s\S]*)\1$/.exec(trimmed);
  return quoted?.[2] ?? trimmed;
}
